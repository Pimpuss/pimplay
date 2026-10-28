import { useEffect, useState } from 'react';
import { Check, ExternalLink, Gift } from 'lucide-react';

const FREE_PAGE = 'https://store.epicgames.com/fr/free-games';

const day = (t) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
const hour = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: 'numeric', minute: '2-digit' }).replace(':00', ' h').replace(':', ' h ');

function when(g) {
  if (!g.now) return `À partir du ${day(g.start)}`;
  const left = g.end - Date.now();
  if (left < 864e5) return `Plus que ${Math.max(1, Math.round(left / 36e5))} h`;
  return `Jusqu'au ${day(g.end)}, ${hour(g.end)}`;
}

// Encart de l'Accueil : jeux offerts cette semaine sur l'Epic Games Store, et les prochains
export default function EpicFreeGames() {
  const [items, setItems] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => window.pimplay.epic.freeGames().then((r) => alive && setItems(r)).catch(() => alive && setItems([]));
    load();
    // L'Accueil peut rester ouvert longtemps : on revérifie toutes les heures
    const t = setInterval(load, 3600e3);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!items?.length) return null;
  const open = (url) => window.pimplay.epic.openStore(url);

  return (
    <>
      <h2 className="section section-row">
        <span><Gift /> Gratuit sur Epic Games</span>
        <button className="link-btn" onClick={() => open(FREE_PAGE)}>Voir sur la boutique <ExternalLink /></button>
      </h2>
      <div className="epic-free">
        {items.map((g) => (
          <button
            key={g.id}
            className={`epic-card ${g.now ? 'now' : 'soon'}`}
            disabled={!g.url}
            onClick={() => g.url && open(g.url)}
            title={g.url ? `Ouvrir ${g.title} sur l'Epic Games Store` : undefined}
          >
            <div className="epic-img">
              {g.image ? <img src={g.image} alt="" loading="lazy" /> : <Gift />}
              {g.owned ? (
                <span className="epic-badge owned"><Check /> Récupéré</span>
              ) : (
                <span className="epic-badge">{g.now ? 'Gratuit' : 'Bientôt'}</span>
              )}
            </div>
            <div className="epic-body">
              <strong>{g.title}</strong>
              <span>
                {when(g)}
                {g.price && <s>{g.price}</s>}
              </span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
