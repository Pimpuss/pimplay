// Détection des jeux installés : Steam, Epic Games, GOG, Ubisoft Connect, Battle.net, EA app + jeux perso.
const fs = require('node:fs');
const path = require('node:path');
const { steamPlaytimes } = require('./playtime.cjs');
const { regQuery, regValue, regDefault, uninstallEntries } = require('./registry.cjs');
const { ubisoftGames, battlenetGames, eaGames, battlenetExe, BNET_CODES } = require('./stores.cjs');

// Exécutables des launchers, pour lancer un jeu même quand le launcher est fermé
async function findLaunchers() {
  const steamExe = (await regValue('HKCU\\Software\\Valve\\Steam', 'SteamExe'))
    || (await regDefault('HKCR\\steam\\shell\\open\\command'))?.match(/^"([^"]+)"/)?.[1];
  const epicExe = (await regDefault('HKCR\\com.epicgames.launcher\\shell\\open\\command'))?.match(/^"([^"]+)"/)?.[1];
  const ok = (p) => (p && fs.existsSync(path.normalize(p)) ? path.normalize(p) : null);
  return { steamExe: ok(steamExe), epicExe: ok(epicExe), battlenetExe: ok(battlenetExe(await uninstallEntries())) };
}

const readText = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
};

// Images du cache local de Steam (appcache/librarycache/<appid>/[hash/]fichier), servies via pimplay-img://
function localSteamImages(steamRoot, appid) {
  const dir = path.join(steamRoot, 'appcache', 'librarycache', appid);
  const files = new Map();
  const walk = (d, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory() && depth < 2) walk(path.join(d, e.name), depth + 1);
      else if (e.isFile() && !files.has(e.name)) files.set(e.name, path.join(d, e.name));
    }
  };
  walk(dir, 0);
  const url = (...names) => names.map((n) => files.get(n)).filter(Boolean).map((p) => `pimplay-img://local/${encodeURIComponent(p)}`);
  return {
    cover: url('library_600x900.jpg', 'library_capsule.jpg'),
    hero: url('library_hero.jpg'),
    logo: url('logo.png'),
    header: url('library_header.jpg', 'header.jpg'),
  };
}

const STEAM_EXCLUDED =new Set(['228980', '1070560', '1391110', '1628350', '250820', '1493710']);
const STEAM_EXCLUDED_NAME = /redistributable|proton|steam linux runtime|steamvr|soundtrack|dedicated server|\bsdk\b/i;

async function steamGames() {
  const root = (await regValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'))
    || (await regValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'));
  if (!root) return [];
  const steamRoot = path.normalize(root);
  const vdf = readText(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf')) || '';
  const libraries = new Set([steamRoot]);
  for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libraries.add(path.normalize(m[1].replace(/\\\\/g, '\\')));

  const playtimes = steamPlaytimes(steamRoot);
  const games = [];
  for (const lib of libraries) {
    const apps = path.join(lib, 'steamapps');
    let files = [];
    try { files = fs.readdirSync(apps).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of files) {
      const acf = readText(path.join(apps, f));
      if (!acf) continue;
      const get = (k) => acf.match(new RegExp(`"${k}"\\s+"([^"]*)"`, 'i'))?.[1];
      const appid = get('appid');
      const name = get('name');
      const installdir = get('installdir');
      if (!appid || !name || !installdir || STEAM_EXCLUDED.has(appid) || STEAM_EXCLUDED_NAME.test(name)) continue;
      const cdn = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}`;
      const local = localSteamImages(steamRoot, appid);
      const pt = playtimes.get(appid);
      games.push({
        id: `steam:${appid}`,
        source: 'steam',
        name,
        installDir: path.join(apps, 'common', installdir),
        sizeOnDisk: Number(get('SizeOnDisk') || 0),
        lastPlayed: Math.max(Number(get('LastPlayed') || 0) * 1000, pt?.lastPlayed || 0) || null,
        playtime: pt?.seconds || 0,
        launch: { type: 'steam', appid, url: `steam://rungameid/${appid}` },
        images: {
          cover: [...local.cover, `${cdn}/library_600x900.jpg`],
          hero: [...local.hero, `${cdn}/library_hero.jpg`],
          logo: [...local.logo, `${cdn}/logo.png`],
          header: [...local.header, `${cdn}/header.jpg`],
        },
      });
    }
  }
  return games;
}

function epicGames() {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.item')); } catch { return []; }
  const catalog = epicCatalog(path.dirname(dir));
  const games = [];
  for (const f of files) {
    let m;
    try { m = JSON.parse(readText(path.join(dir, f))); } catch { continue; }
    if (!m || m.bIsIncompleteInstall || !m.InstallLocation) continue;
    if (Array.isArray(m.AppCategories) && !m.AppCategories.includes('games')) continue;
    const cat = catalog.get(m.CatalogItemId);
    games.push({
      id: `epic:${m.AppName}`,
      source: 'epic',
      name: m.DisplayName,
      installDir: path.normalize(m.InstallLocation),
      sizeOnDisk: Number(m.InstallSize || 0),
      launch: {
        type: 'epic',
        url: `com.epicgames.launcher://apps/${m.CatalogNamespace}%3A${m.CatalogItemId}%3A${m.AppName}?action=launch&silent=true`,
      },
      ...epicMeta(cat),
    });
  }
  return games;
}

// Cache du catalogue du launcher Epic (Data/Catalog/catcache.bin : JSON encodé en base64)
function epicCatalog(dataDir) {
  const map = new Map();
  try {
    const raw = fs.readFileSync(path.join(dataDir, 'Catalog', 'catcache.bin'), 'utf8');
    for (const item of JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))) map.set(item.id, item);
  } catch {}
  return map;
}

// Images (redimensionnées par le CDN d'Epic) et infos tirées d'une entrée du catalogue
function epicMeta(cat) {
  if (!cat) return { images: {} };
  const img = (type, w) => {
    const k = (cat.keyImages || []).find((x) => x.type === type);
    return k ? [`${k.url}?w=${w}&resize=1`] : [];
  };
  const date = cat.releaseInfo?.find((r) => r.dateAdded)?.dateAdded;
  // Le cache d'Epic remplace les caractères accentués par « ? » : on écarte un texte abîmé
  const description = (cat.description || '').trim();
  const damaged = /\p{L}\?\p{L}/u.test(description);
  return {
    images: {
      cover: [...img('DieselGameBoxTall', 600), ...img('OfferImageTall', 600)],
      hero: [...img('DieselGameBox', 1920), ...img('OfferImageWide', 1920)],
      header: [...img('DieselGameBox', 920), ...img('OfferImageWide', 920)],
      logo: img('DieselGameBoxLogo', 640),
    },
    info: {
      description: damaged ? '' : description,
      developers: cat.developer ? [cat.developer] : [],
      releaseDate: date ? new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
      genres: [],
    },
  };
}

async function gogGames() {
  const out = await regQuery(['HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', '/s']);
  if (!out) return [];
  const games = [];
  for (const block of out.split(/\r?\n\r?\n/)) {
    const val = (k) => block.match(new RegExp(`^\\s+${k}\\s+REG_\\w+\\s+(.*)$`, 'mi'))?.[1]?.trim();
    const id = val('gameID');
    const name = val('gameName');
    const dir = val('path');
    if (!id || !name || !dir) continue;
    const exe = val('exe');
    games.push({
      id: `gog:${id}`,
      source: 'gog',
      name,
      installDir: path.normalize(dir),
      launch: exe ? { type: 'exe', exe, cwd: val('workingDir') || dir } : { type: 'url', url: `goggalaxy://openGameView/${id}` },
      images: {},
    });
  }
  return games;
}

function customGame(exe) {
  const id = 'custom:' + Buffer.from(exe.toLowerCase()).toString('base64url').slice(-24);
  return {
    id,
    source: 'custom',
    name: path.basename(exe, path.extname(exe)),
    installDir: path.dirname(exe),
    exe,
    launch: { type: 'exe', exe, cwd: path.dirname(exe) },
    images: {},
  };
}

// Jeux protégés par un anti-triche : on ne s'y attache pas (jeux en ligne, risque de bannissement).
// Recherche sur quelques niveaux : les jeux Unreal le rangent dans <Jeu>/Binaries/Win64/EasyAntiCheat.
const ANTICHEAT_NAME = /^(easyanticheat|battleye|eaanticheat|vanguard|beservice)/i;
function hasAntiCheat(installDir, maxDepth = 4, budget = { dirs: 3000 }) {
  let entries = [];
  try { entries = fs.readdirSync(installDir, { withFileTypes: true }); } catch { return false; }
  if (entries.some((e) => ANTICHEAT_NAME.test(e.name))) return true;
  if (maxDepth === 0) return false;
  for (const e of entries) {
    if (!e.isDirectory() || --budget.dirs < 0) continue;
    if (hasAntiCheat(path.join(installDir, e.name), maxDepth - 1, budget)) return true;
  }
  return false;
}

async function scanLibrary(customExes = []) {
  const uninstall = await uninstallEntries();
  const [steam, gog, ubisoft] = await Promise.all([steamGames(), gogGames(), ubisoftGames(uninstall)]);
  const all = [
    ...steam, ...epicGames(), ...gog, ...ubisoft, ...battlenetGames(uninstall), ...eaGames(uninstall),
    ...customExes.map(customGame),
  ];
  const seen = new Set();
  return all
    .filter((g) => !seen.has(g.id) && seen.add(g.id) && fs.existsSync(g.installDir))
    // Les jeux Battle.net sont en ligne et protégés côté serveur : toujours traités comme « anti-triche »
    .map((g) => ({ ...g, antiCheat: g.source === 'battlenet' || hasAntiCheat(g.installDir) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const EPIC_DATA = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data');

// Titres des jeux du compte Epic connus du launcher (installés ou non), en minuscules sans ponctuation
function epicOwnedTitles() {
  const titles = new Set();
  for (const item of epicCatalog(EPIC_DATA).values()) {
    if (item.categories?.some((c) => c.path === 'games')) titles.add(normalizeTitle(item.title));
  }
  return titles;
}

// Jeux du compte Epic d'après le catalogue local du launcher (ou celui lu sur le compte Epic) : jeux
// de base Windows uniquement (pas les DLC, extras ni versions de test). L'installation passe par le
// launcher Epic.
function ownedEpicGames(catalog = epicCatalog(EPIC_DATA).values()) {
  const games = [];
  for (const cat of catalog) {
    const paths = (cat.categories || []).map((c) => c.path);
    if (!paths.includes('games') || paths.some((p) => /^(addons|digitalextras|testing)/.test(p)) || cat.mainGameItem?.id) continue;
    const release = cat.releaseInfo?.find((r) => r.appId && r.platform?.some((p) => /^win/i.test(p)));
    if (!release) continue;
    games.push({
      id: `epic:${release.appId}`,
      source: 'epic',
      name: cat.title,
      launch: {
        type: 'epic',
        url: `com.epicgames.launcher://apps/${cat.namespace}%3A${cat.id}%3A${release.appId}?action=install`,
      },
      ...epicMeta(cat),
    });
  }
  return games;
}

// Jeux du compte d'après la base locale de GOG Galaxy (lecture seule) : GOG, et les comptes Ubisoft,
// EA et Battle.net que l'utilisateur a reliés à Galaxy. La liste suit la dernière synchro de Galaxy.
const GALAXY_DB = path.join(process.env.ProgramData || 'C:\\ProgramData', 'GOG.com', 'Galaxy', 'storage', 'galaxy-2.0.db');

// Plateforme Galaxy -> source Pimplay, identifiant et adresse d'installation
const GALAXY_PLATFORMS = {
  // Galaxy ouvre la fiche du jeu, d'où l'installation se lance
  gog: (id) => /^\d+$/.test(id) && { source: 'gog', id: `gog:${id}`, url: `goggalaxy://openGameView/${id}` },
  // Galaxy ne connaît que l'identifiant interne d'Ubisoft (GUID) : on ouvre Ubisoft Connect
  uplay: (id) => ({ source: 'ubisoft', id: `ubisoft:${id}`, url: 'uplay://' }),
  origin: (id) => ({ source: 'ea', id: `ea:${id}`, url: `origin2://game/launch?offerIds=${encodeURIComponent(id)}&autoDownload=1` }),
  battlenet: (id) => ({ source: 'battlenet', id: `battlenet:${id}`, url: BNET_CODES[id] ? `battlenet://${BNET_CODES[id]}` : 'battlenet://' }),
};
// Éditions d'essai, bêtas, démos, serveurs de test, bonus et entrées sans vrai nom
const NOT_A_GAME = /\b(trial|beta|demo|pts|playtest|test server)\b|digital goodies|soundtrack|artbook|^ubisoft game \d+$/i;

function ownedGalaxyGames() {
  if (!fs.existsSync(GALAXY_DB)) return [];
  let db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(GALAXY_DB, { readOnly: true });
    const piece = (type) => `(SELECT p.value FROM GamePieces p JOIN GamePieceTypes t ON t.id = p.gamePieceTypeId
      WHERE p.releaseKey = r.releaseKey AND t.type = '${type}' LIMIT 1)`;
    const rows = db.prepare(`SELECT DISTINCT r.releaseKey AS key, ${piece('title')} AS title, ${piece('originalImages')} AS images,
        ${piece('myFriendsActivity')} AS activity
      FROM LibraryReleases r LEFT JOIN ReleaseProperties rp ON rp.releaseKey = r.releaseKey
      WHERE (r.releaseKey LIKE 'gog\\_%' ESCAPE '\\' OR r.releaseKey LIKE 'uplay\\_%' ESCAPE '\\'
        OR r.releaseKey LIKE 'origin\\_%' ESCAPE '\\' OR r.releaseKey LIKE 'battlenet\\_%' ESCAPE '\\')
        AND IFNULL(rp.isDlc, 0) = 0 AND IFNULL(rp.isVisibleInLibrary, 1) = 1`).all();
    const json = (s) => { try { return JSON.parse(s) || {}; } catch { return {}; } };
    // Un même jeu peut exister en deux éditions (achat GOG + code Prime Gaming…) : une seule carte
    // par plateforme, de préférence celle qui a une jaquette
    const byName = new Map();
    for (const r of rows) {
      const sep = r.key.indexOf('_');
      const target = GALAXY_PLATFORMS[r.key.slice(0, sep)]?.(r.key.slice(sep + 1));
      // « - Amazon Prime » (codes Prime Gaming), « - (EAST EU) - PC - WW (Origin) » (éditions EA)
      const name = json(r.title).title?.replace(/\s+-\s+(Amazon Prime$|\().*$/i, '').trim();
      if (!target || !name || NOT_A_GAME.test(name)) continue;
      const img = json(r.images);
      // Temps de jeu et dernière partie connus de Galaxy (synchronisés depuis la plateforme)
      const mine = json(r.activity).items?.flatMap((i) => i.game_releases || []).find((g) => g.release_per_platform_id === r.key);
      const game = {
        id: target.id,
        source: target.source,
        name,
        playtime: (mine?.game_time?.time_sum || 0) * 60,
        lastPlayed: mine?.last_played_date ? mine.last_played_date * 1000 : null,
        launch: { type: 'url', url: target.url },
        images: { cover: img.verticalCover ? [img.verticalCover] : [], hero: img.background ? [img.background] : [] },
      };
      const key = `${target.source}:${normalizeTitle(name)}`;
      if (!byName.has(key) || (!byName.get(key).images.cover.length && game.images.cover.length)) byName.set(key, game);
    }
    return [...byName.values()];
  } catch {
    return []; // Galaxy absent, base verrouillée ou format inattendu
  } finally {
    db?.close();
  }
}

const normalizeTitle = (s = '') => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

module.exports = { scanLibrary, customGame, hasAntiCheat, findLaunchers, epicOwnedTitles, normalizeTitle, ownedEpicGames, ownedGalaxyGames };
