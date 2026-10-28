// Temps de jeu Steam : userdata/<compte>/config/localconfig.vdf (Playtime en minutes, LastPlayed en secondes).
const fs = require('node:fs');
const path = require('node:path');

// Analyseur VDF (format clé/valeur de Valve) : chaînes entre guillemets et blocs { }
function parseVdf(text) {
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}]/g) || [];
  let i = 0;
  const unquote = (t) => t.slice(1, -1).replace(/\\(.)/g, '$1');
  function block() {
    const obj = {};
    while (i < tokens.length) {
      const t = tokens[i++];
      if (t === '}') return obj;
      const key = unquote(t);
      const next = tokens[i++];
      obj[key] = next === '{' ? block() : unquote(next ?? '""');
    }
    return obj;
  }
  return block();
}

// Accès insensible à la casse (Valve n'est pas constant : "Steam" / "steam", "apps" / "Apps")
const get = (obj, ...keys) => keys.reduce((o, k) => {
  if (!o || typeof o !== 'object') return undefined;
  const hit = Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase());
  return hit === undefined ? undefined : o[hit];
}, obj);

// appid -> { seconds, lastPlayed (ms) }, additionné sur tous les comptes Steam du PC
function steamPlaytimes(steamRoot) {
  const out = new Map();
  let users = [];
  try { users = fs.readdirSync(path.join(steamRoot, 'userdata')); } catch { return out; }
  for (const u of users) {
    let text;
    try { text = fs.readFileSync(path.join(steamRoot, 'userdata', u, 'config', 'localconfig.vdf'), 'utf8'); } catch { continue; }
    const apps = get(parseVdf(text), 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps');
    if (!apps) continue;
    for (const [appid, a] of Object.entries(apps)) {
      const minutes = Number(get(a, 'Playtime') || 0);
      const last = Number(get(a, 'LastPlayed') || 0) * 1000;
      if (!minutes && !last) continue;
      const cur = out.get(appid) || { seconds: 0, lastPlayed: 0 };
      cur.seconds += minutes * 60;
      cur.lastPlayed = Math.max(cur.lastPlayed, last);
      out.set(appid, cur);
    }
  }
  return out;
}

module.exports = { parseVdf, steamPlaytimes };
