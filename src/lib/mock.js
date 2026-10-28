// API factice pour prévisualiser l'interface dans un navigateur (hors Electron).
const steam = (appid, name, extra = {}) => {
  const cdn = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}`;
  return {
    id: `steam:${appid}`, source: 'steam', name, installDir: `D:\\Steam\\steamapps\\common\\${name}`,
    sizeOnDisk: Math.round(Math.random() * 60e9), launch: { type: 'url' }, cheatCount: 0, favorite: false, running: false,
    images: { cover: `${cdn}/library_600x900.jpg`, hero: `${cdn}/library_hero.jpg`, logo: `${cdn}/logo.png`, header: `${cdn}/header.jpg` },
    ...extra,
  };
};

const now = Date.now();
const library = [
  steam(1903340, 'Clair Obscur: Expedition 33', { lastPlayed: now - 3600e3 * 5, cheatCount: 4, running: true, favorite: true, playtime: 41 * 3600 + 1200, playtimeSource: 'steam' }),
  steam(1145360, 'Hades', { lastPlayed: now - 86400e3 * 2, cheatCount: 2, playtime: 7 * 3600 + 900, playtimeSource: 'steam' }),
  steam(413150, 'Stardew Valley', { lastPlayed: now - 86400e3 * 9, favorite: true }),
  steam(292030, 'The Witcher 3: Wild Hunt'),
  steam(1086940, "Baldur's Gate 3", { lastPlayed: now - 86400e3 * 20 }),
  steam(367520, 'Hollow Knight'),
  steam(105600, 'Terraria'),
  steam(1245620, 'ELDEN RING', { antiCheat: true }),
  { id: 'epic:Fortnite', source: 'epic', name: 'Hogwarts Legacy', installDir: 'C:\\Epic\\Hogwarts', images: {}, cheatCount: 0, playtime: 1500, playtimeSource: 'pimplay' },
  { id: 'custom:abc', source: 'custom', name: 'Mon jeu indé', installDir: 'C:\\Games\\Indie', images: {}, cheatCount: 0 },
  // Jeu dont seule une image horizontale existe : affichée entière sur fond flouté
  { id: 'custom:wide', source: 'custom', name: 'Jeu sans jaquette', installDir: 'C:\\Games\\Wide', images: { header: ['https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/header.jpg'] }, cheatCount: 0 },
];

const trainers = {
  'steam:1903340': {
    process: 'SandFall-Win64-Shipping.exe',
    cheats: [
      { id: 'a', name: 'Santé infinie', category: 'Joueur', kind: 'freeze', valueType: 'float', value: 9999, hotkey: 'F1', target: { module: 'SandFall-Win64-Shipping.exe', offset: '0x6F1A2B0', pointers: ['0x30', '0x2A8', '0x1C4'] } },
      { id: 'b', name: 'Points d’action infinis', category: 'Joueur', kind: 'patch', patch: '90 90 90 90 90 90', hotkey: 'F2', target: { aob: '29 83 ?? ?? 00 00 8B 45', module: 'SandFall-Win64-Shipping.exe' } },
      { id: 'c', name: 'Définir les Chroma', category: 'Inventaire', kind: 'slider', valueType: 'int32', value: 50000, min: 0, max: 999999, step: 1000, hotkey: '', target: { address: '0x2A4F1C3D8' } },
      { id: 'd', name: 'Ajouter 10 000 Chroma', category: 'Inventaire', kind: 'button', op: 'add', valueType: 'int32', value: 10000, hotkey: 'Ctrl+F3', target: { address: '0x2A4F1C3D8' } },
    ],
  },
};

let session = { gameId: null, attached: false, pid: null, exe: null, is32: null, error: null, cheats: {} };
const listeners = {};
const emit = (ch, p) => (listeners[ch] || []).forEach((cb) => cb(p));
const setSession = (patch) => { session = { ...session, ...patch }; emit('session', session); };
const ok = (v) => Promise.resolve(structuredClone(v));

let scanCount = 0;

// Historique factice : quelques parties par jour sur ~13 mois, pseudo-aléatoire mais stable
function fakeSessions() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const ids = ['steam:1903340', 'steam:1145360', 'steam:413150', 'epic:Fortnite', 'steam:1086940'];
  const out = [];
  const day = 24 * 3600e3;
  for (let d = 400; d >= 0; d--) {
    if (rnd() < 0.35) continue;
    const n = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) {
      const s = now - d * day + (18 + rnd() * 4) * 3600e3 - 12 * 3600e3;
      out.push({ g: ids[Math.floor(rnd() * (d < 30 ? 3 : ids.length))], s, e: s + (15 + rnd() * 150) * 60e3 });
    }
  }
  out.push({ g: 'steam:1903340', s: now - 45 * 60e3, e: now, live: true });
  return out.filter((x) => x.e <= now);
}
const settings = { hotkeysEnabled: true };

export function installMock() {
  window.pimplay = {
    library: {
      // ?lent dans l'URL : simule une analyse longue pour voir l'écran de chargement
      list: () => (location.search.includes('lent') ? new Promise((r) => setTimeout(() => r(structuredClone(library)), 4000)) : ok(library)),
      refresh: () => ok(library),
      addCustom: () => ok(null),
      removeCustom: () => ok(library),
      favorite: (id, on) => { library.find((g) => g.id === id).favorite = on; return ok(library); },
      hide: (id, on) => { library.find((g) => g.id === id).hidden = on; return ok(library); },
      owned: () => ok([]),
      install: () => ok(),
    },
    meta: {
      search: (term) => ok([
        { id: '990080', name: 'Hogwarts Legacy', image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/990080/capsule_231x87.jpg' },
        { id: '1245620', name: `${term} — autre résultat`, image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1245620/capsule_231x87.jpg' },
      ]),
      link: (id, appid) => {
        const g = library.find((x) => x.id === id);
        const cdn = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}`;
        Object.assign(g, {
          name: 'Hogwarts Legacy',
          images: { cover: [`${cdn}/library_600x900_2x.jpg`], hero: [`${cdn}/library_hero.jpg`], logo: [`${cdn}/logo.png`], header: [`${cdn}/header.jpg`] },
          info: { steamAppId: appid, description: 'Hogwarts Legacy est un RPG d’action immersif en monde ouvert.', developers: ['Avalanche Software'], releaseDate: '10 févr. 2023', genres: ['Action', 'Aventure', 'RPG'] },
          meta: { steamAppId: appid, steamName: 'Hogwarts Legacy', customName: null, customCover: false },
        });
        return ok(library);
      },
      unlink: () => ok(library),
      rename: (id, name) => { const g = library.find((x) => x.id === id); g.name = name || g.meta?.steamName || g.name; g.meta = { ...g.meta, customName: name || null }; return ok(library); },
      setImage: () => ok(null),
      clearImage: () => ok(library),
      setHeroPosition: (id, pct) => { const g = library.find((x) => x.id === id); g.meta = { ...g.meta, heroPosition: pct }; return ok(library); },
    },
    game: {
      launch: (id) => {
        const base = { gameId: id, kind: 'steam', startedAt: Date.now() };
        emit('launch', { ...base, stage: 'launcher' });
        setTimeout(() => emit('launch', { ...base, stage: 'starting' }), 2500);
        setTimeout(() => emit('launch', { ...base, stage: 'running' }), 5000);
        return ok(true);
      },
      launchState: () => ok(null),
      // Fermeture propre qui « échoue » (pour voir l'étape d'arrêt forcé), arrêt forcé qui réussit
      stop: (id, force) => {
        if (force) {
          library.find((g) => g.id === id).running = false;
          setTimeout(() => emit('running', library.filter((g) => g.running).map((g) => ({ gameId: g.id, pid: 1 }))), 300);
          return ok({ running: true, killed: 1 });
        }
        return ok({ running: true, windows: 0 });
      },
      openFolder: () => ok(),
    },
    trainer: {
      get: (id) => ok(trainers[id] || { process: '', cheats: [] }),
      save: (id, t) => { trainers[id] = t; return ok(t); },
      import: () => ok(null),
      export: () => ok(true),
    },
    session: {
      activate: (id) => {
        const t = trainers[id] || { cheats: [] };
        const g = library.find((x) => x.id === id);
        setSession({
          gameId: id, attached: !!g.running, pid: g.running ? 18244 : null, exe: g.running ? t.process || 'game.exe' : null, is32: false,
          cheats: Object.fromEntries(t.cheats.map((c) => [c.id, { enabled: false, value: c.value, current: c.valueType ? 1234 : null, error: null }])),
        });
        return ok(session);
      },
      deactivate: () => { setSession({ gameId: null, attached: false, cheats: {} }); return ok(session); },
      state: () => ok(session),
    },
    cheat: {
      toggle: (id, on) => { setSession({ cheats: { ...session.cheats, [id]: { ...session.cheats[id], enabled: on } } }); return ok(); },
      setValue: (id, v) => { setSession({ cheats: { ...session.cheats, [id]: { ...session.cheats[id], value: Number(v) } } }); return ok(); },
      trigger: () => ok(),
    },
    stats: {
      sessions: () => ok({ sessions: fakeSessions(), since: now - 400 * 24 * 3600e3 }),
      lifetime: () => ok({ games: [], total: 0, bySource: [], galaxy: false }),
    },
    epic: { freeGames: () => ok([]), openStore: () => ok(), account: () => ok(null), refresh: () => ok(null), login: () => ok(null), logout: () => ok(null) },
    gog: {
      account: () => ok(null), refresh: () => ok(null), login: () => ok(null), logout: () => ok(null),
      browserLogin: () => ok(), submitCode: () => Promise.reject(new Error('Aperçu : connexion indisponible')),
    },
    steam: { account: () => ok(null), refresh: () => ok(null), login: () => ok(null), logout: () => ok(null) },
    process: {
      list: () => ok([
        { pid: 18244, name: 'SandFall-Win64-Shipping.exe', path: 'D:\\Steam\\...', gameId: 'steam:1903340' },
        { pid: 9120, name: 'Discord.exe', path: 'C:\\...' },
        { pid: 4412, name: 'chrome.exe', path: 'C:\\...' },
        { pid: 7781, name: 'steam.exe', path: 'D:\\Steam\\steam.exe' },
      ]),
    },
    scanner: {
      attach: (pid) => ok({ pid, exe: 'SandFall-Win64-Shipping.exe', is32: false, gameId: 'steam:1903340' }),
      first: () => { scanCount = 1; return ok({ count: 18452, scanCount: 1, type: 'int32', truncated: false }); },
      next: () => { scanCount++; return ok({ count: scanCount > 2 ? 3 : 41, scanCount, type: 'int32', truncated: false }); },
      cancel: () => ok(),
      reset: () => { scanCount = 0; return ok(); },
      results: () => ok(Array.from({ length: scanCount > 2 ? 3 : 12 }, (_, i) => ({
        address: '0x' + (0x2a4f1c3d8 + i * 0x1f0).toString(16).toUpperCase(),
        value: 2450, previous: i === 0 ? 2450 : 2500,
        module: i === 1 ? { name: 'SandFall-Win64-Shipping.exe', offset: '0x6F1A2B0' } : null,
      }))),
      write: () => ok(true),
      writeAll: () => ok(3),
    },
    watch: {
      start: (addresses) => {
        const snap = { state: 'running', error: null, targets: addresses, hits: [] };
        setTimeout(() => emit('watch:update', {
          ...snap,
          hits: [
            { id: '1', address: '0x7FF6A1B2C3D4', module: { name: 'enshrouded.exe', offset: '0x1B2C3D4' }, text: 'mov [rbx+10h],eax', length: 3, bytes: '89 43 10', next: ['mov rcx,rbx', 'call 00007FF6A1B00010h'], count: 3, targets: [0, 2] },
            { id: '2', address: '0x7FF6A1B9F000', module: { name: 'enshrouded.exe', offset: '0x1B9F000' }, text: 'movups [rdx],xmm0', length: 3, bytes: '0F 11 02', next: ['ret'], count: 1, targets: [1, 3] },
          ],
        }), 1200);
        return ok(snap);
      },
      stop: () => ok(null),
      patch: () => ok({ name: 'Bloquer « mov [rbx+10h],eax »', module: 'enshrouded.exe', offset: '0x1B2C3D4', aob: '89 43 10 48 8B CB E8 ?? ?? ?? ??', unique: true, patch: '90 90 90', text: 'mov [rbx+10h],eax' }),
    },
    settings: { get: () => ok(settings), set: (p) => ok(Object.assign(settings, p)) },
    app: { openData: () => ok(), closeChoice: () => ok(), fullscreen: () => ok(), info: () => ok({ version: '0.2.0', electron: 'aperçu', admin: false }) },
    update: { state: () => ok({ status: 'dev' }), check: () => ok({ status: 'dev' }), install: () => ok() },
    on(ch, cb) {
      (listeners[ch] ||= []).push(cb);
      return () => { listeners[ch] = listeners[ch].filter((x) => x !== cb); };
    },
  };
}
