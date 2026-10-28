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
  // Repli Wikipédia / Wikidata (jeux absents de Steam) : seulement si aucune fiche Steam n'est associée
  if (meta.wiki && !meta.steamAppId) {
    const w = meta.wiki;
    g.images = {
      ...g.images,
      cover: [w.cover, ...own('cover')].filter(Boolean),
      header: [w.header, w.cover, ...own('header')].filter(Boolean),
      hero: [...own('hero'), w.header].filter(Boolean),
    };
    g.info = {
      description: w.description,
      developers: w.developers || [],
      publishers: w.publishers || [],
      releaseDate: w.releaseDate || '',
      genres: w.genres || [],
      sourceName: 'Wikipédia',
      sourceUrl: w.wikiUrl,
    };
  }
  const local = (file) => `pimplay-img://local/${encodeURIComponent(path.join(coversDir, file))}`;
  if (meta.customCover) g.images.cover = [local(meta.customCover), ...[].concat(g.images.cover || [])];
  if (meta.customHero) g.images.hero = [local(meta.customHero), ...[].concat(g.images.hero || [])];
  if (meta.customName) g.name = meta.customName;
  g.meta = {
    steamAppId: meta.steamAppId || null,
    steamName: meta.name || null,
    customName: meta.customName || null,
    customCover: !!meta.customCover,
    customHero: !!meta.customHero,
    heroPosition: Number.isFinite(meta.heroPosition) ? meta.heroPosition : null,
  };
  return g;
}

module.exports = { searchSteam, steamDetails, autoMatch, applyMeta, fetchSteamAssets, withAssets };
