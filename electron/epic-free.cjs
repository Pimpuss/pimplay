// Jeux offerts sur l'Epic Games Store, d'après le flux public utilisé par la page « Jeux gratuits »
const FEED = 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=fr&country=FR&allowCountries=FR';
const STORE = 'https://store.epicgames.com/fr/';

// Offres à 100 % de réduction (discountPercentage = 0 dans le flux = prix final nul)
function freeWindow(groups) {
  const offers = (groups || []).flatMap((g) => g.promotionalOffers || []);
  const free = offers.find((o) => o.discountSetting?.discountPercentage === 0);
  return free ? { start: Date.parse(free.startDate), end: Date.parse(free.endDate) } : null;
}

function pageSlug(e) {
  const slug = e.offerMappings?.[0]?.pageSlug || e.catalogNs?.mappings?.[0]?.pageSlug || e.productSlug?.replace(/\/home$/, '');
  return slug && /^[a-z0-9-]+$/i.test(slug) ? slug : null;
}

function image(e) {
  const pick = (type) => e.keyImages?.find((k) => k.type === type)?.url;
  const url = pick('OfferImageWide') || pick('DieselStoreFrontWide') || pick('Thumbnail') || pick('OfferImageTall');
  // Le CDN d'Epic redimensionne à la volée : inutile de télécharger l'image en 2560 px
  return url ? `${url}${url.includes('?') ? '&' : '?'}h=360&w=640&resize=1&quality=medium` : null;
}

async function fetchFreeGames() {
  const res = await fetch(FEED, { headers: { 'Accept-Language': 'fr-FR,fr;q=0.9' } });
  if (!res.ok) throw new Error(`Epic : HTTP ${res.status}`);
  const elements = (await res.json())?.data?.Catalog?.searchStore?.elements || [];
  const now = Date.now();
  const items = [];
  for (const e of elements) {
    const current = freeWindow(e.promotions?.promotionalOffers);
    const upcoming = freeWindow(e.promotions?.upcomingPromotionalOffers);
    const win = current && current.start <= now && now < current.end ? current : upcoming;
    if (!win || win.end <= now) continue;
    const mystery = /mystery|myst[eè]re/i.test(e.title);
    const slug = mystery ? null : pageSlug(e);
    items.push({
      id: e.id,
      title: mystery ? 'Jeu mystère' : e.title,
      mystery,
      now: win === current,
      start: win.start,
      end: win.end,
      price: e.price?.totalPrice?.fmtPrice?.originalPrice || null,
      image: mystery ? null : image(e),
      url: slug ? `${STORE}p/${slug}` : null,
    });
  }
  // Offerts maintenant d'abord, puis les prochains par date
  return items.sort((a, b) => b.now - a.now || a.start - b.start);
}

module.exports = { fetchFreeGames, STORE };
