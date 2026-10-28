import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Clock, Gamepad2, Hourglass, Layers, Loader2, Timer, Trophy } from 'lucide-react';
import { useApp, SOURCES, timeAgo } from '../lib/context.jsx';
import { Cover, Seg } from '../components/ui.jsx';
import {
  PERIODS, computeStats, formatAxis, formatBucket, formatDuration, formatSessionDate, niceTicks,
} from '../lib/stats.js';
import './Stats.css';

const SOURCE_LABELS = { ...SOURCES, xbox: 'Xbox', playstation: 'PlayStation' };
const percent = (part, total) => { const p = (part / total) * 100; return p < 0.5 ? '<1 %' : `${Math.round(p)} %`; };
const LIFETIME_ROWS = 60;

// « Depuis toujours » : totaux des launchers (Steam, GOG Galaxy) et de Pimplay, sans détail par jour
function Lifetime() {
  const { navigate } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [source, setSource] = useState('all'); // filtre de la liste par plateforme
  useEffect(() => {
    window.pimplay.stats.lifetime().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="empty"><BarChart3 /><h3>Totaux indisponibles</h3><p>{error}</p></div>;
  if (!data) return <div className="lifetime-loading"><Loader2 className="spin" /> Lecture des temps de jeu de Steam, GOG Galaxy et Pimplay…</div>;
  if (!data.games.length) {
    return <div className="empty"><BarChart3 /><h3>Aucun temps de jeu trouvé</h3><p>Ni Steam, ni GOG Galaxy, ni Pimplay n'ont de temps de jeu enregistré sur ce PC.</p></div>;
  }
  const ms = (s) => s * 1000;
  const top = data.games[0];
  // Plateforme choisie : temps passé sur cette plateforme uniquement, classement recalculé
  const secondsOf = (g) => (source === 'all' ? g.seconds : g.perSource?.[source] || 0);
  const list = source === 'all' ? data.games : data.games.filter((g) => secondsOf(g) > 0).sort((a, b) => secondsOf(b) - secondsOf(a));
  const listTotal = source === 'all' ? data.total : data.bySource.find(([s]) => s === source)?.[1] || 0;
  const listTop = list.length ? secondsOf(list[0]) : 1;
  const countOf = (s) => data.games.filter((g) => (g.perSource?.[s] || 0) > 0).length;
  const pick = (s) => setSource((cur) => (cur === s ? 'all' : s));

  return (
    <>
      <div className="stats">
        <div className="stat"><div className="label"><Timer /> Temps de jeu total</div><div className="value">{formatDuration(ms(data.total), { compact: true })}</div></div>
        <div className="stat"><div className="label"><Gamepad2 /> Jeux joués</div><div className="value">{data.games.length}</div></div>
        <div className="stat"><div className="label"><Layers /> Plateformes</div><div className="value">{data.bySource.length}</div></div>
        <div className="stat">
          <div className="label"><Trophy /> Le plus joué</div>
          <div className="value small" title={top.name}>{top.name}</div>
          <div className="stat-note">{formatDuration(ms(top.seconds), { compact: true })}</div>
        </div>
      </div>

      <div className="stats-cols lifetime-cols">
        <section className="panel">
          <div className="panel-head"><h3><Gamepad2 /> Jeux les plus joués</h3><span className="pill accent">{list.length}</span></div>
          {data.bySource.length > 1 && (
            <div className="chips small lifetime-filter">
              <button className={`chip ${source === 'all' ? 'active' : ''}`} onClick={() => setSource('all')}>Toutes ({data.games.length})</button>
              {data.bySource.map(([s]) => (
                <button key={s} className={`chip ${source === s ? 'active' : ''}`} onClick={() => pick(s)}>
                  {SOURCE_LABELS[s] || s} ({countOf(s)})
                </button>
              ))}
            </div>
          )}
          <div className="panel-body top-games lifetime-list">
            {list.slice(0, LIFETIME_ROWS).map((g, i) => (
              <button key={g.key} className="top-game" onClick={() => g.gameId && navigate('game', { id: g.gameId })} disabled={!g.gameId}>
                <span className="lifetime-rank">{i + 1}</span>
                <span className="top-game-cover"><Cover game={g.cover} /></span>
                <span className="top-game-main">
                  <span className="top-game-name">{g.name}</span>
                  <span className="top-game-track"><span style={{ width: `${(secondsOf(g) / listTop) * 100}%` }} /></span>
                  <span className="lifetime-sub">
                    {g.sources.map((s) => SOURCE_LABELS[s] || s).join(' · ')}
                    {g.lastPlayed && ` — ${timeAgo(g.lastPlayed).toLowerCase()}`}
                  </span>
                </span>
                <span className="top-game-value">
                  {formatDuration(ms(secondsOf(g)), { compact: true })}
                  <small>{percent(secondsOf(g), listTotal)}</small>
                </span>
              </button>
            ))}
            {list.length > LIFETIME_ROWS && (
              <span className="muted-line" style={{ padding: '8px 6px 2px' }}>
                Et {list.length - LIFETIME_ROWS} autres jeux, pour {formatDuration(ms(list.slice(LIFETIME_ROWS).reduce((a, g) => a + secondsOf(g), 0)), { compact: true })}.
              </span>
            )}
          </div>
        </section>

        <section className="panel lifetime-sources">
          <div className="panel-head"><h3><Layers /> Par plateforme</h3></div>
          <div className="panel-body">
            {data.bySource.map(([s, sec]) => (
              <button key={s} className={`source-row ${source === s ? 'active' : ''}`} onClick={() => pick(s)} title={`Voir les jeux ${SOURCE_LABELS[s] || s}`}>
                <span className="source-name">{SOURCE_LABELS[s] || s}</span>
                <span className="top-game-track"><span style={{ width: `${(sec / data.bySource[0][1]) * 100}%` }} /></span>
                <span className="source-value">
                  {formatDuration(ms(sec), { compact: true })}
                  <small>{percent(sec, data.total)}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <p className="stats-foot">
        Totaux depuis toujours, jeux désinstallés compris : temps de jeu de Steam (tous les comptes de ce PC){data.galaxy && ', de GOG Galaxy (GOG, Epic, Ubisoft, EA, Battle.net, Xbox… selon les comptes reliés à Galaxy)'} et
        temps suivi par Pimplay. Les launchers ne gardent pas le détail des parties : il n'y a donc pas de graphique par jour sur cette période.
        Un même jeu sur deux plateformes cumule ses deux temps. Les jeux masqués ne sont pas comptés.
        {data.galaxy && ' Ouvrez GOG Galaxy de temps en temps pour que ses totaux restent à jour.'}
      </p>
    </>
  );
}

export function useSessions() {
  const [data, setData] = useState(null);
  useEffect(() => {
    const load = () => window.pimplay.stats.sessions().then(setData);
    load();
    const off = window.pimplay.on('sessions', load);
    const t = setInterval(load, 60000); // les parties en cours avancent
    return () => { off(); clearInterval(t); };
  }, []);
  return data;
}

export default function Stats() {
  const { library, navigate } = useApp();
  const data = useSessions();
  const [period, setPeriod] = useState(() => { try { return localStorage.getItem('pimplay.statsPeriod') || '7'; } catch { return '7'; } });
  const changePeriod = (p) => { setPeriod(p); try { localStorage.setItem('pimplay.statsPeriod', p); } catch {} };

  // Les jeux masqués restent hors des statistiques, comme partout ailleurs
  const hidden = useMemo(() => new Set(library.filter((g) => g.hidden).map((g) => g.id)), [library]);
  const gameOf = (id) => library.find((g) => g.id === id);
  const lifetime = period === 'all';
  const stats = useMemo(
    () => data && !lifetime && computeStats(data.sessions.filter((s) => !hidden.has(s.g)), period),
    [data, period, hidden, lifetime],
  );

  const head = (
    <div className="page-head">
      <h1>Statistiques</h1>
      <div className="grow" />
      <div className="stats-periods"><Seg value={period} options={PERIODS} onChange={changePeriod} /></div>
    </div>
  );
  if (lifetime) return <div className="page">{head}<Lifetime /></div>;
  if (!stats) return null;
  const since = new Date(data.since).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const empty = stats.totalMs === 0;

  return (
    <div className="page">
      {head}

      <div className="stats">
        <div className="stat"><div className="label"><Timer /> Temps de jeu</div><div className="value">{formatDuration(stats.totalMs, { compact: true })}</div></div>
        <div className="stat"><div className="label"><Gamepad2 /> Sessions</div><div className="value">{stats.sessionCount}</div></div>
        <div className="stat"><div className="label"><Hourglass /> Session moyenne</div><div className="value">{stats.sessionCount ? formatDuration(stats.avgMs, { compact: true }) : '—'}</div></div>
        <div className="stat">
          <div className="label"><CalendarDays /> Jours joués</div>
          <div className="value">{stats.playedDays}<span className="stat-of"> / {stats.dayCount}</span></div>
        </div>
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h3><BarChart3 /> Temps de jeu {stats.monthly ? 'par mois' : 'par jour'}</h3>
        </div>
        <div className="panel-body">
          {empty ? (
            <div className="empty" style={{ padding: 36 }}>
              <BarChart3 />
              <h3>Pas encore de partie sur cette période</h3>
              <p>Pimplay enregistre chaque partie (tous launchers confondus) tant qu'il est ouvert ou réduit près de l'horloge.</p>
            </div>
          ) : (
            <ColumnChart stats={stats} period={period} gameOf={gameOf} />
          )}
        </div>
      </section>

      <div className="stats-cols">
        <section className="panel">
          <div className="panel-head"><h3><Gamepad2 /> Jeux les plus joués</h3></div>
          <div className="panel-body top-games">
            {stats.top.length === 0 && <span className="muted-line">Aucun jeu sur cette période.</span>}
            {stats.top.slice(0, 8).map(({ g, ms }) => {
              const game = gameOf(g);
              return (
                <button key={g} className="top-game" onClick={() => game && navigate('game', { id: g })} disabled={!game}>
                  <span className="top-game-cover">{game ? <Cover game={game} /> : null}</span>
                  <span className="top-game-main">
                    <span className="top-game-name">{game?.name || 'Jeu retiré de la bibliothèque'}</span>
                    <span className="top-game-track"><span style={{ width: `${(ms / stats.top[0].ms) * 100}%` }} /></span>
                  </span>
                  <span className="top-game-value">
                    {formatDuration(ms, { compact: true })}
                    <small>{Math.round((ms / stats.totalMs) * 100)} %</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h3><Clock /> Sessions</h3><span className="pill accent">{stats.recent.length}</span></div>
          <div className="results-wrap" style={{ maxHeight: 430 }}>
            {stats.recent.length === 0 ? (
              <div className="panel-body"><span className="muted-line">Aucune session sur cette période.</span></div>
            ) : (
              <table className="results sessions-table">
                <thead><tr><th>Jeu</th><th>Début</th><th style={{ textAlign: 'right' }}>Durée</th></tr></thead>
                <tbody>
                  {stats.recent.slice(0, 100).map((s) => {
                    const game = gameOf(s.g);
                    return (
                      <tr key={`${s.g}-${s.s}`}>
                        <td>
                          <span className="session-game">
                            <span className="session-thumb">{game ? <Cover game={game} /> : null}</span>
                            {game?.name || 'Jeu retiré'}
                            {s.live && <span className="pill ok" style={{ height: 20 }}><span className="dot" /> En cours</span>}
                          </span>
                        </td>
                        <td style={{ color: 'var(--muted)' }}>{formatSessionDate(s.s)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatDuration(s.e - s.s, { compact: true })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <p className="stats-foot">
        Historique enregistré par Pimplay depuis le {since}, pour tous vos jeux (Steam compris), tant que Pimplay est ouvert
        ou réduit près de l'horloge. Les jeux masqués ne sont pas comptés.
      </p>
    </div>
  );
}

// Colonnes (une série) : barres fines arrondies en haut, grille discrète, infobulle au survol
function ColumnChart({ stats, period, gameOf }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...stats.buckets.map((b) => b.ms));
  const { ticks, topMs, label } = niceTicks(max);
  const n = stats.buckets.length;
  const every = n > 14 ? Math.ceil(n / 10) : 1; // étiquettes de l'axe sans chevauchement
  const best = stats.buckets.reduce((a, b) => (b.ms > a.ms ? b : a));
  const hb = hover !== null ? stats.buckets[hover] : null;

  return (
    <div className="chart">
      <div className="chart-y">
        {ticks.map((t) => <span key={t} style={{ bottom: `${(t * 60000 / topMs) * 100}%` }}>{label(t)}</span>)}
      </div>
      <div className="chart-area">
        <div className="chart-plot" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => <div key={t} className="chart-grid" style={{ bottom: `${(t * 60000 / topMs) * 100}%` }} />)}
          {stats.buckets.map((b, i) => (
            <div key={b.key} className={`chart-col ${hover === i ? 'hover' : ''}`} onMouseEnter={() => setHover(i)}>
              {b.ms > 0 && (
                <div className="chart-bar" style={{ height: `${(b.ms / topMs) * 100}%` }}>
                  {b === best && hover === null && <span className="chart-best">{formatDuration(b.ms, { compact: true })}</span>}
                </div>
              )}
            </div>
          ))}
          {hb && (
            <div
              className={`chart-tip ${hover < n * 0.2 ? 'from-left' : hover > n * 0.8 ? 'from-right' : ''}`}
              style={{ left: `${((hover + 0.5) / n) * 100}%` }}
            >
              <strong>{formatBucket(hb, stats.monthly)}</strong>
              <span className="chart-tip-total">{hb.ms ? formatDuration(hb.ms) : 'Aucune partie'}</span>
              {[...hb.games].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g, ms]) => (
                <span key={g} className="chart-tip-row"><span>{gameOf(g)?.name || 'Jeu retiré'}</span><b>{formatDuration(ms, { compact: true })}</b></span>
              ))}
            </div>
          )}
        </div>
        <div className="chart-x">
          {stats.buckets.map((b, i) => (
            <span key={b.key} style={{ visibility: i % every === 0 || i === n - 1 ? 'visible' : 'hidden' }}>{formatAxis(b, stats.monthly, period)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
