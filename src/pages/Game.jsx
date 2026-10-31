import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Clock, Code2, Download, Eye, EyeOff, FolderOpen, Gamepad2, HardDrive, History, Loader2, MousePointerClick, Pencil, Play, Plus, Power,
  ScanSearch, Settings2, ShieldAlert, SlidersHorizontal, Snowflake, Square, Star, Timer, Trash2, Upload, Wand2, X,
} from 'lucide-react';
import { useApp, SOURCES, formatSize, formatPlaytime, timeAgo } from '../lib/context.jsx';
import { Cover, GameLogo, HotkeyInput, Modal, Toggle, formatHotkey, heroStyle } from '../components/ui.jsx';
import CheatEditor, { newCheat, CHEAT_VALUE_TYPES } from '../components/CheatEditor.jsx';
import MetaModal from '../components/MetaModal.jsx';
import { useSessions } from './Stats.jsx';
import { computeStats, formatBucket, formatDuration, formatSessionDate } from '../lib/stats.js';

const KIND_ICON = { freeze: Snowflake, slider: SlidersHorizontal, button: MousePointerClick, multiplier: X, patch: Code2 };
const KIND_LABEL = { freeze: 'Gel', slider: 'Curseur', button: 'Bouton', multiplier: 'Multiplicateur', patch: 'Patch' };
const TYPE_LABEL = Object.fromEntries(CHEAT_VALUE_TYPES);

function fmt(v) {
  if (v === null || v === undefined) return '—';
  return Number.isInteger(v) ? v.toLocaleString('fr-FR') : Number(v).toFixed(2);
}

export default function Game({ id }) {
  const { library, setLibrary, session, navigate, guard, toast, launching, modTools } = useApp();
  const game = library.find((g) => g.id === id);
  const [trainer, setTrainer] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editing, setEditing] = useState(null);
  const [customizing, setCustomizing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [flash, setFlash] = useState(null);

  // En-tête qui se replie : la position de défilement pilote la parallaxe de la bannière (variable CSS,
  // sans re-rendu) et l'apparition de la barre compacte une fois la bannière passée.
  const heroRef = useRef(null);
  const actionsRef = useRef(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const main = document.querySelector('.main');
    if (!main) return undefined;
    // Les événements scroll sont déjà alignés sur le rafraîchissement de l'écran ; setCompact ne
    // provoque un rendu que lorsque la valeur change. La barre compacte prend le relais quand les
    // grands boutons (Jouer…) passent sous elle, pour ne jamais les afficher en double.
    // --sy est posée sur la bannière seule, et figée une fois qu'elle a quitté l'écran : sur toute la
    // page, cette variable héritée faisait recalculer le style de chaque mod à chaque cran de défilement.
    const onScroll = () => {
      heroRef.current?.style.setProperty('--sy', String(Math.min(main.scrollTop, 800)));
      const actions = actionsRef.current?.getBoundingClientRect();
      setCompact(!!actions && actions.bottom < main.getBoundingClientRect().top + 64);
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => { window.pimplay.trainer.get(id).then(setTrainer); }, [id]);
  useEffect(() => window.pimplay.on('hotkey', ({ id: cid }) => {
    setFlash(cid);
    setTimeout(() => setFlash(null), 600);
  }), []);

  const groups = useMemo(() => {
    const m = new Map();
    for (const c of trainer?.cheats || []) {
      const k = c.category || 'Général';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(c);
    }
    return [...m];
  }, [trainer]);

  if (!game) {
    return <div className="page"><div className="empty"><h3>Jeu introuvable</h3><button className="btn" onClick={() => navigate('library')}>Retour</button></div></div>;
  }

  const active = session?.gameId === id;
  const attached = active && session.attached;
  const st = (cid) => (active ? session.cheats[cid] : null);

  const save = guard(async (t) => {
    const saved = await window.pimplay.trainer.save(id, t);
    setTrainer(saved);
    setLibrary((lib) => lib.map((g) => (g.id === id ? { ...g, cheatCount: saved.cheats.length } : g)));
    return saved;
  });

  const ensureActive = async () => {
    if (!active) await window.pimplay.session.activate(id);
  };

  const play = guard(() => window.pimplay.game.launch(id));
  const launchStage = launching?.gameId === id ? launching.stage : null;
  const LAUNCHER_NAME = { steam: 'Steam', epic: 'Epic Games', ubisoft: 'Ubisoft Connect', battlenet: 'Battle.net', ea: "l'EA app" };
  const activate = guard(() => window.pimplay.session.activate(id));
  const deactivate = guard(() => window.pimplay.session.deactivate());
  const toggle = guard(async (cid, on) => { await ensureActive(); await window.pimplay.cheat.toggle(cid, on); });
  const setValue = guard(async (cid, v) => { await ensureActive(); await window.pimplay.cheat.setValue(cid, v); });
  const trigger = guard(async (cid) => { await window.pimplay.cheat.trigger(cid); });
  const favorite = guard(async () => setLibrary(await window.pimplay.library.favorite(id, !game.favorite)));
  const toggleHidden = guard(async () => {
    setLibrary(await window.pimplay.library.hide(id, !game.hidden));
    toast(game.hidden ? `${game.name} est de nouveau visible` : 'Jeu masqué — retrouvez-le dans Mes jeux › Masqués');
  });
  const importT = guard(async () => {
    const t = await window.pimplay.trainer.import(id);
    if (t) { setTrainer(t); setLibrary((lib) => lib.map((g) => (g.id === id ? { ...g, cheatCount: t.cheats.length } : g))); toast(`${t.cheats.length} mods importés`); }
  });
  const exportT = guard(async () => { if (await window.pimplay.trainer.export(id)) toast('Trainer exporté'); });
  const removeCustom = guard(async () => { setLibrary(await window.pimplay.library.removeCustom(id)); navigate('library'); });

  const upsert = async (cheat) => {
    const cheats = trainer.cheats.some((c) => c.id === cheat.id)
      ? trainer.cheats.map((c) => (c.id === cheat.id ? cheat : c))
      : [...trainer.cheats, cheat];
    if (await save({ ...trainer, cheats })) setEditing(null);
  };
  const remove = (cid) => save({ ...trainer, cheats: trainer.cheats.filter((c) => c.id !== cid) });
  const setHotkey = (cid, hotkey) => {
    const clash = hotkey && trainer.cheats.find((c) => c.id !== cid && c.hotkey === hotkey);
    if (clash) return toast(`${formatHotkey(hotkey)} est déjà utilisé par « ${clash.name} »`, 'error');
    save({ ...trainer, cheats: trainer.cheats.map((c) => (c.id === cid ? { ...c, hotkey } : c)) });
  };

  let status;
  if (game.antiCheat) status = <span className="pill danger"><span className="dot" /> Anti-triche détecté</span>;
  else if (!active) status = <span className="pill"><span className="dot" /> Mods désactivés</span>;
  else if (attached) status = <span className="pill ok"><span className="dot" /> Connecté · {session.exe} · {session.is32 ? '32' : '64'} bits</span>;
  else if (session.error) status = <span className="pill danger"><span className="dot" /> {session.error}</span>;
  else status = <span className="pill warn"><span className="dot" /> {game.running ? 'Connexion…' : 'En attente du lancement du jeu'}</span>;
  // Mode launcher : seul l'état « en cours » compte
  if (!modTools) status = game.running ? <span className="pill ok"><span className="dot" /> En cours</span> : null;

  return (
    <div className="game-page">
      {/* Barre fixe : retour toujours visible ; mini-fiche + action principale une fois la bannière passée */}
      <div className={`game-bar ${compact ? 'compact' : ''}`}>
        <button className="btn sm game-back" onClick={() => navigate('library')}><ArrowLeft /> Mes jeux</button>
        <div className="game-bar-info">
          <div className="game-bar-cover"><Cover game={game} /></div>
          <strong>{game.name}</strong>
          {status}
        </div>
        <div className="grow" />
        <div className="game-bar-actions">
          {game.running ? (
            <>
              {modTools && !active && !game.antiCheat && <button className="btn sm primary" onClick={activate}><Power /> Activer les mods</button>}
              <button className="btn sm stop" onClick={() => setStopping(true)}><Square /> Arrêter</button>
            </>
          ) : launchStage ? (
            <button className="btn sm primary" disabled style={{ opacity: 0.9 }}><Loader2 className="spin" /> Lancement…</button>
          ) : (
            <button className="btn sm primary" onClick={play}><Play fill="currentColor" /> Jouer</button>
          )}
        </div>
      </div>

      {/* Bannière au format Steam (~3:1), pleine luminosité, fondu seulement en bas */}
      <div className="game-hero" ref={heroRef}>
        <Cover game={game} kind="hero" className="game-hero-img" style={heroStyle(game)} />
      </div>
      <div className="game-inner">
        <div className="game-top">
          <div className="cover-sm"><Cover game={game} /></div>
          <div className="game-title">
            <GameLogo game={game} fallback={<h1>{game.name}</h1>} />
            <div className="game-meta">
              <span>{SOURCES[game.source]}</span>
              {formatSize(game.sizeOnDisk) && <span><HardDrive /> {formatSize(game.sizeOnDisk)}</span>}
              {formatPlaytime(game.playtime) && (
                <span title={game.playtimeSource === 'steam' ? 'Temps de jeu Steam' : 'Temps compté par Pimplay'}>
                  <Timer /> {formatPlaytime(game.playtime)} de jeu
                </span>
              )}
              <span><Clock /> {timeAgo(game.lastPlayed)}</span>
              {status}
            </div>
            {modTools && game.info?.description && <p className="game-desc">{game.info.description}</p>}
            {modTools && game.info?.sourceUrl && (
              <a className="source-link" href={game.info.sourceUrl} target="_blank" rel="noreferrer">Source : {game.info.sourceName} (CC BY-SA)</a>
            )}
            <div className="game-actions" ref={actionsRef}>
              {!game.running && (launchStage ? (
                <button className="btn primary big" disabled style={{ opacity: 0.9, cursor: 'progress' }} title="Le jeu sera détecté automatiquement dès qu'il démarre">
                  <Loader2 className="spin" />
                  {launchStage === 'launcher' ? `Démarrage de ${LAUNCHER_NAME[launching.kind] || 'du launcher'}…` : 'Lancement du jeu…'}
                </button>
              ) : (
                <button className="btn primary big" onClick={play}><Play fill="currentColor" /> Jouer</button>
              ))}
              {modTools && game.running && !active && !game.antiCheat && (
                <button className="btn primary big" onClick={activate}><Power /> Activer les mods</button>
              )}
              {modTools && active && (
                <button className="btn big" onClick={deactivate}><Power /> Désactiver les mods</button>
              )}
              {!modTools && game.running && (
                <button className="btn big" disabled style={{ opacity: 0.85 }}><Gamepad2 /> En cours</button>
              )}
              {game.running && (
                <button className="btn big stop" onClick={() => setStopping(true)} title="Fermer le jeu">
                  <Square /> Arrêter
                </button>
              )}
              <button className="btn icon" style={{ height: 52, width: 52 }} onClick={favorite} title="Favori">
                <Star fill={game.favorite ? 'var(--warn)' : 'none'} color={game.favorite ? 'var(--warn)' : 'currentColor'} />
              </button>
              <button className="btn icon" style={{ height: 52, width: 52 }} onClick={toggleHidden} title={game.hidden ? 'Réafficher ce jeu' : 'Masquer ce jeu'}>
                {game.hidden ? <Eye /> : <EyeOff />}
              </button>
            </div>
          </div>
        </div>

        {modTools && game.antiCheat && (
          <div className="notice danger" style={{ marginTop: 24 }}>
            <ShieldAlert />
            <div>Ce jeu embarque un anti-triche (jeu en ligne). Pimplay ne s'y attache pas : modifier sa mémoire peut entraîner un bannissement de votre compte. Les mods sont réservés aux jeux solo.</div>
          </div>
        )}

        <div className="game-body">
          {!modTools && <AboutPanel game={game} onCustomize={() => setCustomizing(true)} />}
          {modTools && <section className="panel mods-panel">
            <div className="panel-head">
              <h3><Wand2 /> Mods</h3>
              <span className="pill accent">{trainer?.cheats.length || 0}</span>
              <div className="grow" />
              {trainer?.cheats.length > 0 && (
                <button className={`btn sm ${editMode ? 'primary' : ''}`} onClick={() => setEditMode(!editMode)}>
                  <Pencil /> {editMode ? 'Terminé' : 'Modifier'}
                </button>
              )}
              <button className="btn sm" onClick={() => setEditing(newCheat())}><Plus /> Ajouter</button>
            </div>

            {trainer && trainer.cheats.length === 0 && (
              <div className="panel-body">
                <div className="empty">
                  <Wand2 />
                  <h3>Aucun mod pour ce jeu</h3>
                  <p>Trouvez une valeur avec le scanner mémoire pendant que le jeu tourne, ou importez un trainer partagé (.json).</p>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button className="btn primary" onClick={() => navigate('scanner', { gameId: id })}><ScanSearch /> Scanner</button>
                    <button className="btn" onClick={importT}><Download /> Importer</button>
                  </div>
                </div>
              </div>
            )}

            {groups.map(([cat, cheats]) => (
              <div key={cat}>
                <div className="cat-title">{cat}</div>
                {cheats.map((c) => (
                  <CheatRow
                    key={c.id}
                    cheat={c}
                    state={st(c.id)}
                    attached={attached}
                    flash={flash === c.id}
                    editMode={editMode}
                    onToggle={(on) => toggle(c.id, on)}
                    onValue={(v) => setValue(c.id, v)}
                    onTrigger={() => trigger(c.id)}
                    onHotkey={(hk) => setHotkey(c.id, hk)}
                    onEdit={() => setEditing(c)}
                    onDelete={() => remove(c.id)}
                  />
                ))}
              </div>
            ))}
          </section>}

          <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section className="panel side-panel">
              <div className="panel-head"><h3>Informations</h3></div>
              <div className="panel-body">
                <div className="kv"><span className="k">Plateforme</span><span className="v">{SOURCES[game.source]}</span></div>
                {modTools && <div className="kv">
                  <span className="k">Temps de jeu</span>
                  <span className="v">
                    {formatPlaytime(game.playtime) || '—'}
                    {game.playtimeSource && <span style={{ color: 'var(--dim)', fontWeight: 500 }}> · {game.playtimeSource === 'steam' ? 'Steam' : 'Pimplay'}</span>}
                  </span>
                </div>}
                {modTools && game.info?.developers?.length > 0 && <div className="kv"><span className="k">Développeur</span><span className="v">{game.info.developers.join(', ')}</span></div>}
                {modTools && game.info?.releaseDate && <div className="kv"><span className="k">{game.source === 'epic' && !game.meta?.steamAppId ? 'Sur Epic depuis' : 'Sortie'}</span><span className="v">{game.info.releaseDate}</span></div>}
                {modTools && game.info?.genres?.length > 0 && <div className="kv"><span className="k">Genres</span><span className="v" title={game.info.genres.join(', ')}>{game.info.genres.join(', ')}</span></div>}
                {modTools && <div className="kv"><span className="k">Processus</span><span className="v">{attached ? `${session.exe} (${session.pid})` : '—'}</span></div>}
                {modTools && <div className="field">
                  <label>Exécutable cible (optionnel)</label>
                  <input
                    className="input mono"
                    placeholder="Détection automatique"
                    defaultValue={trainer?.process || ''}
                    key={trainer ? 'loaded' : 'loading'}
                    onBlur={(e) => e.target.value !== (trainer?.process || '') && save({ ...trainer, process: e.target.value.trim() })}
                  />
                </div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn sm" onClick={() => setCustomizing(true)}><Settings2 /> Personnaliser</button>
                  <button className="btn sm" onClick={() => window.pimplay.game.openFolder(id)}><FolderOpen /> Dossier</button>
                  {modTools && <button className="btn sm" onClick={importT}><Download /> Importer</button>}
                  {modTools && <button className="btn sm" onClick={exportT} disabled={!trainer?.cheats.length}><Upload /> Exporter</button>}
                  {game.source === 'custom' && <button className="btn sm danger" onClick={removeCustom}><Trash2 /> Retirer</button>}
                </div>
              </div>
            </section>
            <GameHistory gameId={id} />
            {modTools && <section className="panel side-panel">
              <div className="panel-head"><h3><ScanSearch /> Créer un mod</h3></div>
              <div className="panel-body">
                <ol className="how">
                  <li>Lancez le jeu et notez une valeur (ex. 100 PV).</li>
                  <li>Dans le scanner, choisissez le processus du jeu et cherchez cette valeur.</li>
                  <li>Faites-la varier en jeu puis affinez (« diminuée », « valeur exacte »…).</li>
                  <li>Quand il reste quelques adresses, cliquez « Créer un mod ».</li>
                </ol>
                <button className="btn" onClick={() => navigate('scanner', { gameId: id })}><ScanSearch /> Ouvrir le scanner</button>
              </div>
            </section>}
          </aside>
        </div>
      </div>

      {customizing && <MetaModal game={game} onClose={() => setCustomizing(false)} />}
      {stopping && <StopModal game={game} onClose={() => setStopping(false)} />}
      {editing && (
        <CheatEditor
          cheat={editing}
          categories={groups.map(([k]) => k)}
          onSave={upsert}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// Mode launcher : la colonne principale présente le jeu au lieu des mods
// Historique du jeu : 30 derniers jours en mini-colonnes + dernières sessions
function GameHistory({ gameId }) {
  const data = useSessions();
  const { navigate } = useApp();
  const mine = useMemo(() => (data ? data.sessions.filter((s) => s.g === gameId) : []), [data, gameId]);
  const month = useMemo(() => computeStats(mine, '30'), [mine]);
  if (!data) return null;
  const max = Math.max(...month.buckets.map((b) => b.ms), 1);
  return (
    <section className="panel side-panel">
      <div className="panel-head">
        <h3><History /> Historique</h3>
        <div className="grow" />
        <button className="btn sm ghost" onClick={() => navigate('stats')}>Tout voir</button>
      </div>
      <div className="panel-body">
        {mine.length === 0 ? (
          <span className="muted-line">Aucune partie enregistrée pour l'instant. Pimplay note chaque session tant qu'il est ouvert ou réduit.</span>
        ) : (
          <>
            <div className="kv"><span className="k">30 derniers jours</span><span className="v">{formatDuration(month.totalMs, { compact: true })} · {month.sessionCount} session{month.sessionCount > 1 ? 's' : ''}</span></div>
            <div className="mini-chart" aria-label="Temps de jeu par jour sur 30 jours">
              {month.buckets.map((b) => (
                <span key={b.key} title={`${formatBucket(b, false)} : ${b.ms ? formatDuration(b.ms) : 'aucune partie'}`}>
                  {b.ms > 0 && <i style={{ height: `${Math.max(8, (b.ms / max) * 100)}%` }} />}
                </span>
              ))}
            </div>
            <div className="mini-sessions">
              {[...mine].sort((a, b) => b.s - a.s).slice(0, 5).map((s) => (
                <div key={s.s} className="kv">
                  <span className="k">{formatSessionDate(s.s)}</span>
                  <span className="v">{s.live ? 'en cours · ' : ''}{formatDuration(s.e - s.s, { compact: true })}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// Arrêt du jeu : d'abord une fermeture propre (comme la croix de la fenêtre), puis arrêt forcé si besoin
const STOP_TIMEOUT = 10000;
function StopModal({ game, onClose }) {
  const { guard, toast } = useApp();
  const [stage, setStage] = useState('confirm'); // confirm | closing | stuck

  // Le jeu s'est fermé : on referme la fenêtre de dialogue
  useEffect(() => {
    if (!game.running) {
      if (stage !== 'confirm') toast(`${game.name} a été fermé`);
      onClose();
    }
  }, [game.running]);

  useEffect(() => {
    if (stage !== 'closing') return;
    const t = setTimeout(() => setStage('stuck'), STOP_TIMEOUT);
    return () => clearTimeout(t);
  }, [stage]);

  const close = guard(async () => {
    const r = await window.pimplay.game.stop(game.id, false);
    setStage(r.windows ? 'closing' : 'stuck');
  });
  const kill = guard(async () => {
    const r = await window.pimplay.game.stop(game.id, true);
    if (r.running && !r.killed) {
      toast("Impossible d'arrêter le jeu (il tourne peut-être en administrateur).", 'error');
    }
  });

  const footer = {
    confirm: (
      <>
        <button className="btn ghost" onClick={onClose}>Annuler</button>
        <button className="btn primary" onClick={close}><Square /> Quitter le jeu</button>
      </>
    ),
    closing: (
      <>
        <button className="btn ghost" onClick={onClose}>Fermer</button>
        <button className="btn" onClick={kill}>Forcer maintenant</button>
      </>
    ),
    stuck: (
      <>
        <button className="btn ghost" onClick={onClose}>Annuler</button>
        <button className="btn stop" onClick={kill}><Power /> Forcer l'arrêt</button>
      </>
    ),
  }[stage];

  return (
    <Modal title={`Arrêter ${game.name}`} onClose={onClose} footer={footer}>
      {stage === 'confirm' && (
        <p style={{ margin: 0, lineHeight: 1.55, color: 'var(--muted)' }}>
          Pimplay va demander au jeu de se fermer, comme un clic sur la croix de sa fenêtre :
          il pourra sauvegarder ou vous demander confirmation à l'écran.
        </p>
      )}
      {stage === 'closing' && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', color: 'var(--muted)' }}>
          <Loader2 className="spin" size={18} /> Fermeture en cours… Si le jeu affiche une confirmation, validez-la en jeu.
        </div>
      )}
      {stage === 'stuck' && (
        <div className="notice danger">
          <ShieldAlert />
          <div>
            Le jeu ne s'est pas fermé (il attend peut-être une confirmation, ou ne répond plus).
            L'arrêt forcé le coupe immédiatement : <strong>la progression non sauvegardée sera perdue</strong>.
          </div>
        </div>
      )}
    </Modal>
  );
}

function AboutPanel({ game, onCustomize }) {
  const info = game.info || {};
  return (
    <section className="panel">
      <div className="panel-head"><h3><Gamepad2 /> À propos</h3></div>
      <div className="panel-body about">
        {info.description ? <p>{info.description}</p> : (
          <p style={{ color: 'var(--muted)' }}>
            Pas de description pour ce jeu.
            {game.source !== 'steam' && ' Associez-le à sa fiche Steam avec « Personnaliser » pour récupérer ses infos.'}
          </p>
        )}
        {info.sourceUrl && (
          <a className="source-link" href={info.sourceUrl} target="_blank" rel="noreferrer">
            Source : {info.sourceName} (CC BY-SA)
          </a>
        )}
        {info.genres?.length > 0 && <div className="genre-tags">{info.genres.map((g) => <span key={g} className="genre-tag">{g}</span>)}</div>}
        <div className="about-grid">
          {info.developers?.length > 0 && <div><span>Développeur</span>{info.developers.join(', ')}</div>}
          {info.publishers?.length > 0 && <div><span>Éditeur</span>{info.publishers.join(', ')}</div>}
          {info.releaseDate && <div><span>Sortie</span>{info.releaseDate}</div>}
          <div><span>Temps de jeu</span>{formatPlaytime(game.playtime) || '—'}</div>
          <div><span>Dernière partie</span>{timeAgo(game.lastPlayed)}</div>
          {formatSize(game.sizeOnDisk) && <div><span>Taille</span>{formatSize(game.sizeOnDisk)}</div>}
        </div>
        {!info.description && game.source !== 'steam' && (
          <div><button className="btn sm" onClick={onCustomize}><Settings2 /> Personnaliser</button></div>
        )}
      </div>
    </section>
  );
}

function CheatRow({ cheat: c, state, attached, flash, editMode, onToggle, onValue, onTrigger, onHotkey, onEdit, onDelete }) {
  const Icon = KIND_ICON[c.kind] || Wand2;
  const on = !!state?.enabled;
  const [val, setVal] = useState(state?.value ?? c.value ?? 0);
  useEffect(() => { if (state?.value !== undefined) setVal(state.value); }, [state?.value]);

  return (
    <div className={`mod ${on ? 'on' : ''} ${flash ? 'flash' : ''}`}>
      <div className="mod-icon"><Icon /></div>
      <div className="mod-info">
        <div className="mod-name">{c.name}</div>
        <div className="mod-sub">
          <span>{KIND_LABEL[c.kind]}{c.valueType ? ` · ${TYPE_LABEL[c.valueType]}` : ''}{c.kind === 'freeze' ? ` · ${fmt(c.value)}` : ''}{c.kind === 'button' ? ` · ${c.op === 'add' ? '+' : '='}${fmt(c.value)}` : ''}</span>
          {attached && state?.current !== undefined && state?.current !== null && <span className="cur">actuel : {fmt(state.current)}</span>}
          {attached && on && state?.base !== undefined && state?.base !== null && <span className="cur">origine : {fmt(state.base)}</span>}
          {state?.error && <span className="err">{state.error}</span>}
        </div>
      </div>
      <div className="mod-control">
        {editMode ? (
          <div className="mod-edit">
            <button className="btn sm icon" onClick={onEdit} title="Modifier"><Pencil /></button>
            <button className="btn sm icon danger" onClick={onDelete} title="Supprimer"><Trash2 /></button>
          </div>
        ) : (
          <>
            {(c.kind === 'slider' || c.kind === 'multiplier') && (
              <div className="slider">
                <input
                  type="range" min={c.min} max={c.max} step={c.step} value={val}
                  onChange={(e) => setVal(Number(e.target.value))}
                  onMouseUp={() => onValue(val)}
                  onKeyUp={() => onValue(val)}
                />
                <input
                  className="input num" type="number" value={val}
                  onChange={(e) => setVal(e.target.value)}
                  onBlur={() => onValue(val)}
                  onKeyDown={(e) => e.key === 'Enter' && onValue(val)}
                />
              </div>
            )}
            {c.kind === 'button' && <button className="btn sm" onClick={onTrigger} disabled={!attached}>Appliquer</button>}
            {(c.kind === 'freeze' || c.kind === 'patch' || c.kind === 'multiplier' || (c.kind === 'slider' && c.freeze)) && <Toggle on={on} onChange={onToggle} />}
          </>
        )}
        <HotkeyInput value={c.hotkey} onChange={onHotkey} />
      </div>
    </div>
  );
}
