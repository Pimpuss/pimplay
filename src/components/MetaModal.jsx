import { useEffect, useState } from 'react';
import { Check, ImagePlus, Link2Off, Search, Trash2 } from 'lucide-react';
import { useApp } from '../lib/context.jsx';
import { Cover, DEFAULT_HERO_POSITION, Modal } from './ui.jsx';

const SOURCES = { steam: 'Steam', nintendo: 'Nintendo eShop', gog: 'GOG', wikipedia: 'Wikipédia' };
const HINTS = {
  steam: 'Le plus complet : jaquette, bannière, logo et description en français.',
  nintendo: 'Jeux Switch, 3DS, Wii U… (eShop européen, en français). Pratique pour un émulateur.',
  gog: 'Jeux PC du catalogue GOG, dont beaucoup de classiques.',
  wikipedia: 'Toutes plateformes : PlayStation, Xbox, rétro… Recherchez le titre anglais.',
};

// Personnalisation d'un jeu : jaquette et bannière perso, nom affiché, fiche du jeu sur Steam, Nintendo, GOG ou Wikipédia (jeux hors Steam)
export default function MetaModal({ game, onClose }) {
  const { setLibrary, guard, toast } = useApp();
  const isSteam = game.source === 'steam';
  const [term, setTerm] = useState(game.meta?.linkName || game.name);
  // Plateforme où chercher la fiche : celle déjà associée, sinon Steam
  const [source, setSource] = useState(game.meta?.source && !game.meta?.auto ? game.meta.source : 'steam');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(null);
  const [name, setName] = useState(game.meta?.customName || '');
  const isCustom = game.source === 'custom';
  const [args, setArgs] = useState(game.launchArgs || '');

  const search = guard(async (src = source) => {
    setBusy('search');
    setResults(null);
    try { setResults(await window.pimplay.meta.search(term, src)); } finally { setBusy(null); }
  });
  useEffect(() => { if (!isSteam && (!game.meta?.linkId || game.meta?.auto)) search(); }, []);
  const pickSource = (s) => { if (s === source) return; setSource(s); search(s); };
  const linked = (r) => game.meta?.source === source && game.meta?.linkId === r.id;

  const apply = (lib) => lib && setLibrary(lib);
  const link = guard(async (r) => {
    setBusy(r.id);
    try {
      apply(await window.pimplay.meta.link(game.id, r.id, source));
      toast(`Infos de « ${r.name} » appliquées`);
    } finally { setBusy(null); }
  });
  const unlink = guard(async () => apply(await window.pimplay.meta.unlink(game.id)));
  const rename = guard(async () => { apply(await window.pimplay.meta.rename(game.id, name)); toast(name.trim() ? 'Nom mis à jour' : 'Nom d’origine rétabli'); });
  const saveArgs = guard(async () => { apply(await window.pimplay.library.setArgs(game.id, args)); toast(args.trim() ? 'Arguments de lancement enregistrés' : 'Arguments de lancement retirés'); });
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
            className="input" value={name} placeholder={game.meta?.linkName || game.name}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename()}
          />
          <button className="btn" onClick={rename}><Check /> Appliquer</button>
        </div>
        <span className="hint">Laissez vide pour utiliser le nom d'origine.</span>
      </div>

      {isCustom && (
        <div className="field">
          <label>Arguments de lancement</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input" value={args} placeholder={'ex. -f -g "D:/Jeux/MonJeu"'} spellCheck={false}
              onChange={(e) => setArgs(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveArgs()}
            />
            <button className="btn" onClick={saveArgs}><Check /> Appliquer</button>
          </div>
          <span className="hint">Ajoutés après {game.exe ? `« ${game.exe.split(/[\\/]/).pop()} »` : 'l’exécutable'}, comme dans un raccourci Windows. Utile pour un émulateur : indiquez le jeu à ouvrir.</span>
        </div>
      )}

      {!isSteam && (
        <>
          <div className="field">
            <label>Fiche du jeu</label>
            {game.meta?.source && (
              <div className="setting" style={{ padding: '10px 12px' }}>
                <div className="txt">
                  <strong>{game.meta.linkName || SOURCES[game.meta.source]}</strong>
                  <span>
                    {game.meta.source === 'steam'
                      ? `Jaquette, bannière, logo et description récupérés depuis Steam (app ${game.meta.steamAppId}).`
                      : `Images et description récupérées depuis ${SOURCES[game.meta.source]}${game.meta.auto ? ' (trouvé automatiquement)' : ''}.`}
                  </span>
                </div>
                <button className="btn sm ghost" onClick={unlink}><Link2Off /> Délier</button>
              </div>
            )}
            <div className="seg">
              {Object.entries(SOURCES).map(([k, label]) => (
                <button key={k} className={source === k ? 'active' : ''} onClick={() => pickSource(k)} disabled={busy === 'search'}>{label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder={`Nom du jeu sur ${SOURCES[source]}`} />
              <button className="btn" onClick={() => search()} disabled={busy === 'search'}><Search /> Chercher</button>
            </div>
            <span className="hint">{HINTS[source]}</span>
          </div>

          {busy === 'search' && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Recherche sur {SOURCES[source]}…</div>}
          {results && (
            results.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Aucun jeu trouvé sur {SOURCES[source]}. Essayez un autre nom (souvent le titre anglais) ou une autre plateforme.</div>
            ) : (
              <div className="meta-results">
                {results.map((r) => (
                  <button key={r.id} className={`meta-result ${linked(r) ? 'active' : ''}`} onClick={() => link(r)} disabled={!!busy}>
                    {r.image ? <img src={r.image} alt="" className={source === 'steam' ? '' : 'fit'} /> : <span className="meta-result-noimg" />}
                    <div className="meta-result-txt">
                      <b>{busy === r.id ? 'Récupération…' : r.name}</b>
                      {r.detail && <small>{r.detail}</small>}
                    </div>
                    {linked(r) && <Check size={16} />}
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
