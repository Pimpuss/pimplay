// Fiches de jeu hors Steam pour la fenêtre Personnaliser : Nintendo eShop (Europe, en français),
// GOG et Wikipédia (toutes plateformes : PlayStation, Xbox, rétro…). Gratuit et sans clé d'API.
// Chaque source renvoie une fiche normalisée, stockée telle quelle dans meta.ext.
const { wikiSearch, wikiPage } = require('./wiki.cjs');

// À augmenter quand le contenu d'une fiche change : les fiches déjà associées sont alors
// redemandées en arrière-plan (sources qui le permettent sans nouvelle recherche)
const EXT_VERSION = 2;

const SOURCES = {
  nintendo: 'Nintendo eShop',
  gog: 'GOG',
  wikipedia: 'Wikipédia',
};

async function getJson(url, label) {
  const res = await fetch(url, { headers: { 'Accept-Language': 'fr-FR,fr;q=0.9', 'User-Agent': 'Pimplay (launcher de jeux personnel)' } });
  if (!res.ok) throw new Error(`${label} a répondu ${res.status}`);
  return res.json();
}

const frDate = (y, m, d) => new Date(Date.UTC(+y, +m - 1, +d)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const stripHtml = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

// Les derniers résultats de recherche, pour associer sans tout redemander
const cache = new Map();
const remember = (source, id, raw) => { cache.set(`${source}:${id}`, raw); return raw; };

// ---------- Nintendo eShop (index public de nintendo.com/fr-fr) ----------

const NINTENDO = 'https://searching.nintendo-europe.com/fr/select';

async function nintendoQuery(params) {
  const qs = new URLSearchParams({ fq: 'type:GAME', wt: 'json', ...params });
  return (await getJson(`${NINTENDO}?${qs}`, 'Nintendo')).response?.docs || [];
}

async function searchNintendo(term) {
  const docs = await nintendoQuery({ q: term, rows: '12' });
  return docs.map((d) => {
    remember('nintendo', d.fs_id, d);
    const year = d.dates_released_dts?.[0]?.slice(0, 4);
    return {
      id: String(d.fs_id),
      name: d.title,
      image: d.image_url_sq_s || d.image_url || null,
      detail: [(d.system_names_txt || []).join(', '), year].filter(Boolean).join(' · '),
    };
  });
}

async function nintendoDetails(id) {
  const d = cache.get(`nintendo:${id}`) || (await nintendoQuery({ q: '*', fq: `fs_id:${id}`, rows: '1' }))[0];
  if (!d) throw new Error('Fiche Nintendo introuvable.');
  // Bannières : 2:1 (jeux Switch 1) ou 16:9 (jeux récents, Switch 2), en 500 px dans l'index ;
  // les versions 1600 / 1280 px existent souvent sur le CDN, sinon l'interface passe à la suivante
  const size = (u, w) => u && u.replace(/image500w(\.\w+)$/, `image${w}$1`);
  const wides = [d.image_url_h2x1_s, d.image_url_h16x9_s].filter(Boolean);
  const rel = d.dates_released_dts?.[0]?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return {
    source: 'nintendo',
    v: EXT_VERSION,
    id: String(d.fs_id),
    name: d.title,
    cover: d.image_url || d.image_url_sq_s || null,
    hero: [...wides.map((u) => size(u, '1600w')), ...wides.map((u) => size(u, '1280w')), ...wides],
    header: wides[0] || null,
    logo: null,
    description: d.product_catalog_description_s || d.excerpt || '',
    developers: [].concat(d.developer || []),
    publishers: [].concat(d.publisher || []),
    releaseDate: rel ? frDate(rel[1], rel[2], rel[3]) : d.pretty_date_s || '',
    genres: d.pretty_game_categories_txt || [],
    platforms: d.system_names_txt || [],
    url: d.url ? `https://www.nintendo.com${d.url}` : null,
  };
}

// ---------- GOG (catalogue public de gog.com) ----------

async function searchGog(term) {
  const qs = new URLSearchParams({
    limit: '12', query: `like:${term}`, order: 'desc:score', productType: 'in:game,pack',
    locale: 'fr-FR', countryCode: 'FR', currencyCode: 'EUR',
  });
  const data = await getJson(`https://catalog.gog.com/v1/catalog?${qs}`, 'GOG');
  return (data.products || []).map((p) => {
    remember('gog', p.id, p);
    return { id: String(p.id), name: p.title, image: p.coverVertical || p.coverHorizontal || null, detail: p.releaseDate?.slice(0, 4) || '' };
  });
}

async function gogDetails(id) {
  const p = cache.get(`gog:${id}`);
  if (!p) throw new Error('Relancez la recherche GOG puis choisissez le jeu.');
  // La description n'est pas dans le catalogue : l'API produit la donne (en HTML)
  const prod = await getJson(`https://api.gog.com/products/${encodeURIComponent(id)}?expand=description&locale=fr-FR`, 'GOG').catch(() => null);
  const desc = stripHtml(prod?.description?.lead) || stripHtml(prod?.description?.full).slice(0, 600);
  const rel = String(p.releaseDate || '').match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  return {
    source: 'gog',
    v: EXT_VERSION,
    id: String(p.id),
    name: p.title,
    cover: p.coverVertical || null,
    hero: [p.galaxyBackgroundImage].filter(Boolean),
    header: p.coverHorizontal || null,
    logo: p.logo || null,
    description: desc,
    developers: p.developers || [],
    publishers: p.publishers || [],
    releaseDate: rel ? frDate(rel[1], rel[2], rel[3]) : '',
    genres: (p.genres || []).map((g) => g.name),
    platforms: ['PC'],
    url: p.storeLink || null,
  };
}

// ---------- Wikipédia ----------

async function wikiDetails(title) {
  const w = await wikiPage(title);
  return {
    source: 'wikipedia',
    v: EXT_VERSION,
    id: title,
    name: w.name,
    cover: w.cover,
    hero: [],
    header: w.header,
    logo: null,
    description: w.description,
    developers: w.developers || [],
    publishers: w.publishers || [],
    releaseDate: w.releaseDate || '',
    genres: w.genres || [],
    platforms: [],
    url: w.wikiUrl,
  };
}

// ---------- Point d'entrée ----------

const SEARCH = { nintendo: searchNintendo, gog: searchGog, wikipedia: wikiSearch };
const DETAILS = { nintendo: nintendoDetails, gog: gogDetails, wikipedia: wikiDetails };

async function searchSource(source, term) {
  const q = String(term || '').trim();
  if (!q) return [];
  if (!SEARCH[source]) throw new Error(`Source inconnue : ${source}`);
  // Titre identique d'abord, puis ceux qui commencent par la recherche ; sinon l'ordre de la source
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const rank = (r) => (norm(r.name) === norm(q) ? 0 : norm(r.name).startsWith(norm(q)) ? 1 : 2);
  return (await SEARCH[source](q)).map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

async function sourceDetails(source, id) {
  if (!DETAILS[source]) throw new Error(`Source inconnue : ${source}`);
  return DETAILS[source](String(id));
}

// Fiche à rafraîchir ? (GOG exige une recherche préalable : on garde l'ancienne fiche)
const isStale = (ext) => !!ext && (ext.v || 1) < EXT_VERSION && ext.source !== 'gog' && !!ext.id;

module.exports = { SOURCES, EXT_VERSION, searchSource, sourceDetails, isStale };
