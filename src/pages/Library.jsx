import { useEffect, useState } from 'react';
import { ArrowDownAZ, Clock, Download, EyeOff, Plus, RefreshCw, SearchX, Timer } from 'lucide-react';
import { useApp, SOURCES } from '../lib/context.jsx';
import { Select } from '../components/ui.jsx';
import GameCard from '../components/GameCard.jsx';

const FILTERS = [
  ['all', 'Tous', () => true],
  ['fav', 'Favoris', (g) => g.favorite],
  ['mods', 'Avec mods', (g) => g.cheatCount > 0],
  ['running', 'En cours', (g) => g.running],
  ['steam', 'Steam', (g) => g.source === 'steam'],
  ['epic', 'Epic', (g) => g.source === 'epic'],
  ['gog', 'GOG', (g) => g.source === 'gog'],
  ['ubisoft', 'Ubisoft', (g) => g.source === 'ubisoft'],
  ['battlenet', 'Battle.net', (g) => g.source === 'battlenet'],
  ['ea', 'EA', (g) => g.source === 'ea'],
  ['custom', 'Perso', (g) => g.source === 'custom'],
];

const SORT_OPTIONS = [
  ['name', 'Trier par nom', ArrowDownAZ],
  ['recent', 'Joués récemment', Clock],
  ['playtime', 'Temps de jeu', Timer],
];

const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  recent: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0),
  playtime: (a, b) => (b.playtime || 0) - (a.playtime || 0),
};

// Jeux possédés mais pas installés : comptes Steam, Epic et GOG connectés, launcher Epic, GOG Galaxy
// Dernière liste connue, gardée entre deux pages : l'Accueil et Mes jeux l'affichent tout de suite
// au lieu de repartir de zéro, puis la mettent à jour en arrière-plan. null = jamais chargée.
let ownedCache = null;

export function useOwnedGames() {
  const [owned, setOwned] = useState(ownedCache);
  useEffect(() => {
    const load = () => window.pimplay.library.owned().then((list) => { ownedCache = list; setOwned(list); }).catch(() => {});
    load();
    const offs = ['steam', 'epic', 'gog', 'library'].map((channel) => window.pimplay.on(channel, load));
    return () => offs.forEach((off) => off());
  }, []);
  return owned;
}

export default function Library() {
  const { library, setLibrary, query, guard, toast, settings, navigate, modTools } = useApp();
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const allOwned = (useOwnedGames() || []).filter((g) => !g.hidden);
  const [ownedSource, setOwnedSource] = useState('all');
  const ownedSources = [...new Set(allOwned.map((g) => g.source))];
  const owned = allOwned.filter((g) => ownedSource === 'all' || g.source === ownedSource);
  const filterEnabled = settings.showHiddenFilter !== false;
  const hiddenTotal = library.filter((g) => g.hidden).length;
  const hiddenCount = filterEnabled ? hiddenTotal : 0;
  const showHidden = filter === 'hidden';
  const showOwned = filter === 'owned';
  const fn = showHidden || showOwned ? () => true : FILTERS.find((f) => f[0] === filter)[2];
  const pool = showOwned ? owned : library.filter((g) => !!g.hidden === showHidden);
  const q = query.trim().toLowerCase();
  const [sort, setSort] = useState(() => { try { return localStorage.getItem('pimplay.sort') || 'name'; } catch { return 'name'; } });
  const changeSort = (v) => { setSort(v); try { localStorage.setItem('pimplay.sort', v); } catch {} };
  const games = pool
    .filter((g) => fn(g) && (!q || g.name.toLowerCase().includes(q)))
    .sort(SORTS[sort] || SORTS.name);
  useEffect(() => {
    if ((showHidden && !hiddenCount) || (showOwned && !allOwned.length) || (!modTools && filter === 'mods')) setFilter('all');
    if (ownedSource !== 'all' && !ownedSources.includes(ownedSource)) setOwnedSource('all');
  }, [showHidden, hiddenCount, showOwned, allOwned.length, modTools, filter, ownedSource, ownedSources.join()]);

  const refresh = guard(async () => {
    setBusy(true);
    try {
      window.pimplay.steam.refresh();
      const lib = await window.pimplay.library.refresh();
      setLibrary(lib);
      toast(`${lib.length} jeux détectés`);
    } finally {
      setBusy(false);
    }
  });

  const add = guard(async () => {
    const res = await window.pimplay.library.addCustom();
    if (!res) return;
    setLibrary(res.library);
    toast(res.matched
      ? `Jeu ajouté — infos Steam de « ${res.matched} » récupérées`
      : 'Jeu ajouté — utilisez « Personnaliser » pour récupérer ses infos Steam');
    if (res.id) navigate('game', { id: res.id });
  });

  return (
    <div className="page library-page">
      <div className="page-head">
        <h1>Mes jeux</h1>
        <span className="pill accent">{library.length - hiddenTotal} installés</span>
        <div className="grow" />
        <Select value={sort} onChange={changeSort} label="Trier" width={200} options={SORT_OPTIONS} />
        <button className="btn" onClick={refresh} disabled={busy}><RefreshCw className={busy ? 'spin' : ''} /> Actualiser</button>
        <button className="btn primary" onClick={add}><Plus /> Ajouter un jeu</button>
      </div>
      <div className="chips" style={{ marginBottom: 18 }}>
        {FILTERS.filter(([k, , f]) => k === 'all' || ((modTools || k !== 'mods') && library.some((g) => !g.hidden && f(g)))).map(([k, label]) => (
          <button key={k} className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
        {allOwned.length > 0 && (
          <button className={`chip ${showOwned ? 'active' : ''}`} onClick={() => setFilter('owned')}>
            <Download size={13} style={{ verticalAlign: -2, marginRight: 5 }} />Non installés ({allOwned.length})
          </button>
        )}
        {hiddenCount > 0 && (
          <button className={`chip ${showHidden ? 'active' : ''}`} onClick={() => setFilter('hidden')} style={{ marginLeft: 'auto' }}>
            <EyeOff size={13} style={{ verticalAlign: -2, marginRight: 5 }} />Masqués ({hiddenCount})
          </button>
        )}
      </div>
      {showHidden && (
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '-8px 0 18px' }}>
          Ces jeux n'apparaissent nulle part ailleurs dans Pimplay. Survolez une jaquette et cliquez sur l'œil pour en réafficher un.
        </p>
      )}
      {showOwned && (
        <div className="owned-head">
          <p>
            Jeux de vos comptes qui ne sont pas sur ce PC : Steam, Epic, et via GOG Galaxy les jeux GOG, Ubisoft, EA et Battle.net.
            Cliquez sur une jaquette pour l'installer avec son launcher.
          </p>
          {ownedSources.length > 1 && (
            <div className="chips small">
              {['all', ...ownedSources].map((s) => (
                <button key={s} className={`chip ${ownedSource === s ? 'active' : ''}`} onClick={() => setOwnedSource(s)}>
                  {s === 'all' ? 'Tous' : SOURCES[s]} ({s === 'all' ? allOwned.length : allOwned.filter((g) => g.source === s).length})
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Seule la grille défile ; l'en-tête et les filtres restent en place */}
      <div className="library-scroll">
        {games.length ? (
          <div className="grid">{games.map((g) => <GameCard key={g.id} game={g} />)}</div>
        ) : (
          <div className="empty">
            <SearchX />
            <h3>Aucun jeu</h3>
            <p>{q ? `Aucun résultat pour « ${query} ».` : 'Aucun jeu ne correspond à ce filtre.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
