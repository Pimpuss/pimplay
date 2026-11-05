// Métadonnées pour les jeux hors Steam (perso, Epic, GOG) : association à une fiche Steam,
// nom personnalisé et jaquette depuis un fichier. Tout est mis en cache dans le store.
const path = require('node:path');

const STORE = 'https://store.steampowered.com/api';
const ASSETS = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps';
const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'Accept-Language': 'fr-FR,fr;q=0.9' } });
  if (!res.ok) throw new Error(`Steam a répondu ${res.status}`);
  return res.json();
}

async function searchSteam(term) {
  const q = String(term || '').trim();
  if (!q) return [];
  const data = await getJson(`${STORE}/storesearch/?term=${encodeURIComponent(q)}&l=french&cc=FR`);
  return (data.items || []).slice(0, 12).map((i) => ({ id: String(i.id), name: i.name, image: i.tiny_image }));
}

async function steamDetails(appid) {
  const data = await getJson(`${STORE}/appdetails?appids=${encodeURIComponent(appid)}&l=french`);
  const d = data?.[appid]?.data;
  if (!data?.[appid]?.success || !d) throw new Error('Fiche Steam introuvable.');
  return {
    steamAppId: String(appid),
    name: d.name,
    description: d.short_description || '',
    developers: d.developers || [],
    publishers: d.publishers || [],
    releaseDate: d.release_date?.date || '',
    genres: (d.genres || []).map((g) => g.description),
    header: d.header_image || null,
    background: d.background_raw || null,
  };
}

// Visuels officiels (chemins hachés des jeux récents) via IStoreBrowseService, par lots
async function fetchSteamAssets(appids) {
  const out = {};
  for (let i = 0; i < appids.length; i += 50) {
    const ids = appids.slice(i, i + 50).map((a) => ({ appid: Number(a) }));
    const input = { ids, context: { language: 'french', country_code: 'FR' }, data_request: { include_assets: true } };
    const data = await getJson(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`);
    for (const it of data.response?.store_items || []) {
      const a = it.assets;
      if (!a?.asset_url_format) continue;
      const url = (f) => f && `https://shared.akamai.steamstatic.com/store_item_assets/${a.asset_url_format.replace('${FILENAME}', f)}`;
      out[String(it.appid)] = {
        cover: [url(a.library_capsule_2x), url(a.library_capsule)].filter(Boolean),
        hero: [url(a.library_hero_2x), url(a.library_hero)].filter(Boolean),
        header: [url(a.header_2x), url(a.header)].filter(Boolean),
        fetchedAt: Date.now(),
      };
    }
    for (const { appid } of ids) out[String(appid)] ||= { cover: [], hero: [], header: [], fetchedAt: Date.now() };
  }
  return out;
}

// Insère les visuels officiels après les images locales (cache Steam, jaquette perso) et avant les URL génériques
function withAssets(game, assets) {
  if (!assets) return game;
  const images = { ...game.images };
  for (const k of ['cover', 'hero', 'header']) {
    const list = [].concat(images[k] || []);
    const local = list.filter((u) => u.startsWith('pimplay-img:'));
    images[k] = [...new Set([...local, ...(assets[k] || []), ...list.filter((u) => !u.startsWith('pimplay-img:'))])];
  }
  return { ...game, images };
}

// Associe automatiquement si un résultat porte exactement le même nom (à la casse et ponctuation près)
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
// Renvoie null si aucun jeu ne correspond, lève une erreur si Steam est injoignable
async function autoMatch(...names) {
  let reached = false;
  let lastError = null;
  for (const n of names.filter(Boolean)) {
    try {
      const hit = (await searchSteam(n)).find((r) => norm(r.name) === norm(n));
      reached = true;
      if (hit) return await steamDetails(hit.id);
    } catch (e) {
      lastError = e;
    }
  }
  if (!reached && lastError) throw lastError;
  return null;
}

const SOURCE_NAMES = { steam: 'Steam', nintendo: 'Nintendo eShop', gog: 'GOG', wikipedia: 'Wikipédia' };

// Fiche hors Steam : choisie à la main (meta.ext) ou ancien repli Wikipédia automatique (meta.wiki)
function extOf(meta) {
  if (meta.ext) return meta.ext;
  const w = meta.wiki;
  if (!w) return null;
  return {
    source: 'wikipedia', id: null, name: null, cover: w.cover, header: w.header, hero: [], logo: null,
    description: w.description, developers: w.developers, publishers: w.publishers,
    releaseDate: w.releaseDate, genres: w.genres, platforms: [], url: w.wikiUrl,
  };
}

// Champs posés par une association Steam (steamDetails), à effacer quand on choisit une autre source
const STEAM_FIELDS = ['steamAppId', 'name', 'description', 'developers', 'publishers', 'releaseDate', 'genres', 'header', 'background'];

// Applique les métadonnées au jeu détecté (nom, images, infos)
function applyMeta(game, meta, coversDir) {
  if (!meta) return game;
  const g = { ...game, images: { ...game.images }, info: game.info || null };
  const own = (k) => [].concat(game.images?.[k] || []);
  if (meta.steamAppId) {
    const id = meta.steamAppId;
    g.name = meta.name || g.name;
    g.images = {
      cover: [`${ASSETS}/${id}/library_600x900_2x.jpg`, `${CDN}/${id}/library_600x900.jpg`, ...own('cover')],
      hero: [`${ASSETS}/${id}/library_hero.jpg`, meta.background, ...own('hero')].filter(Boolean),
      logo: [`${ASSETS}/${id}/logo.png`, ...own('logo')],
      header: [meta.header, `${CDN}/${id}/header.jpg`, ...own('header')].filter(Boolean),
    };
    g.info = {
      steamAppId: id,
      description: meta.description,
      developers: meta.developers,
      publishers: meta.publishers,
      releaseDate: meta.releaseDate,
      genres: meta.genres,
    };
  }
  // Fiche d'une autre source (Nintendo, GOG, Wikipédia choisie à la main, ou repli Wikipédia
  // automatique pour les jeux absents de Steam) : seulement si aucune fiche Steam n'est associée
  const ext = !meta.steamAppId ? extOf(meta) : null;
  if (ext) {
    if (ext.name) g.name = ext.name;
    g.images = {
      ...g.images,
      cover: [ext.cover, ...own('cover')].filter(Boolean),
      header: [ext.header, ext.cover, ...own('header')].filter(Boolean),
      hero: [...[].concat(ext.hero || []), ...own('hero'), ext.header].filter(Boolean),
      logo: [ext.logo, ...own('logo')].filter(Boolean),
    };
    g.info = {
      description: ext.description,
      developers: ext.developers || [],
      publishers: ext.publishers || [],
      releaseDate: ext.releaseDate || '',
      genres: ext.genres || [],
      platforms: ext.platforms || [],
      sourceName: SOURCE_NAMES[ext.source] || ext.source,
      sourceUrl: ext.url,
      sourceLicense: ext.source === 'wikipedia' ? 'CC BY-SA' : null,
    };
  }
  const local = (file) => `pimplay-img://local/${encodeURIComponent(path.join(coversDir, file))}`;
  if (meta.customCover) g.images.cover = [local(meta.customCover), ...[].concat(g.images.cover || [])];
  if (meta.customHero) g.images.hero = [local(meta.customHero), ...[].concat(g.images.hero || [])];
  if (meta.customName) g.name = meta.customName;
  g.meta = {
    steamAppId: meta.steamAppId || null,
    steamName: meta.name || null,
    // Fiche associée, quelle que soit sa source (steam, nintendo, gog, wikipedia)
    source: meta.steamAppId ? 'steam' : ext?.source || null,
    linkId: meta.steamAppId || ext?.id || null,
    linkName: meta.name || ext?.name || null,
    auto: !meta.steamAppId && !meta.ext && !!meta.wiki,
    customName: meta.customName || null,
    customCover: !!meta.customCover,
    customHero: !!meta.customHero,
    heroPosition: Number.isFinite(meta.heroPosition) ? meta.heroPosition : null,
  };
  return g;
}

module.exports = { searchSteam, steamDetails, autoMatch, applyMeta, fetchSteamAssets, withAssets, STEAM_FIELDS };
