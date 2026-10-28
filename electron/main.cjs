const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut, protocol, net, Tray, Menu, nativeImage } = require('electron');
const { Store } = require('./store.cjs');
const { scanLibrary, findLaunchers, epicOwnedTitles, normalizeTitle, ownedEpicGames, ownedGalaxyGames } = require('./games.cjs');
const { minimizeWindowsOf, closeWindowsOf, killProcesses } = require('./windows.cjs');
const { wikiLookup } = require('./wiki.cjs');
const { fetchFreeGames, STORE: EPIC_STORE } = require('./epic-free.cjs');
const { lifetimeStats } = require('./lifetime.cjs');
const { setupUpdater, checkForUpdate, installUpdate, updateState } = require('./updater.cjs');
const { login: steamLogin, logout: steamLogout, fetchAccount } = require('./steam-account.cjs');
const ACCOUNTS = { epic: require('./epic-account.cjs'), gog: require('./gog-account.cjs') };
const { searchSteam, steamDetails, autoMatch, applyMeta, fetchSteamAssets, withAssets } = require('./meta.cjs');
const { TrainerSession } = require('./engine/session.cjs');
const { GameProcess, listProcesses, getProcessPath, toHex, TYPES } = require('./engine/process.cjs');
const { Scanner } = require('./engine/scanner.cjs');
const { WriteWatcher } = require('./engine/debugger.cjs');

const POLL_MS = 2000;
const HELPER_PROC = /launcher|crash|unins|redist|setup|helper|report|updater|prereq|ue4prereq|cefprocess|webhelper/i;
const ANTICHEAT_PROC = /easyanticheat|beservice|battleye|xigncode|gameguard|nprotect|vgc|eaanticheat/i;
const AC_MSG = 'Anti-triche détecté : Pimplay ne modifie pas les jeux protégés (jeux en ligne).';

if (!app.requestSingleInstanceLock()) app.quit();

protocol.registerSchemesAsPrivileged([{ scheme: 'pimplay-img', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// Sert uniquement les images du cache de bibliothèque Steam et les jaquettes perso de Pimplay
function registerImageProtocol() {
  protocol.handle('pimplay-img', (req) => {
    const file = path.normalize(decodeURIComponent(new URL(req.url).pathname.slice(1)));
    const allowed = /[\\/]appcache[\\/]librarycache[\\/]/i.test(file)
      || file.toLowerCase().startsWith(store.coversDir.toLowerCase() + path.sep);
    if (!allowed || !/\.(jpe?g|png|webp)$/i.test(file)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

let win = null;
let store = null;
let library = [];
let running = [];
let runningKey = '';
let failedPid = null;
const pathCache = new Map();
const session = new TrainerSession();
let scanner = null;
let watcher = null;

// À la fermeture, le nettoyage (détachement du trainer…) peut encore émettre des événements alors
// que la fenêtre est déjà détruite : on les ignore.
const winAlive = () => !!win && !win.isDestroyed();
const send = (channel, payload) => {
  if (!winAlive() || win.webContents.isDestroyed()) return;
  win.webContents.send(channel, payload);
};

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#0a0b12',
    title: 'Pimplay',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0b12', symbolColor: '#9ea2bd', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  // La croix ne quitte pas directement : selon le réglage, on demande, on réduit dans la zone
  // de notification (Pimplay continue de suivre les jeux) ou on quitte.
  win.on('close', (e) => {
    if (quitting) return;
    const action = store.data.settings.closeAction || 'ask';
    if (action === 'quit') { quitting = true; return; }
    e.preventDefault();
    if (action === 'tray') hideToTray();
    else { showWindow(); send('close-request'); }
  });
  win.on('session-end', () => { quitting = true; }); // arrêt / déconnexion de Windows : ne rien bloquer
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

// ---------- Bibliothèque ----------

const steamAppIdOf = (game) => (game.id.startsWith('steam:') ? game.id.slice(6) : store.data.meta[game.id]?.steamAppId || null);

function decorate(game) {
  const g = withAssets(applyMeta(game, store.data.meta[game.id], store.coversDir), store.data.steamAssets[steamAppIdOf(game)]);
  const stats = store.data.stats[g.id] || {};
  const steamInfo = g.source === 'steam' ? store.data.steamInfo?.[g.id.slice(6)] : null;
  return {
    ...g,
    info: g.info || (steamInfo?.description !== undefined ? steamInfo : null),
    favorite: store.data.favorites.includes(g.id),
    hidden: store.data.hidden.includes(g.id),
    lastPlayed: Math.max(stats.lastPlayed || 0, g.lastPlayed || 0) || null,
    // Steam fait foi quand il connaît le jeu ; sinon le temps compté par Pimplay
    playtime: Math.max(g.playtime || 0, stats.tracked || 0),
    playtimeSource: g.playtime && g.playtime >= (stats.tracked || 0) ? 'steam' : stats.tracked ? 'pimplay' : null,
    cheatCount: store.getTrainer(g.id).cheats.length,
    running: running.some((r) => r.gameId === g.id),
  };
}

// Liste envoyée à l'interface : métadonnées appliquées, triée sur le nom affiché
function decorated() {
  return library.map(decorate).sort((a, b) => a.name.localeCompare(b.name));
}

// Analyse des bibliothèques (~2 s). Un seul scan à la fois ; le résultat est mémorisé pour que
// le prochain démarrage affiche les jeux immédiatement, avant même la fin du nouveau scan.
let scanning = null;
function refreshLibrary() {
  scanning ||= (async () => {
    try {
      library = await scanLibrary(store.data.customGames);
      store.data.libraryCache = library;
      store.save();
      ensureAutoMeta().then(ensureSteamAssets).then(ensureSteamInfo);
      return decorated();
    } finally {
      scanning = null;
    }
  })();
  return scanning;
}

// Jeux hors Steam restés sans jaquette (GOG, Epic hors cache, Battle.net, perso) : une tentative
// d'association Steam par nom, puis Wikipédia si Steam ne connaît pas le jeu. Chaque tentative est
// mémorisée pour ne pas la refaire à chaque lancement (et respecter les limites de Wikimedia).
async function ensureAutoMeta() {
  store.data.autoTried ||= [];
  store.data.wikiTried ||= [];
  // Une fiche « porteuse d'infos » = Steam ou Wikipédia (une simple image perso ne compte pas)
  const hasInfo = (id) => !!(store.data.meta[id]?.steamAppId || store.data.meta[id]?.wiki);
  const todo = library.filter((g) => g.source !== 'steam' && !hasInfo(g.id)
    && ![].concat(g.images?.cover || []).length
    && (!store.data.autoTried.includes(g.id) || !store.data.wikiTried.includes(g.id)));
  if (!todo.length) return;
  for (const g of todo) {
    try {
      if (!store.data.autoTried.includes(g.id)) {
        const info = await autoMatch(g.name, path.basename(g.installDir));
        if (info) setMeta(g.id, info);
        store.data.autoTried.push(g.id);
      }
      if (!hasInfo(g.id) && !store.data.wikiTried.includes(g.id)) {
        const wiki = await wikiLookup(g.name);
        if (wiki) setMeta(g.id, { wiki });
        store.data.wikiTried.push(g.id);
        await new Promise((r) => setTimeout(r, 1500)); // espace les requêtes vers Wikimedia
      }
    } catch {
      break; // hors ligne ou limité : on réessaiera au prochain lancement
    }
  }
  store.save();
  send('library', decorated());
}

// Récupère en arrière-plan les visuels officiels manquants ou anciens, puis rafraîchit l'interface
const ASSETS_TTL = 14 * 24 * 3600 * 1000;
let assetsBusy = false;
async function ensureSteamAssets() {
  if (assetsBusy) return;
  const owned = (store.data.steamAccount?.owned || []).map((o) => o.appid);
  const ids = [...new Set([...library.map(steamAppIdOf), ...owned].filter(Boolean))]
    .filter((id) => !store.data.steamAssets[id] || Date.now() - store.data.steamAssets[id].fetchedAt > ASSETS_TTL);
  if (!ids.length) return;
  assetsBusy = true;
  try {
    Object.assign(store.data.steamAssets, await fetchSteamAssets(ids));
    store.save();
    send('library', decorated());
  } catch {
    // Hors ligne : on garde les images locales et le CDN
  } finally {
    assetsBusy = false;
  }
}

// ---------- Jeux possédés mais pas installés (compte Steam, launcher Epic, GOG Galaxy) ----------
const OWNED_TTL = 6 * 3600 * 1000;

function steamOwnedGames() {
  return (store.data.steamAccount?.owned || []).map((o) => {
    const cdn = `https://cdn.cloudflare.steamstatic.com/steam/apps/${o.appid}`;
    return {
      id: `steam:${o.appid}`,
      source: 'steam',
      name: o.name,
      playtime: o.playtime,
      lastPlayed: o.lastPlayed,
      launch: { type: 'steam', appid: o.appid, url: `steam://install/${o.appid}` },
      images: { cover: [`${cdn}/library_600x900.jpg`], hero: [`${cdn}/library_hero.jpg`] },
    };
  });
}

// Avec un compte Epic ou GOG connecté, sa liste remplace celle lue sur le disque pour cette plateforme
// (le temps de jeu connu de Galaxy est conservé)
function accountGames(kind, local) {
  const account = store.data[`${kind}Account`];
  if (!account?.at) return local;
  const byId = new Map(local.map((g) => [g.id, g]));
  return ACCOUNTS[kind].ownedGames(account).map((g) => ({ ...byId.get(g.id), ...g }));
}

function ownedNotInstalled() {
  // Installé = même identifiant, ou même nom sur la même plateforme (Galaxy n'a pas toujours les
  // identifiants qu'utilisent les launchers, ex. Ubisoft)
  const installed = new Set(library.flatMap((g) => [g.id, `${g.source}:${normalizeTitle(g.name)}`]));
  const seen = new Set();
  const galaxy = ownedGalaxyGames();
  return [
    ...steamOwnedGames(),
    ...accountGames('epic', ownedEpicGames()),
    ...accountGames('gog', galaxy.filter((g) => g.source === 'gog')),
    ...galaxy.filter((g) => g.source !== 'gog'),
  ]
    .filter((g) => !installed.has(g.id) && !installed.has(`${g.source}:${normalizeTitle(g.name)}`) && !seen.has(g.id) && seen.add(g.id))
    .map((g) => decorate({ ...g, installed: false }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function steamAccountInfo() {
  const a = store.data.steamAccount;
  return a ? { steamId: a.steamId, name: a.name || null, avatar: a.avatar || null, at: a.at || null, ownedCount: a.owned?.length || 0, error: a.error || null } : null;
}

let ownedRefresh = null;
function refreshOwned() {
  if (!store.data.steamAccount) return Promise.resolve(null);
  ownedRefresh ||= (async () => {
    try {
      Object.assign(store.data.steamAccount, await fetchAccount(), { error: null });
    } catch (err) {
      // On garde la dernière liste connue ; l'erreur s'affiche dans les paramètres
      store.data.steamAccount.error = err.message;
    }
    store.save();
    send('steam', steamAccountInfo());
    ensureSteamAssets();
    ownedRefresh = null;
    return steamAccountInfo();
  })();
  return ownedRefresh;
}

// ---------- Comptes Epic et GOG ----------
function accountInfo(kind) {
  const a = store.data[`${kind}Account`];
  if (!a) return null;
  return { name: a.name || null, at: a.at || null, ownedCount: a.at ? ACCOUNTS[kind].ownedGames(a).length : 0, error: a.error || null };
}

const accountRefresh = {};
function refreshAccount(kind) {
  if (!store.data[`${kind}Account`]) return Promise.resolve(null);
  accountRefresh[kind] ||= (async () => {
    const account = store.data[`${kind}Account`];
    try {
      Object.assign(account, await ACCOUNTS[kind].fetchAccount(account), { error: null });
    } catch (err) {
      // On garde la dernière liste connue ; l'erreur s'affiche dans les paramètres
      account.error = err.message;
    }
    store.save();
    send(kind, accountInfo(kind));
    accountRefresh[kind] = null;
    return accountInfo(kind);
  })();
  return accountRefresh[kind];
}

// Fiches Steam (description, développeur, genres…) des jeux Steam, en cache 30 jours.
// Requêtes une par une : l'API appdetails limite le débit.
const INFO_TTL = 30 * 24 * 3600 * 1000;
let infoBusy = false;
async function ensureSteamInfo() {
  if (infoBusy) return;
  store.data.steamInfo ||= {};
  const ids = library.filter((g) => g.source === 'steam').map((g) => g.id.slice(6))
    .filter((id) => !store.data.steamInfo[id] || Date.now() - store.data.steamInfo[id].fetchedAt > INFO_TTL);
  if (!ids.length) return;
  infoBusy = true;
  try {
    for (const id of ids) {
      try {
        const { steamAppId, name, header, background, ...info } = await steamDetails(id);
        store.data.steamInfo[id] = { ...info, fetchedAt: Date.now() };
      } catch (e) {
        if (/fetch failed|répondu 429/.test(e.message)) break; // hors ligne ou limité : on reprendra plus tard
        store.data.steamInfo[id] = { fetchedAt: Date.now() }; // fiche inexistante (jeu retiré…)
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    store.save();
    send('library', decorated());
  } finally {
    infoBusy = false;
  }
}

function setMeta(id, patch) {
  const next = { ...(store.data.meta[id] || {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] === null || next[k] === undefined) delete next[k];
  if (Object.keys(next).length) store.data.meta[id] = next;
  else delete store.data.meta[id];
  store.save();
}

// ---------- Lancement des jeux ----------

const LAUNCHER_PROC = {
  steam: 'steam.exe',
  epic: 'epicgameslauncher.exe',
  ubisoft: 'upc.exe',
  battlenet: 'battle.net.exe',
  ea: 'eadesktop.exe',
};
const LAUNCH_TIMEOUT = 3 * 60 * 1000;
let launchers = { steamExe: null, epicExe: null };
let launching = null; // { gameId, kind, stage: 'launcher' | 'starting' | 'running' | 'timeout', startedAt }

function setLaunch(next) {
  launching = next;
  send('launch', launching);
}

// Fait avancer l'état du lancement à chaque scan des processus
function updateLaunch(procs, runningNow) {
  if (!launching) return;
  if (runningNow.some((r) => r.gameId === launching.gameId)) {
    onGameStarted(launching);
    setLaunch({ ...launching, stage: 'running' });
    launching = null;
  } else if (Date.now() - launching.startedAt > LAUNCH_TIMEOUT) {
    setLaunch({ ...launching, stage: 'timeout' });
    launching = null;
  } else if (launching.stage === 'launcher' && procs.some((p) => p.name.toLowerCase() === LAUNCHER_PROC[launching.kind])) {
    setLaunch({ ...launching, stage: 'starting' });
  }
}

// Jeu lancé depuis Pimplay et détecté : on range les fenêtres (réglages « Lancement des jeux »)
let minimizedFor = null; // jeu pour lequel Pimplay s'est réduit, à rétablir à sa fermeture
function onGameStarted({ gameId, kind }) {
  const s = store.data.settings;
  const launcherProc = LAUNCHER_PROC[kind];
  if (launcherProc && s.minimizeLauncher !== false) {
    // Steam / Epic ouvrent parfois leur fenêtre avec un peu de retard : on repasse ensuite
    const tidy = () => minimizeWindowsOf(listProcesses().filter((p) => p.name.toLowerCase() === launcherProc).map((p) => p.pid));
    tidy();
    setTimeout(tidy, 4000);
    setTimeout(tidy, 12000);
  }
  if (s.minimizeSelf && winAlive() && !win.isMinimized()) {
    win.minimize();
    minimizedFor = gameId;
  }
}

function onGamesStopped(runningNow) {
  if (minimizedFor && !runningNow.some((r) => r.gameId === minimizedFor)) {
    if (winAlive() && win.isMinimized()) win.restore();
    minimizedFor = null;
  }
}

// ---------- Surveillance des processus ----------

// Temps de jeu compté par Pimplay (utile pour Epic, GOG et les jeux perso) : durée pendant
// laquelle un processus du dossier du jeu tourne. Sauvegarde au plus une fois par minute.
let lastTick = Date.now();
let lastStatsSave = Date.now();
let statsDirty = false;
let rescanTimer = null;

// Historique des sessions : une entrée { g: jeu, s: début, e: fin } par partie, tous jeux confondus
// (Steam compris), tant que Pimplay tourne. Une coupure du suivi (veille, Pimplay figé) clôt la session.
const MIN_SESSION_MS = 60 * 1000; // ignore les lancements éclair (launcher qui s'ouvre et se ferme)
const MAX_SESSIONS = 10000;
const openSessions = new Map(); // gameId -> début (ms)
let lastSessionTick = Date.now();

function closeSession(gameId, start, end) {
  openSessions.delete(gameId);
  if (end - start < MIN_SESSION_MS) return;
  store.data.sessions ||= [];
  store.data.sessions.push({ g: gameId, s: start, e: end });
  if (store.data.sessions.length > MAX_SESSIONS) store.data.sessions.splice(0, store.data.sessions.length - MAX_SESSIONS);
  store.save();
  send('sessions', null);
}

function trackSessions(list) {
  const now = Date.now();
  // Le PC sortait de veille (ou le suivi était interrompu) : on clôt à la dernière observation
  if (now - lastSessionTick > POLL_MS * 6) {
    for (const [id, start] of [...openSessions]) closeSession(id, start, lastSessionTick);
  }
  lastSessionTick = now;
  const ids = new Set(list.map((r) => r.gameId));
  for (const id of ids) if (!openSessions.has(id)) openSessions.set(id, now);
  for (const [id, start] of [...openSessions]) if (!ids.has(id)) closeSession(id, start, now);
}

function trackPlaytime(list) {
  const now = Date.now();
  const dt = Math.min(now - lastTick, POLL_MS * 3) / 1000; // ignore les pauses (veille…)
  lastTick = now;
  for (const id of new Set(list.map((r) => r.gameId))) {
    const s = (store.data.stats[id] ||= {});
    s.tracked = (s.tracked || 0) + dt;
    s.lastPlayed = now;
    statsDirty = true;
  }
  if (statsDirty && (now - lastStatsSave > 60000 || !list.length)) {
    store.save();
    lastStatsSave = now;
    statsDirty = false;
  }
}

function pollProcesses() {
  const procs = listProcesses();
  const alive = new Set(procs.map((p) => p.pid));
  for (const pid of pathCache.keys()) if (!alive.has(pid)) pathCache.delete(pid);
  const dirs = library.map((g) => ({ id: g.id, dir: path.normalize(g.installDir).toLowerCase().replace(/[\\/]+$/, '') + '\\' }));
  const next = [];
  for (const p of procs) {
    if (p.pid <= 4) continue;
    let fp = pathCache.get(p.pid);
    if (fp === undefined) {
      fp = getProcessPath(p.pid) || '';
      pathCache.set(p.pid, fp);
    }
    if (!fp) continue;
    const lower = fp.toLowerCase();
    const m = dirs.find((d) => lower.startsWith(d.dir));
    if (m) next.push({ gameId: m.id, pid: p.pid, name: p.name, path: fp });
  }
  const key = next.map((r) => r.pid).join(',');
  const stopped = running.some((r) => !next.some((n) => n.gameId === r.gameId));
  trackPlaytime(next);
  trackSessions(next);
  updateLaunch(procs, next);
  if (stopped) {
    onGamesStopped(next);
    // Steam écrit le temps de jeu à la fermeture du jeu : on relit un peu plus tard
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => refreshLibrary().then((lib) => send('library', lib)), 20000);
  }
  if (key !== runningKey) {
    running = next;
    runningKey = key;
    send('running', running);
  }
  autoAttach();
}

// Option « Outils de mod / trainer » : désactivée, Pimplay est un simple launcher
const modToolsEnabled = () => store.data.settings.modTools !== false;

function autoAttach() {
  if (!modToolsEnabled() || !session.gameId || session.attached) return;
  const candidates = running.filter((r) => r.gameId === session.gameId);
  if (!candidates.length) return;
  const game = library.find((g) => g.id === session.gameId);
  if (game?.antiCheat || candidates.some((r) => ANTICHEAT_PROC.test(r.name))) {
    if (session.error !== AC_MSG) { session.error = AC_MSG; session.emitState(); }
    return;
  }
  const wanted = session.trainer.process?.toLowerCase();
  const pick = (wanted && candidates.find((r) => r.name.toLowerCase() === wanted))
    || candidates.find((r) => !HELPER_PROC.test(r.name))
    || candidates[0];
  if (pick.pid === failedPid) return;
  session.attach(pick.pid);
  failedPid = session.attached ? null : pick.pid;
}

// ---------- Raccourcis clavier globaux ----------

function registerHotkeys() {
  globalShortcut.unregisterAll();
  if (!modToolsEnabled() || !store.data.settings.hotkeysEnabled || !session.attached) return;
  for (const c of session.trainer.cheats) {
    if (!c.hotkey) continue;
    try {
      globalShortcut.register(c.hotkey, () => {
        session.hotkey(c.id);
        send('hotkey', { id: c.id });
      });
    } catch {}
  }
}

let wasAttached = false;
session.on('state', (state) => {
  send('session', state);
  if (state.attached !== wasAttached) {
    wasAttached = state.attached;
    registerHotkeys();
  }
});

// ---------- IPC ----------

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => fn(...args));
}

function setupIpc() {
  handle('library:list', async () => (library.length ? decorated() : refreshLibrary()));
  handle('library:refresh', refreshLibrary);
  handle('library:addCustom', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Ajouter un jeu',
      filters: [{ name: 'Exécutable', extensions: ['exe'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const exe = r.filePaths[0];
    if (!store.data.customGames.includes(exe)) store.data.customGames.push(exe);
    store.save();
    await refreshLibrary();
    // Tente de retrouver la fiche Steam à partir du dossier puis du nom de l'exécutable
    const game = library.find((g) => g.exe === exe);
    let matched = null;
    if (game && !store.data.meta[game.id]) {
      const info = await autoMatch(path.basename(path.dirname(exe)), path.basename(exe, path.extname(exe))).catch(() => null);
      if (info) { setMeta(game.id, info); matched = info.name; }
    }
    return { library: decorated(), id: game?.id ?? null, matched };
  });

  handle('meta:search', (term) => searchSteam(term));
  handle('meta:link', async (id, appid) => {
    const info = await steamDetails(appid);
    setMeta(id, info);
    ensureSteamAssets();
    return decorated();
  });
  handle('meta:unlink', (id) => {
    const m = store.data.meta[id] || {};
    setMeta(id, Object.fromEntries(Object.keys(m).filter((k) => !k.startsWith('custom')).map((k) => [k, null])));
    return decorated();
  });
  handle('meta:rename', (id, name) => {
    setMeta(id, { customName: String(name || '').trim() || null });
    return decorated();
  });
  // Images perso : jaquette (cover) ou bannière (hero), copiées dans le dossier de données de Pimplay
  const IMAGE_FIELD = { cover: 'customCover', hero: 'customHero' };
  handle('meta:setImage', async (id, kind) => {
    const field = IMAGE_FIELD[kind];
    if (!field) throw new Error(`Type d'image inconnu : ${kind}`);
    const r = await dialog.showOpenDialog(win, {
      title: kind === 'hero' ? 'Choisir une bannière (image large, ex. 3840×1240)' : 'Choisir une jaquette (image verticale, ex. 600×900)',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const old = store.data.meta[id]?.[field];
    if (old) fs.rmSync(path.join(store.coversDir, old), { force: true });
    const name = `${id.replace(/[^a-z0-9_-]+/gi, '_')}-${kind}-${Date.now()}${path.extname(r.filePaths[0]).toLowerCase()}`;
    fs.copyFileSync(r.filePaths[0], path.join(store.coversDir, name));
    setMeta(id, { [field]: name });
    return decorated();
  });
  // Cadrage vertical de la bannière (0 = haut de l'image, 100 = bas) ; null = valeur par défaut
  handle('meta:setHeroPosition', (id, pct) => {
    const v = pct === null ? null : Math.max(0, Math.min(100, Math.round(Number(pct))));
    setMeta(id, { heroPosition: v });
    return decorated();
  });
  handle('meta:clearImage', (id, kind) => {
    const field = IMAGE_FIELD[kind];
    const old = field && store.data.meta[id]?.[field];
    if (old) fs.rmSync(path.join(store.coversDir, old), { force: true });
    if (field) setMeta(id, { [field]: null });
    return decorated();
  });
  handle('library:removeCustom', async (id) => {
    const g = library.find((x) => x.id === id);
    if (g?.exe) store.data.customGames = store.data.customGames.filter((e) => e !== g.exe);
    store.save();
    return refreshLibrary();
  });
  handle('library:favorite', (id, on) => {
    store.data.favorites = store.data.favorites.filter((f) => f !== id);
    if (on) store.data.favorites.push(id);
    store.save();
    return decorated();
  });

  handle('steam:account', () => steamAccountInfo());
  handle('library:owned', () => ownedNotInstalled());
  // Installation d'un jeu possédé : uniquement l'adresse connue de Pimplay pour ce jeu (steam://,
  // com.epicgames.launcher://, goggalaxy://)
  handle('library:install', (id) => {
    const game = ownedNotInstalled().find((g) => g.id === id);
    if (!game) throw new Error('Ce jeu ne fait pas partie de vos jeux non installés.');
    shell.openExternal(game.launch.url);
  });
  handle('steam:refresh', () => refreshOwned());
  handle('steam:login', async () => {
    const steamId = await steamLogin(winAlive() ? win : null);
    if (!steamId) return steamAccountInfo();
    // Changement de compte : la liste de l'ancien compte ne vaut plus
    if (store.data.steamAccount?.steamId !== steamId) store.data.steamAccount = { steamId };
    return refreshOwned();
  });
  handle('steam:logout', async () => {
    await steamLogout();
    delete store.data.steamAccount;
    store.save();
    send('steam', null);
    return null;
  });

  for (const kind of Object.keys(ACCOUNTS)) {
    handle(`${kind}:account`, () => accountInfo(kind));
    handle(`${kind}:refresh`, () => refreshAccount(kind));
    handle(`${kind}:login`, async () => {
      const prev = store.data[`${kind}Account`];
      const account = await ACCOUNTS[kind].login(winAlive() ? win : null, prev);
      if (!account) return accountInfo(kind);
      store.data[`${kind}Account`] = account;
      store.save();
      send(kind, accountInfo(kind));
      return accountInfo(kind);
    });
    // Connexion dans le navigateur habituel (si la fenêtre intégrée est bloquée par un captcha) :
    // ouverture de la page officielle, puis l'utilisateur colle l'adresse de retour qui contient le code
    handle(`${kind}:browserLogin`, () => {
      if (!ACCOUNTS[kind].browserLoginUrl) throw new Error('Connexion par le navigateur indisponible pour ce compte.');
      shell.openExternal(ACCOUNTS[kind].browserLoginUrl);
    });
    handle(`${kind}:submitCode`, async (text) => {
      if (!ACCOUNTS[kind].loginWithCode) throw new Error('Connexion par le navigateur indisponible pour ce compte.');
      store.data[`${kind}Account`] = await ACCOUNTS[kind].loginWithCode(text, store.data[`${kind}Account`]);
      store.save();
      send(kind, accountInfo(kind));
      return accountInfo(kind);
    });
    handle(`${kind}:logout`, async () => {
      await ACCOUNTS[kind].logout();
      delete store.data[`${kind}Account`];
      store.save();
      send(kind, null);
      return null;
    });
  }

  handle('library:hide', (id, on) => {
    store.data.hidden = store.data.hidden.filter((h) => h !== id);
    if (on) store.data.hidden.push(id);
    store.save();
    return decorated();
  });

  handle('game:launch', async (id) => {
    const g = library.find((x) => x.id === id);
    if (!g) return false;
    store.data.stats[id] = { ...(store.data.stats[id] || {}), lastPlayed: Date.now() };
    store.save();
    if (modToolsEnabled()) session.setTarget(id, store.getTrainer(id));
    if (g.running) return true;

    const { type } = g.launch;
    const launcherProc = LAUNCHER_PROC[type];
    const launcherUp = !launcherProc || listProcesses().some((p) => p.name.toLowerCase() === launcherProc);
    setLaunch({ gameId: id, kind: type, stage: launcherUp ? 'starting' : 'launcher', startedAt: Date.now() });

    // Attend la création du processus pour que ses erreurs (exe introuvable, droits) remontent à l'interface
    // au lieu de planter le processus principal
    const detach = (exe, args, cwd) => new Promise((resolve, reject) => {
      const child = spawn(exe, args, { cwd, detached: true, stdio: 'ignore' });
      child.once('spawn', () => { child.unref(); resolve(); });
      child.once('error', reject);
    });
    try {
      if (type === 'steam' && launchers.steamExe) {
        // Démarre Steam s'il est fermé puis lance le jeu ; transmis à l'instance existante sinon
        // -silent : si Steam était fermé, il démarre dans la zone de notification sans ouvrir sa fenêtre
        const silent = store.data.settings.silentLaunchers !== false ? ['-silent'] : [];
        await detach(launchers.steamExe, [...silent, '-applaunch', g.launch.appid]);
      } else if (type === 'epic' && launchers.epicExe) {
        // Même commande que le lien com.epicgames.launcher:// : démarre le launcher si besoin
        await detach(launchers.epicExe, [g.launch.url]);
      } else if (type === 'battlenet' && launchers.battlenetExe && g.launch.code) {
        // Démarre Battle.net si besoin et lance directement le jeu
        await detach(launchers.battlenetExe, [`--exec=launch ${g.launch.code}`]);
      } else if (g.launch.url) {
        await shell.openExternal(g.launch.url);
      } else {
        await detach(g.launch.exe, [], g.launch.cwd).catch(async (err) => {
          // EACCES : l'exe exige les droits administrateur (manifeste requireAdministrator).
          // spawn ne sait pas élever ; ShellExecute (openPath) affiche l'invite UAC
          if (err.code !== 'EACCES') throw err;
          const failure = await shell.openPath(g.launch.exe);
          if (failure) throw new Error(failure);
        });
      }
    } catch (err) {
      setLaunch(null);
      throw new Error(`Impossible de lancer ${g.name} : ${err.message}`);
    }
    return true;
  });
  // Arrête un jeu : fermeture « propre » (WM_CLOSE) par défaut, arrêt forcé si demandé
  handle('game:stop', (id, force) => {
    const pids = running.filter((r) => r.gameId === id).map((r) => r.pid);
    if (!pids.length) return { running: false };
    if (force) return { running: true, killed: killProcesses(pids) };
    return { running: true, windows: closeWindowsOf(pids) };
  });
  handle('game:openFolder', (id) => {
    const g = library.find((x) => x.id === id);
    if (g) shell.openPath(g.installDir);
  });

  handle('trainer:get', (gameId) => store.getTrainer(gameId));
  handle('trainer:save', (gameId, trainer) => {
    store.saveTrainer(gameId, trainer);
    if (session.gameId === gameId) {
      session.setTrainer(trainer);
      registerHotkeys();
    }
    return store.getTrainer(gameId);
  });
  handle('trainer:import', async (gameId) => {
    const r = await dialog.showOpenDialog(win, { title: 'Importer un trainer', filters: [{ name: 'Trainer Pimplay', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const t = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!Array.isArray(t.cheats)) throw new Error('Fichier de trainer invalide.');
    store.saveTrainer(gameId, t);
    if (session.gameId === gameId) { session.setTrainer(store.getTrainer(gameId)); registerHotkeys(); }
    return store.getTrainer(gameId);
  });
  handle('trainer:export', async (gameId) => {
    const g = library.find((x) => x.id === gameId);
    const r = await dialog.showSaveDialog(win, {
      title: 'Exporter le trainer',
      defaultPath: `${(g?.name || 'trainer').replace(/[\\/:*?"<>|]/g, '')}.pimplay.json`,
      filters: [{ name: 'Trainer Pimplay', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, JSON.stringify(store.getTrainer(gameId), null, 2));
    return true;
  });

  handle('session:activate', (gameId) => {
    requireModTools();
    session.setTarget(gameId, store.getTrainer(gameId));
    failedPid = null;
    autoAttach();
    return session.snapshot();
  });
  handle('session:deactivate', () => {
    session.setTarget(null, { cheats: [] });
    return session.snapshot();
  });
  handle('session:state', () => session.snapshot());
  // Historique : sessions terminées + parties en cours (fin = maintenant), et date de début du suivi
  // Temps de jeu depuis toujours, toutes plateformes (totaux des launchers, pas de sessions)
  handle('stats:lifetime', async () => {
    store.data.steamNames ||= {};
    const result = await lifetimeStats({
      games: [...decorated(), ...ownedNotInstalled()],
      hidden: new Set(store.data.hidden),
      steamNames: store.data.steamNames,
    });
    store.save();
    return result;
  });
  handle('stats:sessions', () => {
    const now = Date.now();
    const done = store.data.sessions || [];
    const live = [...openSessions].map(([g, s]) => ({ g, s, e: now, live: true }));
    return { sessions: [...done, ...live], since: store.data.historySince || now };
  });
  // Jeux gratuits Epic : flux mis en cache 3 h, rechargé plus tôt dès qu'une offre commence ou se termine
  handle('epic:freeGames', async () => {
    const now = Date.now();
    const cache = store.data.epicFree;
    const stale = !cache || now - cache.at > 3 * 3600e3 || cache.items.some((g) => g.end <= now || (!g.now && g.start <= now));
    if (stale) {
      try {
        store.data.epicFree = { at: now, items: await fetchFreeGames() };
        store.save();
      } catch (err) {
        if (!cache) throw err;
      }
    }
    // « Déjà récupéré » : le jeu figure dans le catalogue local du launcher Epic ou sur le compte Epic
    const owned = epicOwnedTitles();
    for (const g of accountGames('epic', [])) owned.add(normalizeTitle(g.name));
    return store.data.epicFree.items
      .filter((g) => g.end > now)
      .map((g) => ({ ...g, owned: !g.mystery && owned.has(normalizeTitle(g.title)) }));
  });
  handle('epic:openStore', (url) => {
    if (typeof url === 'string' && url.startsWith(EPIC_STORE)) shell.openExternal(url);
  });
  handle('launch:state', () => launching);
  handle('cheat:toggle', (id, on) => session.toggle(id, on));
  handle('cheat:setValue', (id, v) => session.setValue(id, v));
  handle('cheat:trigger', (id) => session.trigger(id));

  handle('process:list', () => {
    const win32 = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();
    return listProcesses()
      .filter((p) => p.pid > 4 && p.pid !== process.pid)
      .map((p) => ({ ...p, path: pathCache.get(p.pid) ?? getProcessPath(p.pid) ?? '' }))
      .filter((p) => p.path && !p.path.toLowerCase().startsWith(win32))
      .map((p) => ({ ...p, gameId: running.find((r) => r.pid === p.pid)?.gameId || null }))
      .sort((a, b) => (!!b.gameId - !!a.gameId) || a.name.localeCompare(b.name));
  });

  handle('scanner:attach', async (pid) => {
    requireModTools();
    await watcher?.stop();
    watcher = null;
    scanner?.proc.close();
    scanner = new Scanner(GameProcess.open(pid));
    const p = scanner.proc;
    return { pid: p.pid, exe: p.exeName, is32: p.is32, gameId: running.find((r) => r.pid === pid)?.gameId || null };
  });
  handle('scanner:first', (opts) => requireScanner().firstScan(opts, (p) => send('scanner:progress', p)));
  handle('scanner:next', (opts) => requireScanner().nextScan(opts, (p) => send('scanner:progress', p)));
  handle('scanner:cancel', () => scanner?.cancel());
  handle('scanner:reset', () => { scanner?.reset(); });
  handle('scanner:results', (offset, limit) => {
    const s = requireScanner();
    if (!s.proc.isAlive()) throw new Error('Le processus a été fermé.');
    const mods = s.proc.modules();
    return s.results(offset, limit).map((r) => {
      const a = BigInt(r.address);
      const m = mods.find((x) => a >= x.base && a < x.base + BigInt(x.size));
      return { ...r, module: m ? { name: m.name, offset: toHex(a - m.base) } : null };
    });
  });
  handle('scanner:write', (address, type, value) => requireScanner().proc.writeValue(BigInt(address), type, value));
  handle('scanner:writeAll', (value) => requireScanner().writeAll(value));

  handle('watch:start', async (addresses) => {
    requireModTools();
    const s = requireScanner();
    await watcher?.stop();
    watcher = new WriteWatcher(s.proc);
    watcher.on('update', (snap) => send('watch:update', snap));
    watcher.start(addresses, TYPES[s.type].size);
    return watcher.snapshot();
  });
  handle('watch:stop', async () => {
    await watcher?.stop();
    return watcher?.snapshot() ?? null;
  });
  handle('watch:patch', (id) => {
    if (!watcher) throw new Error('Aucune surveillance en cours.');
    return watcher.makePatch(id);
  });

  handle('settings:get', () => store.data.settings);
  handle('settings:set', async (patch) => {
    Object.assign(store.data.settings, patch);
    store.save();
    if (!modToolsEnabled()) {
      // Passage en mode launcher : on lâche tout ce qui touche aux jeux (patchs restaurés)
      await watcher?.stop();
      watcher = null;
      session.setTarget(null, { cheats: [] });
    }
    registerHotkeys();
    return store.data.settings;
  });
  handle('app:openData', () => shell.openPath(app.getPath('userData')));
  handle('update:state', () => updateState());
  handle('update:check', () => checkForUpdate());
  handle('update:install', () => installUpdate(() => { quitting = true; }));
  handle('app:fullscreen', (on) => { if (winAlive()) win.setFullScreen(!!on); });
  // Réponse à la fenêtre « Fermer Pimplay ? » ; remember = appliquer ce choix aux prochaines fois
  handle('app:closeChoice', (choice, remember) => {
    if (!['tray', 'quit'].includes(choice)) return;
    if (remember) {
      store.data.settings.closeAction = choice;
      store.save();
    }
    if (choice === 'tray') hideToTray();
    else quitApp();
  });
  handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, admin: isAdmin() }));
}

function requireModTools() {
  if (!modToolsEnabled()) throw new Error('Les outils de mod sont désactivés (Paramètres).');
}

function requireScanner() {
  if (!scanner) throw new Error("Sélectionnez d'abord un processus.");
  return scanner;
}

function isAdmin() {
  try {
    fs.readdirSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'config', 'systemprofile'));
    return true;
  } catch {
    return false;
  }
}

// ---------- Zone de notification ----------

let tray = null;
let quitting = false;
let pollTimer = null;

function showWindow() {
  if (!winAlive()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function quitApp() {
  quitting = true;
  app.quit();
}

function hideToTray() {
  if (winAlive()) win.hide();
  if (!store.data.trayHintShown) {
    // Première fois seulement : on explique où est passé Pimplay
    tray?.displayBalloon({
      iconType: 'info',
      title: 'Pimplay continue en arrière-plan',
      content: 'Il suit vos jeux et compte le temps de jeu. Cliquez sur son icône pour le rouvrir.',
    });
    store.data.trayHintShown = true;
    store.save();
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Pimplay');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir Pimplay', click: showWindow },
    { type: 'separator' },
    { label: 'Quitter Pimplay', click: quitApp },
  ]));
  tray.on('click', showWindow);
}

app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });

// L'app s'appelait « Nova » : on reprend ses données (réglages, trainers, jaquettes) au premier lancement
function migrateFromNova(dir) {
  const old = path.join(app.getPath('appData'), 'Nova');
  if (fs.existsSync(path.join(dir, 'pimplay.json')) || !fs.existsSync(path.join(old, 'nova.json'))) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(old, 'nova.json'), path.join(dir, 'pimplay.json'));
  for (const sub of ['trainers', 'covers']) {
    if (fs.existsSync(path.join(old, sub))) fs.cpSync(path.join(old, sub), path.join(dir, sub), { recursive: true });
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId('fr.yalma.pimplay'); // regroupe la fenêtre sous l'icône Pimplay dans la barre des tâches
  migrateFromNova(app.getPath('userData'));
  store = new Store(app.getPath('userData'));
  registerImageProtocol();
  setupIpc();
  createWindow();
  createTray();
  if (!store.data.historySince) { store.data.historySince = Date.now(); store.save(); } // début de l'historique des sessions
  // Démarrage instantané : la dernière bibliothèque connue s'affiche tout de suite, puis le scan
  // en arrière-plan la remplace (nouveaux jeux, désinstallations, temps de jeu à jour).
  library = Array.isArray(store.data.libraryCache) ? store.data.libraryCache : [];
  findLaunchers().then((l) => { launchers = l; });
  refreshLibrary().then((lib) => send('library', lib)).catch(() => {});
  // Jeux possédés sur Steam : relus au démarrage s'ils datent de plus de 6 h, puis toutes les 6 h
  const ownedStale = () => store.data.steamAccount && Date.now() - (store.data.steamAccount.at || 0) > OWNED_TTL;
  if (ownedStale()) refreshOwned();
  setInterval(() => { if (ownedStale()) refreshOwned(); }, 3600e3);
  // Comptes Epic et GOG : même rythme
  const accountStale = (kind) => store.data[`${kind}Account`] && Date.now() - (store.data[`${kind}Account`].at || 0) > OWNED_TTL;
  const refreshStale = () => { for (const kind of Object.keys(ACCOUNTS)) if (accountStale(kind)) refreshAccount(kind); };
  refreshStale();
  setInterval(refreshStale, 3600e3);
  pollTimer = setInterval(pollProcesses, POLL_MS);
  pollProcesses();
  // Mises à jour de Pimplay (versions publiées sur GitHub) : vérification un peu après le démarrage
  setTimeout(() => setupUpdater(send), 8000);
});

app.on('will-quit', () => {
  clearInterval(pollTimer);
  // Les parties encore en cours sont enregistrées jusqu'à maintenant
  for (const [id, start] of [...openSessions]) closeSession(id, start, Date.now());
  globalShortcut.unregisterAll();
  watcher?.stopSync();
  session.detach();
  scanner?.proc.close();
  if (statsDirty) store.save();
});

app.on('window-all-closed', () => app.quit());
