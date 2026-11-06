// Détection des jeux Ubisoft Connect, Battle.net et EA app.
const fs = require('node:fs');
const path = require('node:path');
const { regTree } = require('./registry.cjs');

const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };
const clean = (p) => (p ? path.normalize(p.replace(/^"|"$/g, '')) : null);

// ---------- Ubisoft Connect ----------
// HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs\<id> (valeur InstallDir) ; lancement uplay://launch/<id>/0
async function ubisoftGames(uninstall) {
  const installs = await regTree('HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs');
  const games = [];
  for (const k of installs) {
    const id = k.name;
    const dir = clean(k.values.InstallDir);
    if (!/^\d+$/.test(id) || !exists(dir)) continue; // entrées vides = restes de désinstallation
    const entry = uninstall.find((e) => e.name === `Uplay Install ${id}`);
    games.push({
      id: `ubisoft:${id}`,
      source: 'ubisoft',
      name: entry?.values.DisplayName || path.basename(dir),
      installDir: dir,
      launch: { type: 'ubisoft', url: `uplay://launch/${id}/0` },
      images: {},
    });
  }
  return games;
}

// ---------- Battle.net ----------
// Entrées de désinstallation Blizzard : --uid=<produit> ; lancement Battle.net.exe --exec="launch <code>"
const BNET_CODES = {
  wow: 'WoW', wowf: 'WoWF', wow_classic: 'WoWC',wow_classic_era: 'WoWC', d3: 'D3', diablo3: 'D3', fenris: 'Fen', osi: 'OSI',
  anbs: 'ANBS', prometheus: 'Pro', s1: 'S1', s2: 'S2', hero: 'Hero', heroes: 'Hero', hs_beta: 'WTCG', w3: 'W3', rtro: 'RTRO',
  viper: 'VIPR', odin: 'ODIN', lazarus: 'LAZR', zeus: 'ZEUS', fore: 'FORE', auks: 'AUKS', gryphon: 'GRY',
};

// Battle.net démarré à froid lit bien « --exec=launch <code> », mais se contente de sélectionner le
// jeu : il faut renvoyer la commande une fois connecté. On guette ce moment dans son journal
// (%LOCALAPPDATA%\Battle.net\Logs\battle.net-<date>.log). Renvoie true si prêt, false au bout du délai.
const BNET_READY = /Selecting game family by id|Logged into Battle\.net successfully/;
async function waitBattlenetReady(since, timeoutMs = 90000) {
  const dir = path.join(process.env.LOCALAPPDATA || '', 'Battle.net', 'Logs');
  while (Date.now() - since < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const logs = fs.readdirSync(dir).filter((f) => /^battle\.net-.*\.log$/i.test(f))
        .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
        .filter((l) => l.t >= since - 2000)
        .sort((a, b) => b.t - a.t);
      if (logs[0] && BNET_READY.test(fs.readFileSync(path.join(dir, logs[0].f), 'utf8'))) return true;
    } catch {
      // dossier absent ou journal en cours d'écriture : on réessaie
    }
  }
  return false;
}

function battlenetExe(uninstall) {
  const e = uninstall.find((x) => /--uid=battle\.net\b/i.test(x.values.UninstallString || ''));
  return e?.values.InstallLocation ? path.join(clean(e.values.InstallLocation), 'Battle.net.exe') : null;
}

// Versions d'un jeu installées dans le même dossier (World of Warcraft : _retail_, _forever_,
// _classic_era_…) : une seule entrée de désinstallation, mais un produit Battle.net chacune.
// .build.info liste les produits installés ; .product.db (protobuf) donne le sous-dossier de chacun.
const FLAVOR_NAMES = {
  wow: 'World of Warcraft',
  wowf: 'World of Warcraft Forever',
  wow_classic: 'World of Warcraft Classic',
  wow_classic_era: 'World of Warcraft Classic Era',
  wow_anniversary: 'World of Warcraft Classic Anniversary',
  wowt: 'World of Warcraft PTR',
  wow_beta: 'World of Warcraft Bêta',
};

function bnetFlavors(dir) {
  let info, db;
  try {
    info = fs.readFileSync(path.join(dir, '.build.info'), 'utf8');
    db = fs.readFileSync(path.join(dir, '.product.db')).toString('latin1');
  } catch {
    return [];
  }
  const [head, ...rows] = info.split(/\r?\n/).filter(Boolean);
  const col = head.split('|').findIndex((c) => /^Product!/i.test(c));
  if (col < 0) return [];
  const products = [...new Set(rows.map((r) => r.split('|')[col]).filter(Boolean))];
  // Chaînes lisibles de .product.db, dans l'ordre : « <uid> <uid> <dossier> … _forever_ … »
  const strings = db.match(/[\x20-\x7e]{3,}/g) || [];
  const out = [];
  for (const uid of products) {
    const at = strings.findIndex((s, i) => s === uid && strings[i + 1] === uid);
    const sub = at < 0 ? null : strings.slice(at + 2, at + 12).map((s) => s.match(/^(_\w+_)"?$/)?.[1]).find(Boolean);
    if (sub && exists(path.join(dir, sub))) out.push({ uid, dir: path.join(dir, sub) });
  }
  return out;
}

function battlenetGames(uninstall) {
  const games = [];
  for (const e of uninstall) {
    const v = e.values;
    const uid = (v.UninstallString || '').match(/--uid=([\w.-]+)/i)?.[1]?.toLowerCase();
    if (!uid || uid === 'battle.net' || !/Blizzard Uninstaller/i.test(v.UninstallString)) continue;
    const dir = clean(v.InstallLocation);
    if (!exists(dir)) continue;
    const code = BNET_CODES[uid] || null;
    const flavors = bnetFlavors(dir);
    if (flavors.length > 1) {
      // Un jeu par version, lancé par son code produit (« launch WoWF ») : Battle.net ouvre la bonne
      // version, déjà connecté au compte. Sans code connu, « launch_uid » sélectionne au moins la version
      // dans Battle.net. La version principale garde l'identifiant historique (temps de jeu, images)
      for (const f of flavors) {
        games.push({
          id: `battlenet:${f.uid}`,
          source: 'battlenet',
          name: FLAVOR_NAMES[f.uid] || `${v.DisplayName} (${path.basename(f.dir).replace(/_/g, ' ').trim()})`,
          installDir: f.dir,
          launch: { type: 'battlenet', uid: f.uid, code: BNET_CODES[f.uid] || null, url: 'battlenet://' },
          images: {},
        });
      }
      continue;
    }
    games.push({
      id: `battlenet:${uid}`,
      source: 'battlenet',
      name: v.DisplayName,
      installDir: dir,
      launch: { type: 'battlenet', code, url: code ? `battlenet://${code}` : 'battlenet://' },
      images: {},
    });
  }
  return games;
}

// ---------- EA app ----------
// Entrées de désinstallation des jeux EA (EAInstaller / __Installer) ; offerId lu dans __Installer\installerdata.xml
function eaGames(uninstall) {
  const games = [];
  for (const e of uninstall) {
    const v = e.values;
    const dir = clean(v.InstallLocation);
    if (!exists(dir)) continue;
    const xml = path.join(dir, '__Installer', 'installerdata.xml');
    const isEa = /EAInstaller|__Installer/i.test(v.UninstallString || '') || exists(xml);
    if (!isEa || /^EA app$/i.test(v.DisplayName)) continue;
    let ids = [];
    try { ids = [...fs.readFileSync(xml, 'utf8').matchAll(/<contentID>\s*([^<\s]+)\s*<\/contentID>/gi)].map((m) => m[1]); } catch {}
    const exe = clean((v.DisplayIcon || '').replace(/,\s*-?\d+$/, ''));
    games.push({
      id: `ea:${ids[0] || e.name}`,
      source: 'ea',
      name: v.DisplayName,
      installDir: dir,
      launch: ids.length
        ? { type: 'ea', url: `origin2://game/launch?offerIds=${ids.join(',')}&autoDownload=1` }
        : { type: 'exe', exe, cwd: dir },
      images: {},
    });
  }
  return games.filter((g) => g.launch.url || exists(g.launch.exe));
}

module.exports = { ubisoftGames, battlenetGames, eaGames, battlenetExe, waitBattlenetReady, BNET_CODES };
