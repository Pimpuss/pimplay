import { useEffect, useState } from 'react';
import { Check, ImagePlus, Link2Off, Search, Trash2 } from 'lucide-react';
import { useApp } from '../lib/context.jsx';
import { Cover, DEFAULT_HERO_POSITION, Modal } from './ui.jsx';

// Personnalisation d'un jeu : jaquette et bannière perso, nom affiché, fiche Steam (jeux hors Steam)
export default function MetaModal({ game, onClose }) {
  const { setLibrary, guard, toast } = useApp();
  const isSteam = game.source === 'steam';
  const [term, setTerm] = useState(game.meta?.steamName || game.name);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(null);
  const [name, setName] = useState(game.meta?.customName || '');

  const search = guard(async () => {
    setBusy('search');
    try { setResults(await window.pimplay.meta.search(term)); } finally { setBusy(null); }
  });
  useEffect(() => { if (!isSteam && !game.meta?.steamAppId) search(); }, []);

  const apply = (lib) => lib && setLibrary(lib);
  const link = guard(async (r) => {
    setBusy(r.id);
    try {
      apply(await window.pimplay.meta.link(game.id, r.id));
      toast(`Infos de « ${r.name} » appliquées`);
    } finally { setBusy(null); }
  });
  const unlink = guard(async () => apply(await window.pimplay.meta.unlink(game.id)));
  const rename = guard(async () => { apply(await window.pimplay.meta.rename(game.id, name)); toast(name.trim() ? 'Nom mis à jour' : 'Nom d’origine rétabli'); });
  const setImage = (kind) => guard(async () => apply(await window.pimplay.meta.setImage(game.id, kind)));
  const [pos, setPos] = useState(game.meta?.heroPosition ?? DEFAULT_HERO_POSITION);
  const savePos = guard(async (v) => apply(await window.pimplay.meta.setHeroPosition(game.id, v)));
  const clearImage = (kind) => guard(async () => apply(await window.pimplay.meta.clearImage(game.id, kind)));

  return (
    <Modal title="Personnaliser le jeu" onClose={onClose} wide footer={<button className="btn primary" onClick={onClose}>Terminé</button>}>
      <div className="meta-images">
        <div className="meta-image">
          <div className="meta-cover"><Cover game={game} /></div>
          <div className="meta-image-actions">
            <button className="btn sm" onClick={setImage('cover')}><ImagePlus /> Jaquette…</button>
            {game.meta?.customCover && <button className="btn sm ghost danger icon" onClick={clearImage('cover')} title="Revenir à la jaquette d'origine"><Trash2 /></button>}
          </div>
        </div>
        <div className="meta-image grow">
          {/* Même format et même fondu que la page du jeu ; la zone sombre en bas à gauche = jaquette + titre */}
          <div className="meta-hero">
            <Cover game={game} kind="hero" style={{ objectPosition: `center ${pos}%` }} />
            <span className="meta-hero-overlay" title="Zone recouverte par la jaquette et le titre" />
          </div>
          <div className="meta-crop">
            <span>Cadrage</span>
            <input
              type="range" min="0" max="100" value={pos}
              onChange={(e) => setPos(Number(e.target.value))}
              onMouseUp={() => savePos(pos)} onKeyUp={() => savePos(pos)}
            />
            <span className="meta-crop-value">{pos === 0 ? 'Haut' : pos === 100 ? 'Bas' : `${pos} %`}</span>
            {game.meta?.heroPosition != null && (
              <button className="btn sm ghost" onClick={() => { setPos(DEFAULT_HERO_POSITION); savePos(null); }}>Par défaut</button>
            )}
          </div>
          <div className="meta-image-actions">
            <button className="btn sm" onClick={setImage('hero')}><ImagePlus /> Bannière…</button>
            {game.meta?.customHero && <button className="btn sm ghost danger icon" onClick={clearImage('hero')} title="Revenir à la bannière d'origine"><Trash2 /></button>}
            <span className="hint">Idéalement une image large sans logo (format 3:1, ex. 3840×1240) : voir la catégorie « Heroes » de SteamGridDB.</span>
          </div>
        </div>
      </div>

      <div className="field">
        <label>Nom affiché</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input" value={name} placeholder={game.meta?.steamName || game.name}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename()}
          />
          <button className="btn" onClick={rename}><Check /> Appliquer</button>
        </div>
        <span className="hint">Laissez vide pour utiliser le nom d'origine.</span>
      </div>

      {!isSteam && (
        <>
          <div className="field">
            <label>Infos Steam</label>
            {game.meta?.steamAppId && (
              <div className="setting" style={{ padding: '10px 12px' }}>
                <div className="txt">
                  <strong>{game.meta.steamName}</strong>
                  <span>Jaquette, bannière, logo et description récupérés depuis Steam (app {game.meta.steamAppId}).</span>
                </div>
                <button className="btn sm ghost" onClick={unlink}><Link2Off /> Délier</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Nom du jeu sur Steam" />
              <button className="btn" onClick={search} disabled={busy === 'search'}><Search /> Chercher</button>
            </div>
          </div>

          {results && (
            results.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Aucun jeu trouvé sur Steam. Essayez un autre nom (souvent le titre anglais).</div>
            ) : (
              <div className="meta-results">
                {results.map((r) => (
                  <button key={r.id} className={`meta-result ${game.meta?.steamAppId === r.id ? 'active' : ''}`} onClick={() => link(r)} disabled={!!busy}>
                    <img src={r.image} alt="" />
                    <span>{busy === r.id ? 'Récupération…' : r.name}</span>
                    {game.meta?.steamAppId === r.id && <Check size={16} />}
                  </button>
                ))}
              </div>
            )
          )}
        </>
      )}
    </Modal>
  );
}
