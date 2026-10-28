import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { applyAccent } from './accent.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [library, setLibrary] = useState(null);
  const [running, setRunning] = useState([]);
  const [session, setSession] = useState(null);
  const [route, setRoute] = useState({ page: 'home' });
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState({});
  const [launching, setLaunching] = useState(null);
  const [bigPicture, setBigPicture] = useState(false);
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const toast = useCallback((text, kind = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const guard = useCallback(
    (fn) => async (...args) => {
      try {
        return await fn(...args);
      } catch (e) {
        toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
        return undefined;
      }
    },
    [toast],
  );

  useEffect(() => {
    window.pimplay.library.list().then(setLibrary);
    window.pimplay.session.state().then(setSession);
    window.pimplay.settings.get().then(setSettings);
    window.pimplay.game.launchState().then((l) => setLaunching(l && (l.stage === 'launcher' || l.stage === 'starting') ? l : null));
    const offs = [
      window.pimplay.on('session', setSession),
      window.pimplay.on('library', setLibrary),
      window.pimplay.on('launch', (l) => {
        if (l?.stage === 'timeout') toast("Le jeu ne s'est pas lancé après 3 minutes. Vérifiez la fenêtre du launcher (connexion, mise à jour…).", 'error');
        setLaunching(l && (l.stage === 'launcher' || l.stage === 'starting') ? l : null);
      }),
      window.pimplay.on('running', (r) => {
        setRunning(r);
        setLibrary((lib) => lib && lib.map((g) => ({ ...g, running: r.some((x) => x.gameId === g.id) })));
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const navigate = useCallback((page, params = {}) => {
    setRoute({ page, ...params });
    document.querySelector('.main')?.scrollTo(0, 0);
  }, []);

  // Couleur d'accent choisie dans Paramètres › Apparence
  useEffect(() => { applyAccent(settings.accent); }, [settings.accent]);

  // Option « Outils de mod / trainer » (activée par défaut) ; désactivée, Pimplay est un simple launcher
  const modTools = settings.modTools !== false;

  // Jeux affichés partout sauf dans le filtre « Masqués »
  const games = useMemo(() => library && library.filter((g) => !g.hidden), [library]);

  const updateSettings = useMemo(() => guard(async (patch) => setSettings(await window.pimplay.settings.set(patch))), [guard]);

  const value = useMemo(
    () => ({ library, games, setLibrary, running, session, route, navigate, query, setQuery, toast, guard, settings, updateSettings, launching, modTools, bigPicture, setBigPicture }),
    [library, games, running, session, route, navigate, query, toast, guard, settings, updateSettings, launching, modTools, bigPicture],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const SOURCES = {
  steam: 'Steam',
  epic: 'Epic Games',
  gog: 'GOG',
  ubisoft: 'Ubisoft Connect',
  battlenet: 'Battle.net',
  ea: 'EA app',
  custom: 'Perso',
};

export function formatSize(bytes) {
  if (!bytes) return null;
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} Go` : `${Math.round(bytes / 1024 ** 2)} Mo`;
}

export function formatPlaytime(seconds) {
  const m = Math.round((seconds || 0) / 60);
  if (m < 1) return null;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 10 && m % 60 ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${h.toLocaleString('fr-FR')} h`;
}

export function timeAgo(ts) {
  if (!ts) return 'Jamais lancé';
  const d = (Date.now() - ts) / 1000;
  if (d < 3600) return 'Il y a quelques minutes';
  if (d < 86400) return `Il y a ${Math.floor(d / 3600)} h`;
  if (d < 86400 * 30) return `Il y a ${Math.floor(d / 86400)} j`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
