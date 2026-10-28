import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CornerDownLeft, Gamepad, Home, LibraryBig, Play, ScanSearch, Search, Settings } from 'lucide-react';
import { useApp, SOURCES, formatPlaytime } from '../lib/context.jsx';
import { Cover } from './ui.jsx';

// Recherche tolérante : préfixe > mot qui commence > contient > lettres dans l'ordre (« cl ob » → Clair Obscur)
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function score(name, q) {
  const n = norm(name);
  if (!q) return 1;
  if (n.startsWith(q)) return 100 - n.length / 100;
  if (n.split(/[\s:\-–'’]+/).some((w) => w.startsWith(q))) return 80;
  if (n.includes(q)) return 60;
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => n.includes(p))) return 50;
  let i = 0;
  for (const ch of n) if (ch === q[i]) i++;
  return i === q.length ? 20 : 0;
}

export default function CommandPalette() {
  const { games, navigate, modTools, setBigPicture, guard } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQ('');
        setSel(0);
      }
    };
    const onOpen = () => { setOpen(true); setQ(''); setSel(0); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pimplay:palette', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pimplay:palette', onOpen); };
  }, []);

  const pages = useMemo(() => [
    { kind: 'page', id: 'home', label: 'Accueil', icon: Home, run: () => navigate('home') },
    { kind: 'page', id: 'library', label: 'Mes jeux', icon: LibraryBig, run: () => navigate('library') },
    { kind: 'page', id: 'stats', label: 'Statistiques', icon: BarChart3, run: () => navigate('stats') },
    ...(modTools ? [{ kind: 'page', id: 'scanner', label: 'Scanner mémoire', icon: ScanSearch, run: () => navigate('scanner') }] : []),
    { kind: 'page', id: 'settings', label: 'Paramètres', icon: Settings, run: () => navigate('settings') },
    { kind: 'page', id: 'bigpicture', label: 'Mode manette (plein écran)', icon: Gamepad, run: () => setBigPicture(true) },
  ], [navigate, modTools, setBigPicture]);

  const items = useMemo(() => {
    const query = norm(q.trim());
    if (!games) return [];
    if (!query) {
      const recent = [...games].filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 6);
      return [...recent.map((g) => ({ kind: 'game', id: g.id, game: g })), ...pages];
    }
    const found = games
      .map((g) => ({ g, s: score(g.name, query) + (g.running ? 5 : 0) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map(({ g }) => ({ kind: 'game', id: g.id, game: g }));
    return [...found, ...pages.filter((p) => score(p.label, query) > 0)];
  }, [q, games, pages]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;
  const close = () => setOpen(false);

  const run = guard(async (item, openSheet) => {
    close();
    if (item.kind === 'page') return item.run();
    if (openSheet || item.game.running) return navigate('game', { id: item.id });
    navigate('game', { id: item.id }); // la fiche affiche la progression du lancement
    await window.pimplay.game.launch(item.id);
  });

  const onKeyDown = (e) => {
    if (e.key === 'Escape') return close();
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && items[sel]) { e.preventDefault(); run(items[sel], e.shiftKey || e.ctrlKey); }
  };

  const firstPage = items.findIndex((it) => it.kind === 'page');
  const hasGames = items.some((it) => it.kind === 'game');

  return (
    <div className="palette-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Recherche rapide">
        <label className="palette-input">
          <Search />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder="Lancer un jeu, aller à une page…" />
          <kbd className="kbd">Échap</kbd>
        </label>
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && <div className="palette-empty">Aucun résultat pour « {q} »</div>}
          {items.map((it, i) => (
            <div key={`${it.kind}-${it.id}`}>
              {i === 0 && hasGames && <div className="palette-group">{q.trim() ? 'Jeux' : 'Joués récemment'}</div>}
              {i === firstPage && <div className="palette-group">Aller à</div>}
              <button
                data-i={i}
                className={`palette-item ${i === sel ? 'sel' : ''}`}
                onMouseMove={() => setSel(i)}
                onClick={(e) => run(it, e.shiftKey)}
              >
                {it.kind === 'game' ? (
                  <>
                    <span className="palette-thumb"><Cover game={it.game} /></span>
                    <span className="palette-main">
                      <span className="palette-name">{it.game.name}</span>
                      <span className="palette-sub">
                        {SOURCES[it.game.source]}{formatPlaytime(it.game.playtime) ? ` · ${formatPlaytime(it.game.playtime)}` : ''}
                      </span>
                    </span>
                    {it.game.running && <span className="pill ok"><span className="dot" /> En cours</span>}
                    {i === sel && <span className="palette-hint">{it.game.running ? 'Ouvrir' : <><Play size={12} fill="currentColor" /> Jouer</>}</span>}
                  </>
                ) : (
                  <>
                    <span className="palette-icon"><it.icon /></span>
                    <span className="palette-main"><span className="palette-name">{it.label}</span></span>
                    {i === sel && <span className="palette-hint"><CornerDownLeft size={12} /></span>}
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> naviguer</span>
          <span><kbd className="kbd">Entrée</kbd> jouer</span>
          <span><kbd className="kbd">Maj</kbd>+<kbd className="kbd">Entrée</kbd> ouvrir la fiche</span>
        </div>
      </div>
    </div>
  );
}
