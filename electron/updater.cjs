// Mises à jour automatiques : les versions sont publiées dans les Releases GitHub de Pimpuss/pimplay
// (installateur + latest.yml). Pimplay vérifie au démarrage, à chaque réouverture de sa fenêtre depuis la
// zone de notification, puis toutes les 6 h ; il télécharge en arrière-plan et installe au redémarrage
// (ou à la fermeture si l'utilisateur ne redémarre pas).
const { app } = require('electron');

const CHECK_EVERY = 6 * 3600 * 1000;
const RECHECK_AFTER = 10 * 60 * 1000; // délai minimal entre deux vérifications à la réouverture de la fenêtre
let autoUpdater = null;
let lastCheck = 0;
let state = { status: 'idle', version: null, progress: 0, error: null, checkedAt: null };

function friendly(err) {
  const msg = String(err?.message || err || '');
  if (/404|latest\.yml|No published versions/i.test(msg)) return 'Aucune version publiée pour le moment.';
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::|ERR_INTERNET/i.test(msg)) return 'Pas de connexion à GitHub : nouvelle tentative plus tard.';
  return 'La vérification des mises à jour a échoué.';
}

function setupUpdater(send) {
  // En développement (npm run dev), il n'y a rien à mettre à jour
  if (!app.isPackaged) {
    state = { ...state, status: 'dev' };
    return;
  }
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const set = (patch) => {
    state = { ...state, ...patch };
    send('update', state);
  };
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, progress: 0 }));
  autoUpdater.on('update-not-available', () => set({ status: 'latest', checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, progress: 100 }));
  autoUpdater.on('error', (err) => set({ status: 'error', error: friendly(err), checkedAt: Date.now() }));
  checkForUpdate();
  setInterval(checkForUpdate, CHECK_EVERY);
}

function checkForUpdate() {
  // Pas de nouvelle vérification pendant un téléchargement ou quand la mise à jour attend le redémarrage
  if (autoUpdater && !['checking', 'downloading', 'ready'].includes(state.status)) {
    lastCheck = Date.now();
    autoUpdater.checkForUpdates().catch(() => {});
  }
  return state;
}

// Pimplay reste ouvert dans la zone de notification : on revérifie quand l'utilisateur rouvre la fenêtre
function checkIfStale() {
  if (Date.now() - lastCheck > RECHECK_AFTER) checkForUpdate();
}

// Ferme Pimplay, installe sans fenêtre d'installation, puis relance la nouvelle version
function installUpdate(beforeQuit) {
  if (!autoUpdater || state.status !== 'ready') return;
  beforeQuit?.();
  autoUpdater.quitAndInstall(true, true);
}

const updateState = () => state;

module.exports = { setupUpdater, checkForUpdate, checkIfStale, installUpdate, updateState };
