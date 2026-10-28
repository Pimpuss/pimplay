import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Gamepad2, Loader2, Play, Star, Timer } from 'lucide-react';
import { useApp, SOURCES, formatPlaytime, timeAgo } from '../lib/context.jsx';
import { PAD_LABELS, useActivePad, useGamepad } from '../lib/gamepad.js';
import { Cover, GameLogo, heroStyle } from './ui.jsx';
import Logo from './Logo.jsx';

const TABS = [
  ['recent', 'Récents'],
  ['all', 'Tous les jeux'],
  ['fav', 'Favoris'],
];

// Symboles PlayStation, dans leurs couleurs d'origine
const PS_SHAPES = {
  cross: <path d="M5 5 L15 15 M15 5 L5 15" stroke="#7cb2ff" />,
  circle: <circle cx="10" cy="10" r="5.5" stroke="#ff6b81" />,
  square: <rect x="4.75" y="4.75" width="10.5" height="10.5" rx="0.5" stroke="#f49ac1" />,
  triangle: <path d="M10 4 L16 14.5 H4 Z" stroke="#3ddbb0" strokeLinejoin="round" />,
};

// Bouton de manette tel qu'il apparaît sur la manette branchée (name : a, b, x, y, lb, rb…)
function PadButton({ family, name }) {
  const label = PAD_LABELS[family][name];
  if (name === 'lb' || name === 'rb') return <i className="bp-btn shoulder">{label}</i>;
  if (family === 'playstation') {
    return (
      <i className="bp-btn ps" aria-label={label}>
        <svg viewBox="0 0 20 20" fill="none" strokeWidth="2.2" strokeLinecap="round">{PS_SHAPES[label]}</svg>
      </i>
    );
  }
  // Xbox : couleur liée à la lettre ; Switch : boutons sans couleur
  return <i className={`bp-btn ${family === 'xbox' ? label.toLowerCase() : 'plain'}`}>{label}</i>;
}

// Mode manette : plein écran, navigation à la croix / au stick (ou au clavier)
export default function BigPicture() {
  const { games, setLibrary, setBigPicture, navigate, launching, guard, toast } = useApp();
  const [tab, setTab] = useState(0);
  const [index, setIndex] = useState(0);
  const [clock, setClock] = useState(() => new Date());
  const railRef = useRef(null);
  const pad = useActivePad();

  const list = useMemo(() => {
    const all = [...(games || [])];
    const key = TABS[tab][0];
    if (key === 'fav') return all.filter((g) => g.favorite).sort((a, b) => a.name.localeCompare(b.name));
    if (key === 'all') return all.sort((a, b) => a.name.localeCompare(b.name));
    // Récents : joués récemment d'abord, puis le reste par nom
    return all.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.name.localeCompare(b.name));
  }, [games, tab]);
  const game = list[Math.min(index, list.length - 1)];

  // Plein écran à l'ouverture, fenêtre normale à la sortie
  useEffect(() => {
    window.pimplay.app.fullscreen?.(true);
    const t = setInterval(() => setClock(new Date()), 15000);
    return () => { clearInterval(t); window.pimplay.app.fullscreen?.(false); };
  }, []);
  useEffect(() => { setIndex(0); }, [tab]);
  useEffect(() => {
    railRef.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [index, tab]);

  const exit = () => setBigPicture(false);
  const move = (d) => setIndex((i) => Math.max(0, Math.min(list.length - 1, i + d)));
  const switchTab = (d) => setTab((t) => (t + d + TABS.length) % TABS.length);
  const launchStage = launching?.gameId === game?.id ? launching.stage : null;

  const play = guard(async () => {
    if (!game || game.running || launchStage) return;
    await window.pimplay.game.launch(game.id);
  });
  const favorite = guard(async () => {
    if (!game) return;
    setLibrary(await window.pimplay.library.favorite(game.id, !game.favorite));
    toast(game.favorite ? `${game.name} retiré des favoris` : `${game.name} ajouté aux favoris`);
  });
  const openSheet = () => {
    if (!game) return;
    exit();
    navigate('game', { id: game.id });
  };

  useGamepad({ left: () => move(-1), right: () => move(1), up: () => switchTab(-1), down: () => switchTab(1), lb: () => switchTab(-1), rb: () => switchTab(1), a: play, b: exit, back: exit, x: favorite, y: openSheet });

  useEffect(() => {
    const onKey = (e) => {
      const map = { ArrowLeft: () => move(-1), ArrowRight: () => move(1), ArrowUp: () => switchTab(-1), ArrowDown: () => switchTab(1), Enter: play, Escape: exit, f: favorite, i: openSheet };
      const fn = map[e.key];
      if (fn) { e.preventDefault(); e.stopPropagation(); fn(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  let action = <><Play fill="currentColor" /> Jouer</>;
  if (game?.running) action = <><span className="bp-live" /> En cours</>;
  else if (launchStage) action = <><Loader2 className="spin" /> Lancement…</>;

  return (
    <div className="bp" role="dialog" aria-label="Mode manette">
      {game && <div className="bp-bg" key={game.id}><Cover game={game} kind="hero" className="bp-bg-img" style={heroStyle(game)} /></div>}

      <header className="bp-top">
        <span className="bp-brand"><Logo size={28} /> Pimplay</span>
        <nav className="bp-tabs">
          {TABS.map(([k, label], i) => (
            <button key={k} className={i === tab ? 'active' : ''} onClick={() => setTab(i)}>{label}</button>
          ))}
        </nav>
        <span className="bp-status">
          {pad.name && <span className="bp-pad"><Gamepad2 /> {pad.name}</span>}
          <span className="bp-clock">{clock.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
        </span>
      </header>

      {game ? (
        <section className="bp-info" key={game.id}>
          <div className="bp-title"><GameLogo game={game} fallback={<h1>{game.name}</h1>} /></div>
          <div className="bp-meta">
            <span>{SOURCES[game.source]}</span>
            {formatPlaytime(game.playtime) && <span><Timer /> {formatPlaytime(game.playtime)}</span>}
            <span><Clock /> {timeAgo(game.lastPlayed)}</span>
            {game.favorite && <span className="bp-fav"><Star fill="currentColor" /> Favori</span>}
          </div>
          {game.info?.description && <p className="bp-desc">{game.info.description}</p>}
          <button className={`bp-play ${game.running ? 'running' : ''}`} onClick={play}>{action}</button>
        </section>
      ) : (
        <section className="bp-info"><h1 className="bp-empty">{TABS[tab][0] === 'fav' ? 'Aucun favori' : 'Aucun jeu'}</h1></section>
      )}

      <div className="bp-rail" ref={railRef}>
        {list.map((g, i) => (
          <button key={g.id} data-i={i} className={`bp-card ${i === index ? 'sel' : ''}`} onClick={() => (i === index ? play() : setIndex(i))}>
            <Cover game={g} />
            {g.running && <span className="bp-card-live" />}
          </button>
        ))}
      </div>

      <footer className="bp-help">
        <span><PadButton family={pad.family} name="a" /> {game?.running ? 'En cours' : 'Jouer'}</span>
        <span><PadButton family={pad.family} name="x" /> Favori</span>
        <span><PadButton family={pad.family} name="y" /> Fiche du jeu</span>
        <span><PadButton family={pad.family} name="lb" /><PadButton family={pad.family} name="rb" /> Catégorie</span>
        <span><PadButton family={pad.family} name="b" /> Quitter</span>
        <span className="bp-keys">Clavier : ← → · ↑ ↓ · Entrée · F · I · Échap</span>
      </footer>
    </div>
  );
}
