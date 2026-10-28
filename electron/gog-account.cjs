// Compte GOG : connexion par la page officielle de GOG (client OAuth de GOG Galaxy, comme Heroic),
// puis liste des jeux du compte via la bibliothèque Galaxy et la base de jeux publique de GOG.
// API non officielles : elles peuvent changer sans préavis, le scan local reste le repli.
const { authWindow, clearSession, seal, unseal, getJson, mapLimit } = require('./oauth.cjs');

const PARTITION = 'persist:gog';
const CLIENT = '46899977096215655';
const SECRET = '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9';
const REDIRECT = 'https://embed.gog.com/on_login_success?origin=client';
const LOGIN = `https://auth.gog.com/auth?client_id=${CLIENT}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&layout=client2`;
const EXPIRED = 'Session GOG expirée : reconnectez-vous.';

async function token(params) {
  const res = await fetch(`https://auth.gog.com/token?${new URLSearchParams({ client_id: CLIENT, client_secret: SECRET, ...params })}`);
  if (res.status === 400 || res.status === 401) throw new Error(EXPIRED);
  return getJson(res, 'GOG');
}

// GOG redirige vers on_login_success?code=… une fois l'utilisateur connecté
const codeFromUrl = (url) => (url.startsWith('https://embed.gog.com/on_login_success') ? new URL(url).searchParams.get('code') : null);

async function libraryIds(t) {
  const ids = [];
  let pageToken = null;
  for (let page = 0; page < 100; page++) {
    const url = `https://galaxy-library.gog.com/users/${t.user_id}/releases${pageToken ? `?page_token=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await getJson(await fetch(url, { headers: { Authorization: `Bearer ${t.access_token}` } }), 'GOG');
    for (const it of data.items || []) if (it.platform_id === 'gog' && it.external_id) ids.push(String(it.external_id));
    pageToken = data.next_page_token;
    if (!pageToken) break;
  }
  return [...new Set(ids)];
}

const localized = (o) => (typeof o === 'string' ? o : o?.['fr-FR'] || o?.['*'] || Object.values(o || {})[0] || '');
const image = (img) => img?.url_format?.replace('{formatter}', '').replace('{ext}', 'jpg') || null;

// Fiche d'un jeu dans la base publique de GOG (titre, type, jaquettes)
async function product(id) {
  const d = await getJson(await fetch(`https://gamesdb.gog.com/platforms/gog/external_releases/${id}`), 'GOG');
  return {
    title: localized(d.title) || localized(d.game?.title),
    type: d.type || null,
    summary: localized(d.summary) || localized(d.game?.summary),
    cover: image(d.game?.vertical_cover),
    hero: image(d.game?.background),
  };
}

async function username(t) {
  const res = await fetch('https://embed.gog.com/userData.json', { headers: { Authorization: `Bearer ${t.access_token}` } });
  return res.ok ? (await res.json()).username || null : null;
}

// Jeux du compte ; les fiches déjà connues sont reprises du cache
async function load(t, cache = {}) {
  const ids = await libraryIds(t);
  const products = {};
  await mapLimit(ids, 6, async (id) => {
    const p = cache[id] || (await product(id).catch(() => null));
    if (p) products[id] = p;
  });
  return { userId: t.user_id, name: await username(t).catch(() => null), refresh: seal(t.refresh_token), products, at: Date.now() };
}

async function login(parent, prev) {
  const code = await authWindow({
    parent,
    title: 'Connexion à GOG',
    url: LOGIN,
    partition: PARTITION,
    background: '#1e1e1e',
    getCode: codeFromUrl,
  });
  if (!code) return null;
  const t = await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT });
  return load(t, prev?.userId === t.user_id ? prev.products : {});
}

// Repli quand la vérification Cloudflare échoue dans la fenêtre intégrée : connexion dans le navigateur
// habituel, puis l'utilisateur colle l'adresse de la page finale (on_login_success?code=…) ou le code seul
function codeFromInput(text) {
  const s = String(text || '').trim();
  try {
    const code = new URL(s).searchParams.get('code');
    if (code) return code;
  } catch {}
  return /^[\w-]{20,}$/.test(s) ? s : null;
}

async function loginWithCode(text, prev) {
  const code = codeFromInput(text);
  if (!code) throw new Error("Adresse non reconnue : copiez l'adresse complète de la page affichée après la connexion (embed.gog.com/on_login_success…).");
  let t;
  try {
    t = await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT });
  } catch {
    throw new Error('GOG a refusé ce code (expiré ou déjà utilisé) : reconnectez-vous dans le navigateur et collez la nouvelle adresse.');
  }
  return load(t, prev?.userId === t.user_id ? prev.products : {});
}

async function fetchAccount(account) {
  const refresh = unseal(account.refresh);
  if (!refresh) throw new Error(EXPIRED);
  const t = await token({ grant_type: 'refresh_token', refresh_token: refresh });
  // L'ancien jeton ne vaut plus : le nouveau est gardé même si la lecture de la bibliothèque échoue
  account.refresh = seal(t.refresh_token);
  return load(t, account.products);
}

const logout = () => clearSession(PARTITION);

// Jeux de base uniquement (pas les DLC ni les bonus) ; Galaxy ouvre la fiche, d'où l'installation se lance
function ownedGames(account) {
  return Object.entries(account.products || {})
    .filter(([, p]) => p.title && (!p.type || p.type === 'game'))
    .map(([id, p]) => ({
      id: `gog:${id}`,
      source: 'gog',
      name: p.title,
      launch: { type: 'url', url: `goggalaxy://openGameView/${id}` },
      images: { cover: p.cover ? [p.cover] : [], hero: p.hero ? [p.hero] : [] },
      ...(p.summary ? { info: { description: p.summary, developers: [], releaseDate: '', genres: [] } } : {}),
    }));
}

module.exports = { login, logout, fetchAccount, ownedGames, browserLoginUrl: LOGIN, loginWithCode };
