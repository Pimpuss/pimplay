import { BarChart3, Gamepad, Home as HomeIcon, LibraryBig, ScanSearch, Search, Settings as SettingsIcon } from 'lucide-react';
import Logo from './components/Logo.jsx';
import CloseModal from './components/CloseModal.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import BigPicture from './components/BigPicture.jsx';
import UpdateCard from './components/UpdateCard.jsx';
import { useGamepad } from './lib/gamepad.js';
import { AppProvider, useApp } from './lib/context.jsx';
import { Cover } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import Library from './pages/Library.jsx';
import Game from './pages/Game.jsx';
import Scanner from './pages/Scanner.jsx';
import Settings from './pages/Settings.jsx';
import Stats from './pages/Stats.jsx';

const NAV = [
  ['home', 'Accueil', HomeIcon],
  ['library', 'Mes jeux', LibraryBig],
  ['stats', 'Statistiques', BarChart3],
  ['scanner', 'Scanner mémoire', ScanSearch],
  ['settings', 'Paramètres', SettingsIcon],
];

function TitleBar() {
  const { query, setQuery, route, navigate } = useApp();
  return (
    <header className="titlebar">
      <div className="brand">
        <span className="brand-mark"><Logo size={22} /></span>
        Pimplay
      </div>
      <label className="search">
        <Search size={15} />
        <input
          placeholder="Rechercher un jeu…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (route.page !== 'library') navigate('library');
          }}
        />
        <button
          type="button"
          className="kbd search-kbd"
          title="Recherche rapide : lancer un jeu ou aller à une page"
          onClick={(e) => { e.preventDefault(); window.dispatchEvent(new Event('pimplay:palette')); }}
        >
          Ctrl K
        </button>
      </label>
    </header>
  );
}

function Sidebar() {
  const { route, navigate, library, games, session, modTools, setBigPicture } = useApp();
  const live = (games || []).filter((g) => g.running);
  const favs = (games || []).filter((g) => g.favorite && !g.running).slice(0, 6);
  const target = session?.gameId && library?.find((g) => g.id === session.gameId);
  const goGame = (id) => navigate('game', { id });

  return (
    <nav className="sidebar">
      {NAV.filter(([page]) => modTools || page !== 'scanner').map(([page, label, Icon]) => (
        <button
          key={page}
          className={`nav-item ${route.page === page || (page === 'library' && route.page === 'game') ? 'active' : ''}`}
          onClick={() => navigate(page)}
        >
          <Icon /> {label}
        </button>
      ))}
      <button className="nav-item" onClick={() => setBigPicture(true)} title="Plein écran, navigation à la manette (bouton Menu / Options / +)">
        <Gamepad /> Mode manette
      </button>

      <div className="side-title">En cours d'exécution</div>
      {live.length ? live.map((g) => (
        <button key={g.id} className="side-game" onClick={() => goGame(g.id)}>
          <div className="thumb"><Cover game={g} /></div>
          <span>{g.name}</span>
        </button>
      )) : <div className="side-empty">Aucun jeu détecté</div>}

      {favs.length > 0 && <div className="side-title">Favoris</div>}
      {favs.map((g) => (
        <button key={g.id} className="side-game" onClick={() => goGame(g.id)}>
          <div className="thumb"><Cover game={g} /></div>
          <span>{g.name}</span>
        </button>
      ))}

      <div className="side-spacer" />
      <UpdateCard />
      {modTools && <div className="status-card">
        {target ? (
          <>
            <span className={`pill ${session.attached ? 'ok' : session.error ? 'danger' : 'warn'}`}>
              <span className="dot" />
              {session.attached ? 'Mods actifs' : session.error ? 'Erreur' : 'En attente du jeu'}
            </span>
            <strong>{target.name}</strong>
            <div className="muted">{session.attached ? `${session.exe} · PID ${session.pid}` : session.error || 'Lancez le jeu pour activer les mods'}</div>
          </>
        ) : (
          <>
            <span className="pill"><span className="dot" /> Inactif</span>
            <strong>Aucun trainer actif</strong>
            <div className="muted">Ouvrez un jeu et cliquez sur Jouer</div>
          </>
        )}
      </div>}
    </nav>
  );
}

// Premier lancement (aucune bibliothèque mémorisée) : squelette de l'accueil pendant l'analyse
function LoadingScreen() {
  return (
    <div className="page loading-page" aria-busy="true">
      <div className="sk sk-hero">
        <div className="loading-center">
          <span className="loading-logo"><Logo size={46} /></span>
          <strong>Chargement de vos jeux…</strong>
          <span>Steam · Epic Games · GOG · Ubisoft Connect · Battle.net · EA app</span>
        </div>
      </div>
      <div className="stats">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="stat"><div className="sk sk-line" style={{ width: '45%' }} /><div className="sk sk-line tall" style={{ width: '30%' }} /></div>
        ))}
      </div>
      <div className="sk sk-line" style={{ width: 160, height: 16, margin: '34px 0 16px' }} />
      <div className="grid">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="card-skel" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="sk sk-cover" />
            <div className="sk sk-line" style={{ width: '75%', marginTop: 10 }} />
            <div className="sk sk-line" style={{ width: '40%' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Router() {
  const { route, library, modTools } = useApp();
  if (!library) return <LoadingScreen />;
  switch (route.page) {
    case 'library': return <Library />;
    case 'game': return <Game key={route.id} id={route.id} />;
    case 'scanner': return modTools ? <Scanner /> : <Home />;
    case 'settings': return <Settings />;
    case 'stats': return <Stats />;
    default: return <Home />;
  }
}

// Mode manette : affiché par-dessus l'app ; le bouton Start l'ouvre depuis n'importe quelle page
function GamepadMode() {
  const { bigPicture, setBigPicture, library } = useApp();
  useGamepad({ start: () => setBigPicture(true) }, !bigPicture && !!library);
  return bigPicture && library ? <BigPicture /> : null;
}

export default function App() {
  return (
    <AppProvider>
      <div className="app">
        <TitleBar />
        <Sidebar />
        <main className="main"><Router /></main>
        <CloseModal />
        <CommandPalette />
        <GamepadMode />
      </div>
    </AppProvider>
  );
}
