// Métadonnées de repli pour les jeux absents de Steam (Battle.net, Ubisoft…) : Wikipédia + Wikidata.
// Gratuit et sans clé. Texte de Wikipédia sous licence CC BY-SA : l'interface cite et lie la source.
const UA = { 'User-Agent': 'Pimplay/0.1 (launcher de jeux personnel)', 'Accept-Language': 'fr' };
// « 2004 video game », « digital collectible card game », « jeu vidéo de 2004 »…
const IS_GAME = /\bgame\b|jeu vidéo/i;

async function getJson(url, retry = 3) {
  const res = await fetch(url, { headers: UA });
  if (res.status === 404) return null;
  if (res.status === 429 && retry > 0) {
    // Limitation de débit de Wikimedia : on attend le délai demandé (Retry-After) puis on réessaie
    const wait = Math.min(Number(res.headers.get('retry-after')) || 5, 15) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return getJson(url, retry - 1);
  }
  if (!res.ok) throw new Error(`Wikipédia a répondu ${res.status}`);
  return res.json();
}

const summary = (lang, title) =>
  getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`);

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

// Page anglaise du jeu : titre exact d'abord, sinon recherche « <nom> video game » (titre identique en priorité)
async function findEnglishPage(name) {
  const exact = await summary('en', name);
  if (exact && IS_GAME.test(exact.description || '')) return exact;
  const s = await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${name} video game`)}&srlimit=5&format=json`);
  const titles = (s?.query?.search || []).map((x) => x.title);
  const ordered = [...titles.filter((t) => norm(t) === norm(name)), ...titles.filter((t) => norm(t) !== norm(name))];
  for (const t of ordered.slice(0, 3)) {
    const p = await summary('en', t);
    if (p && IS_GAME.test(p.description || '') && norm(p.title).includes(norm(name).slice(0, 6))) return p;
  }
  return null;
}

// Retire la prononciation API qui ouvre souvent les articles (« World of Warcraft /wɜrld…/ est… »)
const cleanExtract = (s) => (s || '').replace(/\s*\/[^/\n]{2,60}\/\s*/, ' ').replace(/\s+/g, ' ').trim();

function formatDate(time, precision) {
  const m = String(time || '').match(/^\+?(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  if (precision && precision < 11) return m[1]; // seulement l'année
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

async function wikidataFacts(qid) {
  const ent = (await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json`))?.entities?.[qid];
  if (!ent) return {};
  const ids = (p) => (ent.claims[p] || []).map((c) => c.mainsnak.datavalue?.value?.id).filter(Boolean);
  const dev = ids('P178');
  const pub = ids('P123');
  const genres = ids('P136').slice(0, 4);
  const all = [...new Set([...dev, ...pub, ...genres])];
  let labels = {};
  if (all.length) {
    labels = (await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${all.join('|')}&props=labels&languages=fr|en&format=json`))?.entities || {};
  }
  const lab = (id) => labels[id]?.labels?.fr?.value || labels[id]?.labels?.en?.value;
  const cap = (s) => s && s[0].toUpperCase() + s.slice(1);
  const date = ent.claims.P577?.[0]?.mainsnak.datavalue?.value;
  return {
    developers: dev.map(lab).filter(Boolean),
    publishers: pub.map(lab).filter(Boolean),
    genres: genres.map(lab).filter(Boolean).map(cap),
    releaseDate: formatDate(date?.time, date?.precision),
  };
}

// Renvoie null si aucun article de jeu vidéo ne correspond ; lève une erreur si Wikipédia est injoignable
async function wikiLookup(name) {
  const en = await findEnglishPage(name);
  if (!en) return null;
  // Description en français via le lien interlangue de Wikidata, sinon l'anglais
  let fr = null;
  if (en.wikibase_item) {
    const sl = (await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${en.wikibase_item}&props=sitelinks&sitefilter=frwiki&format=json`))
      ?.entities?.[en.wikibase_item]?.sitelinks?.frwiki?.title;
    if (sl) fr = await summary('fr', sl);
  }
  const img = en.originalimage;
  const portrait = img && img.height > img.width * 1.1;
  const page = fr || en;
  return {
    source: 'wikipedia',
    wikiUrl: page.content_urls?.desktop?.page || null,
    description: cleanExtract(page.extract),
    cover: portrait ? img.source.split('?')[0] : null,
    header: img && !portrait ? img.source.split('?')[0] : null,
    ...(en.wikibase_item ? await wikidataFacts(en.wikibase_item) : {}),
  };
}

module.exports = { wikiLookup };
