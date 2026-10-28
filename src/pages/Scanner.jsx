import { useCallback, useEffect, useRef, useState } from 'react';
import { Bug, Check, Cpu, Gamepad2, Pencil, RefreshCw, RotateCcw, ScanSearch, Search, ShieldAlert, Wand2, X } from 'lucide-react';
import { useApp } from '../lib/context.jsx';
import CheatEditor, { newCheat, VALUE_TYPES } from '../components/CheatEditor.jsx';
import WatchModal from '../components/WatchModal.jsx';

const MODES = [
  ['exact', 'Valeur exacte'],
  ['decreased', 'A diminué'],
  ['increased', 'A augmenté'],
  ['changed', 'A changé'],
  ['unchanged', "N'a pas changé"],
];
const SHOWN = 200;

// L'état du scan survit aux changements de page (le scanner côté main le conserve aussi)
const memo = {};
function useMemoState(key, initial) {
  const [v, setV] = useState(key in memo ? memo[key] : initial);
  useEffect(() => { memo[key] = v; }, [key, v]);
  return [v, setV];
}

export default function Scanner() {
  const { route, library, guard, toast, navigate } = useApp();
  const [procs, setProcs] = useState([]);
  const [filter, setFilter] = useState('');
  const [proc, setProc] = useMemoState('proc', null);
  const [type, setType] = useMemoState('type', 'int32');
  const [value, setValue] = useMemoState('value', '');
  const [mode, setMode] = useMemoState('mode', 'exact');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useMemoState('summary', null);
  const [results, setResults] = useMemoState('results', []);
  const [gameId, setGameId] = useMemoState('gameId', route.gameId || '');
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState(null);
  const [allValue, setAllValue] = useState(null);
  const [watching, setWatching] = useState(null);
  const failedPid = useRef(null);

  const loadProcs = guard(async () => setProcs(await window.pimplay.process.list()));

  const attach = guard(async (pid) => {
    const info = await window.pimplay.scanner.attach(pid);
    setProc(info);
    setSummary(null);
    setResults([]);
    if (info.gameId) setGameId(info.gameId);
  });

  // Liste des processus actualisée en continu
  useEffect(() => {
    if (route.gameId) setGameId(route.gameId);
    const load = () => window.pimplay.process.list().then(setProcs).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    const off = window.pimplay.on('scanner:progress', setProgress);
    return () => { clearInterval(t); off(); };
  }, []);

  // Sélectionne tout seul le jeu choisi dès qu'il tourne ; oublie un processus fermé
  useEffect(() => {
    if (busy) return;
    if (proc && procs.length && !procs.some((p) => p.pid === proc.pid)) {
      setProc(null);
      setSummary(null);
      setResults([]);
      return;
    }
    if (!proc && gameId) {
      const wanted = procs.find((p) => p.gameId === gameId);
      if (wanted && failedPid.current !== wanted.pid) {
        failedPid.current = wanted.pid;
        attach(wanted.pid);
      }
    }
  }, [procs, gameId, proc, busy]);

  const refreshResults = useCallback(async () => {
    try { setResults(await window.pimplay.scanner.results(0, SHOWN)); } catch { /* processus fermé */ }
  }, []);

  // Rafraîchit les valeurs affichées tant qu'il reste peu de résultats
  useEffect(() => {
    if (!summary || summary.count === 0 || summary.count > SHOWN || busy) return;
    const t = setInterval(refreshResults, 1000);
    return () => clearInterval(t);
  }, [summary, busy, refreshResults]);

  const run = guard(async (first) => {
    if ((first || mode === 'exact') && value.trim() === '') return toast('Entrez une valeur à rechercher', 'error');
    setBusy(true);
    setProgress(0);
    try {
      const s = first
        ? await window.pimplay.scanner.first({ type, value })
        : await window.pimplay.scanner.next({ mode, value });
      setSummary(s);
      if (s.truncated) toast('Trop de résultats : affinez avec un scan suivant.', 'error');
      await refreshResults();
    } finally {
      setBusy(false);
    }
  });

  const reset = guard(async () => {
    await window.pimplay.scanner.reset();
    setSummary(null);
    setResults([]);
    setMode('exact');
  });

  const writeValue = guard(async (address) => {
    await window.pimplay.scanner.write(address, summary.type, Number(String(editValue.value).replace(',', '.')));
    setEditValue(null);
    refreshResults();
  });

  const writeAll = guard(async () => {
    const n = await window.pimplay.scanner.writeAll(Number(String(allValue).replace(',', '.')));
    setAllValue(null);
    toast(`${n} adresse${n > 1 ? 's' : ''} modifiée${n > 1 ? 's' : ''}`);
    refreshResults();
  });

  const createPatchMod = (p) => {
    setWatching(null);
    if (!gameId) return toast('Choisissez le jeu auquel ajouter ce patch', 'error');
    let target;
    if (p.module && p.unique) target = { module: p.module, aob: p.aob };
    else if (p.module) {
      target = { module: p.module, offset: p.offset };
      toast("Signature non unique : le patch utilise module + offset (à refaire après une mise à jour du jeu).");
    } else {
      target = { address: p.offset };
      toast('Code hors module : le patch ne vaudra que pour cette session.', 'error');
    }
    setEditing(newCheat({ kind: 'patch', name: p.name, category: 'Patchs', patch: p.patch, target }));
  };

  const createMod = (r) => {
    if (!gameId) return toast('Choisissez le jeu auquel ajouter ce mod', 'error');
    setEditing(newCheat({
      valueType: summary.type,
      value: r.value ?? 0,
      target: r.module ? { module: r.module.name, offset: r.module.offset } : { address: r.address },
    }));
  };

  const saveMod = guard(async (cheat) => {
    const t = await window.pimplay.trainer.get(gameId);
    await window.pimplay.trainer.save(gameId, { ...t, cheats: [...t.cheats, cheat] });
    setEditing(null);
    const g = library.find((x) => x.id === gameId);
    toast(`Mod « ${cheat.name} » ajouté à ${g?.name || 'ce jeu'}`);
  });

  const q = filter.toLowerCase();
  const shownProcs = procs.filter((p) => !q || p.name.toLowerCase().includes(q));
  const gameOf = (id) => library.find((g) => g.id === id);
  const firstScan = !summary;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Scanner mémoire</h1>
        {proc && <span className="pill ok"><span className="dot" /> {proc.exe} · PID {proc.pid} · {proc.is32 ? '32' : '64'} bits</span>}
      </div>

      <div className="scanner">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="panel">
            <div className="panel-head">
              <h3><Cpu /> Processus</h3>
              <div className="grow" />
              <button className="btn sm icon" onClick={loadProcs} title="Actualiser"><RefreshCw /></button>
            </div>
            <div className="panel-body">
              {gameId && !procs.some((p) => p.gameId === gameId) && (
                <div className="notice">
                  <Gamepad2 />
                  <div>{gameOf(gameId)?.name || 'Le jeu'} n'est pas lancé. Démarrez-le : il sera sélectionné automatiquement.</div>
                </div>
              )}
              <input className="input" placeholder="Filtrer…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <div className="proc-list">
                {shownProcs.map((p) => (
                  <button key={p.pid} className={`proc ${proc?.pid === p.pid ? 'active' : ''}`} onClick={() => attach(p.pid)} title={p.path}>
                    <span>{p.name}</span>
                    {p.gameId && <span className="tag">{gameOf(p.gameId)?.hidden ? 'JEU' : gameOf(p.gameId)?.name || 'JEU'}</span>}
                    <span className="pid">{p.pid}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h3><ScanSearch /> Recherche</h3></div>
            <div className="panel-body">
              <div className="field">
                <label>Type de valeur</label>
                <select className="select" value={type} disabled={!firstScan} onChange={(e) => setType(e.target.value)}>
                  {VALUE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              {!firstScan && (
                <div className="field">
                  <label>Comparaison</label>
                  <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
                    {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              )}
              {(firstScan || mode === 'exact') && (
                <div className="field">
                  <label>Valeur</label>
                  <input
                    className="input mono" value={value} placeholder="100"
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && proc && !busy && run(firstScan)}
                  />
                </div>
              )}
              {busy && <div className="progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
              <div style={{ display: 'flex', gap: 8 }}>
                {firstScan ? (
                  <button className="btn primary" style={{ flex: 1 }} disabled={!proc || busy} onClick={() => run(true)}><Search /> Premier scan</button>
                ) : (
                  <>
                    <button className="btn primary" style={{ flex: 1 }} disabled={busy} onClick={() => run(false)}><Search /> Scan suivant</button>
                    <button className="btn" disabled={busy} onClick={reset} title="Nouveau scan"><RotateCcw /></button>
                  </>
                )}
                {busy && <button className="btn" onClick={() => window.pimplay.scanner.cancel()}>Stop</button>}
              </div>
              {!proc && <span className="hint" style={{ fontSize: 12, color: 'var(--dim)' }}>Sélectionnez d'abord le processus du jeu ci-dessus.</span>}
            </div>
          </section>

          <div className="notice">
            <ShieldAlert />
            <div>À utiliser uniquement sur des jeux solo. Modifier la mémoire d'un jeu en ligne peut entraîner un bannissement.</div>
          </div>
        </div>

        <section className="panel">
          <div className="panel-head">
            <h3>Résultats</h3>
            {summary && <span className="pill accent">{summary.count.toLocaleString('fr-FR')}</span>}
            {summary && <span style={{ color: 'var(--dim)', fontSize: 12 }}>scan n°{summary.scanCount}</span>}
            {summary && summary.count > 0 && summary.count <= 1000 && (allValue === null ? (
              <button className="btn sm" onClick={() => setAllValue(results[0]?.value ?? '')} title="Écrire la même valeur dans toutes les adresses trouvées">
                <Pencil /> Tout modifier
              </button>
            ) : (
              <span style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input mono" style={{ height: 30, width: 110 }} autoFocus value={allValue}
                  onChange={(e) => setAllValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') writeAll(); if (e.key === 'Escape') setAllValue(null); }}
                />
                <button className="btn sm icon" onClick={writeAll} title="Appliquer à tous"><Check /></button>
                <button className="btn sm icon ghost" onClick={() => setAllValue(null)} title="Annuler"><X /></button>
              </span>
            ))}
            {summary && summary.count > 0 && summary.count <= 4 && (
              <button className="btn sm" onClick={() => setWatching(results.map((r) => r.address))} title="Trouver les instructions du jeu qui écrivent dans ces adresses">
                <Bug /> Qui écrit ici ?
              </button>
            )}
            <div className="grow" />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Ajouter les mods à</span>
            <select className="select" style={{ width: 220, height: 30 }} value={gameId} onChange={(e) => setGameId(e.target.value)}>
              <option value="">Choisir un jeu…</option>
              {library.filter((g) => !g.hidden || g.id === gameId).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          {!summary ? (
            <div className="panel-body">
              <div className="empty">
                <ScanSearch />
                <h3>Trouvez une valeur du jeu</h3>
                <p>Exemple : vous avez 250 pièces d'or. Cherchez « 250 », dépensez-en un peu, puis relancez un scan avec la nouvelle valeur jusqu'à isoler l'adresse.</p>
              </div>
            </div>
          ) : summary.count === 0 ? (
            <div className="panel-body"><div className="empty"><X /><h3>Aucun résultat</h3><p>Vérifiez le type de valeur (souvent « Flottant » pour la vie ou l'endurance) puis recommencez.</p></div></div>
          ) : (
            <div className="results-wrap">
              <table className="results">
                <thead>
                  <tr><th>Adresse</th><th>Valeur</th><th>Précédente</th><th style={{ width: 300 }} /></tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.address}>
                      <td className="mono">
                        {r.address}
                        {r.module && <div className="modref">{r.module.name}+{r.module.offset}</div>}
                      </td>
                      <td className={`mono ${r.value !== r.previous ? 'changed' : ''}`}>
                        {editValue?.address === r.address ? (
                          <span style={{ display: 'flex', gap: 6 }}>
                            <input
                              className="input mono" style={{ height: 28, width: 120 }} autoFocus value={editValue.value}
                              onChange={(e) => setEditValue({ ...editValue, value: e.target.value })}
                              onKeyDown={(e) => { if (e.key === 'Enter') writeValue(r.address); if (e.key === 'Escape') setEditValue(null); }}
                            />
                            <button className="btn sm icon" onClick={() => writeValue(r.address)}><Check /></button>
                          </span>
                        ) : (r.value ?? '?')}
                      </td>
                      <td className="mono" style={{ color: 'var(--dim)' }}>{r.previous}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn sm ghost icon" onClick={() => setWatching([r.address])} title="Qui écrit à cette adresse ?"><Bug /></button>
                        <button className="btn sm ghost" onClick={() => setEditValue({ address: r.address, value: r.value ?? '' })}><Pencil /> Valeur</button>
                        <button className="btn sm" onClick={() => createMod(r)}><Wand2 /> Créer un mod</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {summary.count > SHOWN && (
                <div style={{ padding: 14, color: 'var(--dim)', fontSize: 12.5, textAlign: 'center' }}>
                  {SHOWN} premiers résultats affichés sur {summary.count.toLocaleString('fr-FR')} — affinez la recherche.
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {editing && (
        <CheatEditor cheat={editing} onSave={saveMod} onClose={() => setEditing(null)} />
      )}
      {watching && (
        <WatchModal addresses={watching} guard={guard} onPatch={createPatchMod} onClose={() => setWatching(null)} />
      )}
      {gameId && summary && (
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button className="btn ghost sm" onClick={() => navigate('game', { id: gameId })}>Voir les mods de {gameOf(gameId)?.name} →</button>
        </div>
      )}
    </div>
  );
}
