// Outils communs aux comptes Epic et GOG : connexion par la page officielle dans une fenêtre dédiée
// (Pimplay ne voit jamais le mot de passe), puis échange du code d'autorisation contre des jetons.
// Seul le jeton de rafraîchissement est conservé, chiffré par Windows (safeStorage).
const { BrowserWindow, session, shell, safeStorage } = require('electron');

// Ouvre la page de connexion et attend que getCode(url, webContents) trouve le code d'autorisation.
// Résout null si l'utilisateur ferme la fenêtre.
function authWindow({ parent, title, url, partition, background, getCode }) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      parent,
      modal: !!parent,
      width: 980,
      height: 720,
      title,
      autoHideMenuBar: true,
      backgroundColor: background,
      webPreferences: { partition, contextIsolation: true, sandbox: true },
    });
    // Certaines pages de connexion refusent les navigateurs intégrés : on retire Electron de l'agent utilisateur
    w.webContents.setUserAgent(w.webContents.getUserAgent().replace(/\s(Electron|pimplay)\/\S+/gi, ''));
    let done = false;
    const end = (code) => {
      if (done) return;
      done = true;
      if (!w.isDestroyed()) w.close();
      resolve(code);
    };
    const check = async (u) => {
      if (done || w.isDestroyed()) return;
      const code = await Promise.resolve(getCode(u || w.webContents.getURL(), w.webContents)).catch(() => null);
      if (code) end(code);
    };
    w.webContents.on('will-redirect', (_e, u) => check(u));
    w.webContents.on('did-navigate', (_e, u) => check(u));
    w.webContents.on('did-finish-load', () => check());
    w.webContents.setWindowOpenHandler(({ url: u }) => {
      if (/^https:/.test(u)) shell.openExternal(u);
      return { action: 'deny' };
    });
    w.on('closed', () => end(null));
    w.loadURL(url);
  });
}

const clearSession = (partition) => session.fromPartition(partition).clearStorageData();

const seal = (s) => (s && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s).toString('base64') : null);
const unseal = (b) => {
  try { return b ? safeStorage.decryptString(Buffer.from(b, 'base64')) : null; } catch { return null; }
};

async function getJson(res, label) {
  if (!res.ok) throw new Error(`${label} : HTTP ${res.status}`);
  return res.json();
}

// Applique fn à chaque élément, au plus n requêtes à la fois
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

module.exports = { authWindow, clearSession, seal, unseal, getJson, mapLimit };
