// Compte Steam : connexion par la vraie page de Steam dans une fenêtre dédiée (Pimplay ne voit jamais
// le mot de passe), puis liste des jeux possédés via l'API Web avec le jeton de cette session.
// La session (cookies) est gardée dans une partition à part, comme dans un navigateur.
const { BrowserWindow, session, shell } = require('electron');

const PARTITION = 'persist:steam';
const STORE = 'https://store.steampowered.com';
const API = 'https://api.steampowered.com';
const ses = () => session.fromPartition(PARTITION);
const sesFetch = (url) => ses().fetch(url, { credentials: 'include' });

class SteamSessionError extends Error {}

// Le cookie steamLoginSecure commence par le SteamID64 du compte connecté
async function connectedSteamId() {
  for (const c of await ses().cookies.get({ name: 'steamLoginSecure' })) {
    const id = decodeURIComponent(c.value).match(/^(\d{17})\|\|/)?.[1];
    if (id) return id;
  }
  return null;
}

function login(parent) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      parent,
      modal: !!parent,
      // Assez large pour la mise en page de bureau de Steam (formulaire + QR code de l'app mobile)
      width: 980,
      height: 720,
      title: 'Connexion à Steam',
      autoHideMenuBar: true,
      backgroundColor: '#171a21',
      webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true },
    });
    let done = false;
    const end = (id) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      if (!w.isDestroyed()) w.close();
      resolve(id);
    };
    const check = async () => {
      const id = await connectedSteamId().catch(() => null);
      // Petit délai : Steam finit de propager la session à ses autres domaines
      if (id) setTimeout(() => end(id), 1200);
    };
    const timer = setInterval(check, 1000);
    w.webContents.on('did-navigate', check);
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    w.on('closed', () => end(null));
    w.loadURL(`${STORE}/login/`);
  });
}

async function logout() {
  await ses().clearStorageData();
}

async function getJson(res) {
  if (!res.ok) throw new Error(`Steam : HTTP ${res.status}`);
  return res.json();
}

// Jeton Web API de la session (celui qu'utilise la boutique Steam elle-même)
async function webApiToken() {
  const data = await getJson(await sesFetch(`${STORE}/pointssummary/ajaxgetasyncconfig`)).catch(() => null);
  return data?.data?.webapi_token || null;
}

// Pseudo et avatar : la fiche XML du profil reste lisible même quand le profil est privé
async function profile(steamId) {
  try {
    const res = await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`);
    const xml = res.ok ? await res.text() : '';
    const tag = (t) => xml.match(new RegExp(`<${t}><!\\[CDATA\\[(.*?)\\]\\]></${t}>`, 's'))?.[1] || null;
    return { name: tag('steamID'), avatar: tag('avatarFull') || tag('avatarMedium') };
  } catch {
    return {};
  }
}

async function ownedFromApi(token, steamId) {
  const url = `${API}/IPlayerService/GetOwnedGames/v1/?access_token=${token}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`;
  const games = (await getJson(await fetch(url)))?.response?.games;
  if (!Array.isArray(games)) return null;
  return games.map((g) => ({
    appid: String(g.appid),
    name: g.name,
    playtime: (g.playtime_forever || 0) * 60,
    lastPlayed: g.rtime_last_played ? g.rtime_last_played * 1000 : null,
  }));
}

// Repli : identifiants possédés selon la boutique, noms via le catalogue (jeux uniquement, pas les DLC)
async function ownedFromStore() {
  const ids = (await getJson(await sesFetch(`${STORE}/dynamicstore/userdata/`)))?.rgOwnedApps;
  if (!Array.isArray(ids) || !ids.length) return null;
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const input = { ids: ids.slice(i, i + 100).map((appid) => ({ appid })), context: { language: 'french', country_code: 'FR' } };
    const data = await getJson(await fetch(`${API}/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`));
    for (const it of data.response?.store_items || []) {
      if (it.name && it.type === 0) out.push({ appid: String(it.appid), name: it.name, playtime: 0, lastPlayed: null });
    }
  }
  return out;
}

async function fetchAccount() {
  const steamId = await connectedSteamId();
  if (!steamId) throw new SteamSessionError('Session Steam expirée : reconnectez-vous.');
  const token = await webApiToken();
  const owned = (token && (await ownedFromApi(token, steamId).catch(() => null))) || (await ownedFromStore().catch(() => null));
  if (!owned) throw new SteamSessionError('Steam a refusé la liste des jeux : reconnectez-vous.');
  return { steamId, ...(await profile(steamId)), owned, at: Date.now() };
}

module.exports = { login, logout, fetchAccount, SteamSessionError };
