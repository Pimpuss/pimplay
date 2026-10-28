import { useEffect, useState } from 'react';
import { Bug, Code2, ShieldAlert, Square } from 'lucide-react';
import { Modal } from './ui.jsx';

const STATE = {
  starting: ['warn', 'Connexion du débogueur…'],
  running: ['ok', 'Surveillance active'],
  stopped: ['', 'Surveillance arrêtée'],
  error: ['danger', 'Erreur'],
  idle: ['', 'En attente'],
};

export default function WatchModal({ addresses, onClose, onPatch, guard }) {
  const [snap, setSnap] = useState({ state: 'starting', hits: [], targets: [] });
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    const off = window.pimplay.on('watch:update', setSnap);
    guard(async () => setSnap(await window.pimplay.watch.start(addresses)))();
    return () => { off(); window.pimplay.watch.stop(); };
  }, []);

  const stop = guard(async () => { const s = await window.pimplay.watch.stop(); if (s) setSnap(s); });
  const close = () => { window.pimplay.watch.stop(); onClose(); };
  const patch = guard(async (id) => {
    setBusy(id);
    try {
      onPatch(await window.pimplay.watch.patch(id));
    } finally {
      setBusy(null);
    }
  });

  const [tone, label] = STATE[snap.state] || STATE.idle;
  const live = snap.state === 'running' || snap.state === 'starting';

  return (
    <Modal
      title="Qui écrit à ces adresses ?"
      onClose={close}
      wide
      footer={
        <>
          {live && <button className="btn" onClick={stop}><Square /> Arrêter</button>}
          <button className="btn primary" onClick={close}>Fermer</button>
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className={`pill ${tone}`}><span className="dot" /> {label}</span>
        {snap.targets.map((t, i) => <span key={t} className="kbd">#{i + 1} {t}</span>)}
      </div>
      {snap.error && <div className="notice danger"><ShieldAlert /><div>{snap.error}</div></div>}

      <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.5, fontSize: 13 }}>
        Retournez en jeu et faites changer la valeur (utilisez un objet, prenez un coup…). Chaque instruction du jeu qui
        l'écrit s'affiche ici, avec le nombre de fois où elle a été exécutée.
      </p>

      {snap.hits.length === 0 ? (
        <div className="empty" style={{ padding: 28 }}>
          <Bug />
          <h3>{live ? 'En attente d\'une écriture…' : 'Aucune instruction trouvée'}</h3>
        </div>
      ) : (
        <div className="results-wrap" style={{ maxHeight: 320, border: '1px solid var(--border)', borderRadius: 10 }}>
          <table className="results">
            <thead>
              <tr><th style={{ width: 60 }}>Fois</th><th>Instruction</th><th>Écrit sur</th><th style={{ width: 150 }} /></tr>
            </thead>
            <tbody>
              {snap.hits.map((h) => (
                <tr key={h.id}>
                  <td className="mono">{h.count}</td>
                  <td>
                    <div className="mono" style={{ color: 'var(--text)' }}>{h.text}</div>
                    <div className="modref">{h.module ? `${h.module.name}+${h.module.offset}` : h.address}</div>
                    {h.next.length > 0 && <div className="mono" style={{ color: 'var(--dim)', fontSize: 11.5, marginTop: 2 }}>puis : {h.next.slice(0, 2).join(' ; ')}</div>}
                  </td>
                  <td className="mono">{h.targets.map((t) => `#${t + 1}`).join(' ')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn sm" disabled={!h.length || busy} onClick={() => patch(h.id)}>
                      <Code2 /> {busy === h.id ? 'Analyse…' : 'Créer un patch'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="notice">
        <ShieldAlert />
        <div>
          Le patch remplace l'instruction par des NOP : ce code ne modifiera plus la valeur, ni à la baisse ni à la hausse.
          Si l'instruction sert à plusieurs choses (tous les objets, par exemple), le patch les touche toutes. Testez-le,
          il est réversible en le désactivant. Sauvegardez votre partie avant, et ne fermez pas Pimplay pendant la surveillance.
        </div>
      </div>
    </Modal>
  );
}
