import { useEffect, useState } from 'react';
import { Download, RotateCw } from 'lucide-react';

// État des mises à jour de Pimplay (versions publiées sur GitHub), suivi en direct
export function useUpdate() {
  const [state, setState] = useState(null);
  useEffect(() => {
    window.pimplay.update.state().then(setState).catch(() => {});
    return window.pimplay.on('update', setState);
  }, []);
  return state;
}

// Encart de la barre latérale : téléchargement en cours, puis « Redémarrer » quand la version est prête
export default function UpdateCard() {
  const update = useUpdate();
  if (update?.status === 'downloading') {
    return (
      <div className="update-card">
        <span className="update-title"><Download /> Mise à jour {update.version}</span>
        <span className="update-bar"><span style={{ width: `${update.progress || 0}%` }} /></span>
        <span className="muted">Téléchargement… {update.progress || 0} %</span>
      </div>
    );
  }
  if (update?.status !== 'ready') return null;
  return (
    <div className="update-card ready">
      <span className="update-title"><Download /> Pimplay {update.version} est prête</span>
      <span className="muted">Redémarrez pour l'installer, ou elle s'installera à la fermeture de Pimplay.</span>
      <button className="btn primary" onClick={() => window.pimplay.update.install()}><RotateCw /> Redémarrer</button>
    </div>
  );
}
