import { useEffect, useState } from 'react';
import { ArrowDownToLine, Power } from 'lucide-react';
import { Modal } from './ui.jsx';

// Affichée quand on clique sur la croix de la fenêtre (réglage « Demander »)
export default function CloseModal() {
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);

  useEffect(() => window.pimplay.on('close-request', () => { setRemember(false); setOpen(true); }), []);

  if (!open) return null;
  const choose = (choice) => {
    setOpen(false);
    window.pimplay.app.closeChoice(choice, remember);
  };

  return (
    <Modal
      title="Fermer Pimplay ?"
      onClose={() => setOpen(false)}
      footer={
        <>
          <label className="check" style={{ marginRight: 'auto' }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Se souvenir de mon choix
          </label>
          <button className="btn ghost" onClick={() => setOpen(false)}>Annuler</button>
          <button className="btn stop" onClick={() => choose('quit')}><Power /> Quitter</button>
          <button className="btn primary" autoFocus onClick={() => choose('tray')}><ArrowDownToLine /> Réduire</button>
        </>
      }
    >
      <p style={{ margin: 0, lineHeight: 1.6, color: 'var(--muted)' }}>
        <strong style={{ color: 'var(--text)' }}>Réduire</strong> garde Pimplay dans la zone de notification (près de l'horloge) :
        il continue de suivre vos jeux et de compter le temps de jeu. Cliquez sur son icône pour le rouvrir.
      </p>
      <p style={{ margin: 0, lineHeight: 1.6, color: 'var(--muted)' }}>
        <strong style={{ color: 'var(--text)' }}>Quitter</strong> ferme complètement Pimplay : le temps des jeux hors Steam ne sera plus compté.
      </p>
      <span className="hint" style={{ fontSize: 12, color: 'var(--dim)' }}>Ce choix se modifie à tout moment dans Paramètres › Application.</span>
    </Modal>
  );
}
