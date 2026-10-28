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
  wow: 'WoW', wow_classic: 'WoWC', wow_classic_era: 'WoWC', d3: 'D3', diablo3: 'D3', fenris: 'Fen', osi: 'OSI',
  anbs: 'ANBS', prometheus: 'Pro', s1: 'S1', s2: 'S2', hero: 'Hero', heroes: 'Hero', hs_beta: 'WTCG', w3: 'W3', rtro: 'RTRO',
  viper: 'VIPR', odin: 'ODIN', lazarus: 'LAZR', zeus: 'ZEUS', fore: 'FORE', auks: 'AUKS', gryphon: 'GRY',
};

function battlenetExe(uninstall) {
  const e = uninstall.find((x) => /--uid=battle\.net\b/i.test(x.values.UninstallString || ''));
  return e?.values.InstallLocation ? path.join(clean(e.values.InstallLocation), 'Battle.net.exe') : null;
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

module.exports = { ubisoftGames, battlenetGames, eaGames, battlenetExe, BNET_CODES };
