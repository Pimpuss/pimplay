// Compte Epic Games : connexion par la page officielle d'Epic (client OAuth du launcher Epic, comme
// Legendary et Heroic), puis liste des jeux du compte via la bibliothèque et le catalogue d'Epic.
// API non officielles : elles peuvent changer sans préavis, le scan local reste le repli.
const { authWindow, clearSession, seal, unseal, getJson, mapLimit } = require('./oauth.cjs');
const { ownedEpicGames } = require('./games.cjs');

const PARTITION = 'persist:epic';
const CLIENT = '34a02cf8f4414e29b15921876da36f9a';
const SECRET = 'daafbccc737745039dffe53d94fc76cf';
const OAUTH = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token';
const REDIRECT = `https://www.epicgames.com/id/api/redirect?clientId=${CLIENT}&responseType=code`;
const LOGIN = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(REDIRECT)}`;
const LIBRARY = 'https://library-service.live.use1a.on.epicgames.com/library/api/public/items';
const CATALOG = 'https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace';
const EXPIRED = 'Session Epic expirée : reconnectez-vous.';

async function token(params) {
  const res = await fetch(OAUTH, {
    method: 'POST',
    headers: {
      Authorization: `basic ${Buffer.from(`${CLIENT}:${SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ ...params, token_type: 'eg1' }),
  });
  if (res.status === 400 || res.status === 401) throw new Error(EXPIRED);
  return getJson(res, 'Epic');
}

// Une fois connecté, Epic affiche sur l'adresse de redirection un JSON contenant le code d'autorisation
async function codeFromPage(url, contents) {
  if (!url.startsWith('https://www.epicgames.com/id/api/redirect')) return null;
  const text = await contents.executeJavaScript('document.body ? document.body.innerText : ""');
  return JSON.parse(text).authorizationCode || null;
}

async function libraryRecords(access) {
  const records = [];
  let cursor = null;
  for (let page = 0; page < 100; page++) {
    const url = `${LIBRARY}?includeMetadata=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const data = await getJson(await fetch(url, { headers: { Authorization: `bearer ${access}` } }), 'Epic');
    records.push(...(data.records || []));
    cursor = data.responseMetadata?.nextCursor;
    if (!cursor) break;
  }
  return records;
}

const KEY_IMAGES = /^(DieselGameBoxTall|OfferImageTall|DieselGameBox|OfferImageWide|DieselGameBoxLogo)$/;

// Entrée du catalogue réduite à ce qu'utilise Pimplay (même forme que le cache du launcher)
async function catalogItem(namespace, id, access) {
  const url = `${CATALOG}/${namespace}/bulk/items?id=${id}&includeDLCDetails=true&includeMainGameDetails=true&country=FR&locale=fr`;
  const item = (await getJson(await fetch(url, { headers: { Authorization: `bearer ${access}` } }), 'Epic'))?.[id];
  if (!item) return { id, namespace, title: '' };
  return {
    id,
    namespace,
    title: item.title,
    description: item.description,
    developer: item.developer,
    keyImages: (item.keyImages || []).filter((k) => KEY_IMAGES.test(k.type)).map(({ type, url: u }) => ({ type, url: u })),
    categories: (item.categories || []).map(({ path }) => ({ path })),
    releaseInfo: (item.releaseInfo || []).map(({ appId, platform, dateAdded }) => ({ appId, platform, dateAdded })),
    mainGameItem: item.mainGameItem?.id ? { id: item.mainGameItem.id } : undefined,
  };
}

// Jeux du compte ; les entrées du catalogue déjà connues sont reprises du cache
async function load(t, cache = {}) {
  const records = (await libraryRecords(t.access_token)).filter((r) => r.namespace !== 'ue' && r.catalogItemId);
  const catalog = {};
  await mapLimit(records, 6, async (r) => {
    const key = `${r.namespace}:${r.catalogItemId}`;
    const item = cache[key] || (await catalogItem(r.namespace, r.catalogItemId, t.access_token).catch(() => null));
    if (item) catalog[key] = item;
  });
  return { accountId: t.account_id, name: t.displayName || null, refresh: seal(t.refresh_token), catalog, at: Date.now() };
}

async function login(parent, prev) {
  const code = await authWindow({
    parent,
    title: 'Connexion à Epic Games',
    url: LOGIN,
    partition: PARTITION,
    background: '#121212',
    getCode: codeFromPage,
  });
  if (!code) return null;
  const t = await token({ grant_type: 'authorization_code', code });
  return load(t, prev?.accountId === t.account_id ? prev.catalog : {});
}

async function fetchAccount(account) {
  const refresh = unseal(account.refresh);
  if (!refresh) throw new Error(EXPIRED);
  const t = await token({ grant_type: 'refresh_token', refresh_token: refresh });
  // L'ancien jeton ne vaut plus : le nouveau est gardé même si la lecture de la bibliothèque échoue
  account.refresh = seal(t.refresh_token);
  return load(t, account.catalog);
}

const logout = () => clearSession(PARTITION);
const ownedGames = (account) => ownedEpicGames(Object.values(account.catalog || {}));

module.exports = { login, logout, fetchAccount, ownedGames };
