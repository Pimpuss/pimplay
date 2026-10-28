// Temps de jeu « depuis toujours », toutes plateformes : les launchers ne gardent qu'un total et une
// date de dernière partie par jeu (pas de sessions). Sources, de la plus précise à la plus large :
//  - la bibliothèque Pimplay (Steam local + temps suivi par Pimplay) et les jeux possédés non installés ;
//  - Steam : localconfig.vdf de chaque compte du PC (jeux désinstallés compris) ;
//  - GOG Galaxy : totaux synchronisés depuis GOG, Steam, Epic, Ubisoft, EA, Battle.net, Xbox, PlayStation.
// Pour un même jeu sur une même plateforme, on garde le plus grand total connu (jamais de double compte) ;
// d'une plateforme à l'autre (deux achats distincts), les temps s'additionnent.
const fs = require('node:fs');
const path = require('node:path');
const { regValue } = require('./registry.cjs');
const { steamPlaytimes } = require('./playtime.cjs');
const { normalizeTitle } = require('./games.cjs');

const GALAXY_DB = path.join(process.env.ProgramData || 'C:\\ProgramData', 'GOG.com', 'Galaxy', 'storage', 'galaxy-2.0.db');
const GALAXY_SOURCES = {
  steam: 'steam', gog: 'gog', epic: 'epic', uplay: 'ubisoft', origin: 'ea', battlenet: 'battlenet', xboxone: 'xbox', psn: 'playstation',
};
const STEAM_CDN = (appid) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}`;

// releaseKey -> { id, source, name, seconds, lastPlayed, cover }
function galaxyTimes() {
  if (!fs.existsSync(GALAXY_DB)) return [];
  let db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(GALAXY_DB, { readOnly: true });
    const piece = (type) => `(SELECT p.value FROM GamePieces p JOIN GamePieceTypes t ON t.id = p.gamePieceTypeId
      WHERE p.releaseKey = g.releaseKey AND t.type = '${type}' LIMIT 1)`;
    const rows = db.prepare(`SELECT g.releaseKey AS key, MAX(g.minutesInGame) AS minutes,
        (SELECT MAX(l.lastPlayedDate) FROM LastPlayedDates l WHERE l.gameReleaseKey = g.releaseKey) AS last,
        ${piece('title')} AS title, ${piece('originalImages')} AS images
      FROM GameTimes g GROUP BY g.releaseKey HAVING MAX(g.minutesInGame) > 0`).all();
    const json = (s) => { try { return JSON.parse(s) || {}; } catch { return {}; } };
    return rows.flatMap((r) => {
      const sep = r.key.indexOf('_');
      const source = GALAXY_SOURCES[r.key.slice(0, sep)];
      const name = json(r.title).title?.replace(/\s+-\s+(Amazon Prime$|\().*$/i, '').trim();
      if (!source || !name) return [];
      const ext = r.key.slice(sep + 1);
      const id = { ubisoft: `ubisoft:${ext}`, ea: `ea:${ext}`, xbox: `xbox:${ext}`, playstation: `playstation:${ext}` }[source] || `${source}:${ext}`;
      const last = r.last ? Date.parse(r.last) : NaN;
      return [{
        id,
        source,
        name,
        seconds: Number(r.minutes) * 60,
        lastPlayed: Number.isFinite(last) ? last : null,
        cover: json(r.images).verticalCover || (source === 'steam' ? `${STEAM_CDN(ext)}/library_600x900.jpg` : null),
      }];
    });
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

// Noms et type des applications Steam inconnues (jeu ou logiciel), mis en cache
async function fetchSteamNames(appids, cache) {
  const todo = appids.filter((a) => !cache[a]);
  for (let i = 0; i < todo.length; i += 100) {
    const input = { ids: todo.slice(i, i + 100).map((appid) => ({ appid: Number(appid) })), context: { language: 'french', country_code: 'FR' } };
    try {
      const res = await fetch(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`);
      const items = res.ok ? (await res.json()).response?.store_items || [] : [];
      for (const it of items) cache[String(it.appid)] = { name: it.name || null, type: it.type ?? null };
    } catch {
      break; // hors ligne : on réessaiera au prochain affichage
    }
  }
}

// games : jeux installés et possédés, déjà décorés (id, source, name, playtime, lastPlayed, images)
async function lifetimeStats({ games, hidden, steamNames }) {
  const entries = new Map(); // id -> entrée par plateforme
  const add = (e) => {
    if (!e.seconds && !e.lastPlayed) return;
    const cur = entries.get(e.id);
    if (!cur) { entries.set(e.id, { ...e }); return; }
    cur.seconds = Math.max(cur.seconds, e.seconds || 0);
    cur.lastPlayed = Math.max(cur.lastPlayed || 0, e.lastPlayed || 0) || null;
    cur.name ||= e.name;
    cur.game ||= e.game;
    cur.cover ||= e.cover;
  };

  for (const g of games) {
    add({ id: g.id, source: g.source, name: g.name, seconds: g.playtime || 0, lastPlayed: g.lastPlayed || null, game: g });
  }
  for (const e of galaxyTimes()) add(e);

  const root = (await regValue('HKCU\\Software\\Valve\\Steam', 'SteamPath').catch(() => null))
    || (await regValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath').catch(() => null));
  const steam = root ? steamPlaytimes(path.normalize(root)) : new Map();
  await fetchSteamNames([...steam.keys()].filter((a) => !entries.has(`steam:${a}`)), steamNames);
  for (const [appid, pt] of steam) {
    const known = entries.get(`steam:${appid}`);
    const info = steamNames[appid];
    // Logiciels, outils et serveurs dédiés : hors statistiques de jeu
    if (!known && (!info?.name || (info.type != null && info.type !== 0))) continue;
    add({
      id: `steam:${appid}`, source: 'steam', name: known?.name || info.name, seconds: pt.seconds, lastPlayed: pt.lastPlayed || null,
      cover: `${STEAM_CDN(appid)}/library_600x900.jpg`,
    });
  }

  // Un même jeu sur plusieurs plateformes (achats distincts) : une ligne, temps additionnés ; sur une
  // même plateforme (éditions, identifiants différents selon la source), le plus grand total
  const groups = new Map();
  for (const e of entries.values()) {
    if (hidden.has(e.id) || !e.name) continue;
    const key = normalizeTitle(e.name);
    if (!key) continue;
    const grp = groups.get(key) || { key, name: e.name, perSource: {}, lastPlayed: null, game: null, cover: null };
    grp.perSource[e.source] = Math.max(grp.perSource[e.source] || 0, e.seconds || 0);
    grp.lastPlayed = Math.max(grp.lastPlayed || 0, e.lastPlayed || 0) || null;
    // Fiche Pimplay de préférence : jeu installé, sinon possédé
    if (e.game && (!grp.game || grp.game.installed === false)) grp.game = e.game;
    grp.cover ||= e.cover;
    groups.set(key, grp);
  }

  const bySource = {};
  const list = [...groups.values()].map((g) => {
    const seconds = Object.values(g.perSource).reduce((a, b) => a + b, 0);
    for (const [s, v] of Object.entries(g.perSource)) bySource[s] = (bySource[s] || 0) + v;
    return {
      key: g.key,
      name: g.game?.name || g.name,
      seconds,
      lastPlayed: g.lastPlayed,
      sources: Object.entries(g.perSource).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([s]) => s),
      perSource: g.perSource,
      gameId: g.game && g.game.installed !== false ? g.game.id : null,
      // Objet minimal pour afficher une jaquette (Cover)
      cover: g.game
        ? { id: g.game.id, name: g.game.name, source: g.game.source, images: g.game.images, meta: g.game.meta }
        : { id: `lifetime:${g.key}`, name: g.name, source: Object.keys(g.perSource)[0], images: { cover: g.cover ? [g.cover] : [] } },
    };
  }).filter((g) => g.seconds > 0).sort((a, b) => b.seconds - a.seconds);

  return {
    games: list,
    total: list.reduce((a, g) => a + g.seconds, 0),
    bySource: Object.entries(bySource).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]),
    galaxy: fs.existsSync(GALAXY_DB),
  };
}

module.exports = { lifetimeStats };
