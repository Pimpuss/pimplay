import { Download, Eye, EyeOff, Star, Wand2 } from 'lucide-react';
import { useApp, SOURCES, formatPlaytime } from '../lib/context.jsx';
import { Cover } from './ui.jsx';

const INSTALL_TOAST = {
  steam: (name) => `Steam ouvre l'installation de ${name}`,
  epic: (name) => `Le launcher Epic ouvre l'installation de ${name}`,
  gog: (name) => `GOG Galaxy ouvre la fiche de ${name} : cliquez sur Installer`,
  ea: (name) => `L'EA app ouvre l'installation de ${name}`,
  battlenet: (name) => `Battle.net ouvre la page de ${name} : cliquez sur Installer`,
  ubisoft: (name) => `Ubisoft Connect s'ouvre : retrouvez ${name} dans vos jeux pour l'installer`,
};

export default function GameCard({ game }) {
  const { navigate, setLibrary, guard, toast, modTools } = useApp();
  const notInstalled = game.installed === false;
  // Jeu possédé mais pas installé : le launcher du jeu ouvre son installation
  const open = notInstalled
    ? guard(async () => {
      await window.pimplay.library.install(game.id);
      toast(INSTALL_TOAST[game.source]?.(game.name) || `Installation de ${game.name}`);
    })
    : () => navigate('game', { id: game.id });

  const toggleHidden = guard(async (e) => {
    e.stopPropagation();
    setLibrary(await window.pimplay.library.hide(game.id, !game.hidden));
    toast(game.hidden ? `${game.name} est de nouveau visible` : 'Jeu masqué — retrouvez-le dans Mes jeux › Masqués');
  });

  return (
    <div
      className={`card ${notInstalled ? 'not-installed' : ''}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === 'Enter' && open()}
      title={notInstalled ? `Installer ${game.name} avec ${SOURCES[game.source]}` : undefined}
    >
      <div className="cover">
        <Cover game={game} />
        {notInstalled && <span className="card-install"><Download /> Installer</span>}
        <div className="badges">
          <span>{modTools && game.cheatCount > 0 && <span className="badge mods"><Wand2 /> {game.cheatCount}</span>}</span>
          <span style={{ display: 'flex', gap: 4 }}>
            {game.favorite && <span className="badge fav"><Star fill="currentColor" /></span>}
            {game.running && <span className="badge live">● En jeu</span>}
          </span>
        </div>
        {!notInstalled && (
          <button className="card-hide" onClick={toggleHidden} title={game.hidden ? 'Réafficher ce jeu' : 'Masquer ce jeu'}>
            {game.hidden ? <Eye /> : <EyeOff />}
          </button>
        )}
      </div>
      <div className="name">{game.name}</div>
      <div className="meta">
        {SOURCES[game.source]}        {formatPlaytime(game.playtime) && <> · {formatPlaytime(game.playtime)}</>}
      </div>
    </div>
  );
}
