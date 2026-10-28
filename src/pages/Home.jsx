import { useEffect, useState } from 'react';
import { Clock, Gamepad2, Play, ScanSearch, Timer, Trophy, Wand2, Zap } from 'lucide-react';
import { useApp, SOURCES, formatPlaytime, timeAgo } from '../lib/context.jsx';
import { Cover, GameLogo } from '../components/ui.jsx';
import GameCard from '../components/GameCard.jsx';
import EpicFreeGames from '../components/EpicFreeGames.jsx';
import { useOwnedGames } from './Library.jsx';

let lifetimeCache = null;

export default function Home() {
  const { games: library, navigate, session, modTools, settings } = useApp();
  // Jeux possédés, toutes plateformes et jeux perso compris : installés + possédés non installés
  const owned = useOwnedGames();
  const ownedCount = owned ? library.length + owned.filter((g) => !g.hidden).length : null;
  // Temps de jeu depuis toujours, toutes plateformes (même calcul que Statistiques › Depuis toujours) ;
  // la dernière valeur connue s'affiche tout de suite en revenant sur l'Accueil
  const [lifetimeTotal, setLifetimeTotal] = useState(lifetimeCache);
  useEffect(() => {
    const load = () => window.pimplay.stats.lifetime().then((d) => { lifetimeCache = d.total; setLifetimeTotal(d.total); }).catch(() => {});
    load();
    return window.pimplay.on('sessions', load);
  }, []);
  const openLifetime = () => {
    try { localStorage.setItem('pimplay.statsPeriod', 'all'); } catch {}
    navigate('stats');
  };
  const byRecent = [...library].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  const byPlaytime = library.filter((g) => g.playtime > 0).sort((a, b) => b.playtime - a.playtime);
  const featured = library.find((g) => g.running) || byRecent[0];
  const modded = library.filter((g) => g.cheatCount > 0);
  const recent = byRecent.filter((g) => g.lastPlayed).slice(0, 7);
  const totalMods = library.reduce((s, g) => s + g.cheatCount, 0);

  let heroText = `${timeAgo(featured?.lastPlayed)}.`;
  if (featured && modTools) {
    heroText = featured.cheatCount > 0
      ? `${featured.cheatCount} mod${featured.cheatCount > 1 ? 's' : ''} prêt${featured.cheatCount > 1 ? 's' : ''} pour ce jeu. ${heroText}`
      : `Aucun mod encore — créez-en avec le scanner mémoire. ${heroText}`;
  } else if (featured?.info?.description) {
    heroText = featured.info.description;
  }

  return (
    <div className="page">
      {featured ? (
        <section className="hero">
          <Cover game={featured} kind="hero" className="hero-bg" />
          <div className="hero-content">
            <div className="hero-kicker">{featured.running ? 'En cours' : 'Reprendre'} · {SOURCES[featured.source]}</div>
            <HeroTitle game={featured} />
            <p className={modTools ? '' : 'hero-desc'}>
              {heroText}
              {modTools && formatPlaytime(featured.playtime) && ` ${formatPlaytime(featured.playtime)} de jeu.`}
            </p>
            <div className="hero-actions">
              <button className="btn primary big" onClick={() => navigate('game', { id: featured.id })}>
                <Play fill="currentColor" /> {featured.running ? (modTools ? 'Ouvrir les mods' : 'En cours') : 'Jouer'}
              </button>
              {!modTools && formatPlaytime(featured.playtime) && (
                <span className="pill"><Timer size={13} /> {formatPlaytime(featured.playtime)} de jeu</span>
              )}
            </div>
          </div>
        </section>
      ) : (
        <div className="empty">
          <Gamepad2 />
          <h3>Aucun jeu trouvé</h3>
          <p>Pimplay n'a détecté aucun jeu Steam, Epic ou GOG. Ajoutez un jeu manuellement depuis « Mes jeux ».</p>
          <button className="btn primary" onClick={() => navigate('library')}>Mes jeux</button>
        </div>
      )}

      <div className="stats">
        <button className="stat stat-link" onClick={() => navigate('library')} title="Voir Mes jeux">
          <div className="label"><Gamepad2 /> Jeux possédés</div>
          {/* Pas de chiffre provisoire faux pendant le tout premier chargement */}
          <div className="value">{ownedCount !== null ? ownedCount.toLocaleString('fr-FR') : <span className="value-loading" />}</div>
          <div className="stat-note">dont {library.length} installé{library.length > 1 ? 's' : ''}, toutes plateformes</div>
        </button>
        <button className="stat stat-link" onClick={openLifetime} title="Voir le détail dans Statistiques">
          <div className="label"><Timer /> Temps de jeu total</div>
          <div className="value">{lifetimeTotal !== null ? formatPlaytime(lifetimeTotal) || '—' : <span className="value-loading" />}</div>
          <div className="stat-note">depuis toujours, toutes plateformes</div>
        </button>
        {modTools ? (
          <>
            <div className="stat"><div className="label"><Wand2 /> Mods créés</div><div className="value">{totalMods}</div></div>
            <div className="stat"><div className="label"><Zap /> Trainer</div><div className="value small">{session?.attached ? `Connecté · ${session.exe}` : 'Inactif'}</div></div>
          </>
        ) : (
          <>
            <div className="stat"><div className="label"><Trophy /> Le plus joué</div><div className="value small" title={byPlaytime[0]?.name}>{byPlaytime[0]?.name || '—'}</div></div>
            <div className="stat"><div className="label"><Clock /> Dernière partie</div><div className="value small">{recent[0] ? timeAgo(recent[0].lastPlayed) : '—'}</div></div>
          </>
        )}
      </div>

      {recent.length > 0 && (
        <>
          <h2 className="section">Joués récemment</h2>
          <div className="grid">{recent.map((g) => <GameCard key={g.id} game={g} />)}</div>
        </>
      )}

      {settings.showEpicFree !== false && <EpicFreeGames />}

      {modTools ? (
        <>
          <h2 className="section">Jeux avec mods <span className="count">{modded.length}</span></h2>
          {modded.length ? (
            <div className="grid">{modded.map((g) => <GameCard key={g.id} game={g} />)}</div>
          ) : (
            <div className="empty">
              <ScanSearch />
              <h3>Créez votre premier mod</h3>
              <p>Lancez un jeu solo, ouvrez le scanner mémoire, cherchez une valeur (vie, argent, munitions…) puis transformez-la en mod activable par raccourci.</p>
              <button className="btn primary" onClick={() => navigate('scanner')}><ScanSearch /> Ouvrir le scanner</button>
            </div>
          )}
        </>
      ) : byPlaytime.length > 0 && (
        <>
          <h2 className="section">Les plus joués</h2>
          <div className="grid">{byPlaytime.slice(0, 7).map((g) => <GameCard key={g.id} game={g} />)}</div>
        </>
      )}
    </div>
  );
}

function HeroTitle({ game }) {
  return <GameLogo game={game} fallback={<h1>{game.name}</h1>} />;
}
