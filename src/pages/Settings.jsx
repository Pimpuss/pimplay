import { useEffect, useState } from 'react';
import { ArrowDownToLine, Check, CircleHelp, FolderOpen, Globe, Loader2, LogIn, LogOut, Pipette, Power, RefreshCw, RotateCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { ACCENTS, applyAccent, resolveAccent } from '../lib/accent.js';
import { useApp, timeAgo } from '../lib/context.jsx';
import { Select, Toggle } from '../components/ui.jsx';
import { useUpdate } from '../components/UpdateCard.jsx';

// Comptes Steam, Epic et GOG : connexion par la page officielle de la plateforme, pour voir aussi les
// jeux possédés non installés. Sans compte Epic ou GOG, Pimplay lit ce que leurs launchers ont en cache.
const ACCOUNTS = {
  steam: { label: 'Steam', short: 'ST', hint: 'pour voir aussi les jeux que vous possédez sans les avoir installés, et les installer en un clic' },
  epic: { label: 'Epic Games', short: 'EG', hint: 'pour avoir la liste complète de vos jeux Epic, même sans ouvrir le launcher Epic' },
  gog: { label: 'GOG', short: 'GOG', hint: 'pour avoir la liste complète de vos jeux GOG, même sans GOG Galaxy synchronisé' },
};

function Account({ kind }) {
  const { label, short, hint } = ACCOUNTS[kind];
  const api = window.pimplay[kind];
  const { guard, toast } = useApp();
  const [account, setAccount] = useState(undefined);
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    api.account().then(setAccount);
    return window.pimplay.on(kind, setAccount);
  }, [kind]);

  const run = (k, fn) => guard(async () => {
    setBusy(k);
    try { await fn(); } finally { setBusy(null); }
  });
  const login = run('login', async () => {
    const a = await api.login();
    setAccount(a);
    if (a && !a.error) toast(`Connecté à ${label} : ${a.ownedCount} jeux possédés`);
  });
  const spin = (k, Icon) => (busy === k ? <Loader2 className="spin" /> : <Icon />);
  // Repli « par le navigateur » : la page officielle s'ouvre dans le navigateur habituel (où les
  // vérifications anti-robot passent), puis on colle ici l'adresse de la page de retour
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const browserLogin = api.browserLogin && guard(async () => {
    await api.browserLogin();
    setPasting(true);
  });
  const submitCode = run('code', async () => {
    const a = await api.submitCode(pasted);
    setAccount(a);
    setPasting(false);
    setPasted('');
    toast(`Connecté à ${label} : ${a.ownedCount} jeux possédés`);
  });
  const pasteBox = pasting && (
    <div className="account-paste">
      <span>
        Connectez-vous dans la page qui vient de s'ouvrir dans votre navigateur. Une fois connecté, copiez l'adresse
        complète de la page affichée (elle commence par <code>https://embed.gog.com/on_login_success</code>) et collez-la ici.
      </span>
      <div className="account-paste-row">
        <input
          className="input"
          autoFocus
          placeholder="https://embed.gog.com/on_login_success?origin=client&code=…"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && pasted.trim() && submitCode()}
        />
        <button className="btn primary" onClick={submitCode} disabled={!pasted.trim() || !!busy}>{spin('code', Check)} Valider</button>
        <button className="btn" onClick={() => { setPasting(false); setPasted(''); }}>Annuler</button>
      </div>
    </div>
  );
  const browserButton = browserLogin && !pasting && (
    <button className="btn" onClick={browserLogin} disabled={!!busy} title="Si la vérification anti-robot échoue dans la fenêtre de connexion">
      <Globe /> Via le navigateur
    </button>
  );
  const refresh = run('refresh', async () => setAccount(await api.refresh()));
  const logout = run('logout', async () => {
    setAccount(await api.logout());
    toast(`Déconnecté de ${label}`);
  });

  if (account === undefined) return null;
  if (!account) {
    return (
      <div className="setting wrap">
        <div className="txt">
          <strong>Compte {label}</strong>
          <span>
            Connectez-vous {hint}. Vous vous connectez sur la page officielle de {label} : Pimplay ne voit jamais votre mot de passe.
          </span>
        </div>
        <div className="setting-actions">
          {browserButton}
          <button className="btn primary" onClick={login} disabled={!!busy}>{spin('login', LogIn)} Se connecter à {label}</button>
        </div>
        {pasteBox}
      </div>
    );
  }
  return (
    <div className="setting wrap">
      <div className="account">
        {account.avatar ? <img src={account.avatar} alt="" /> : <span className="account-avatar">{short}</span>}
        <div className="txt">
          <strong>{account.name || `Compte ${label}`}</strong>
          <span>
            {account.ownedCount} jeux possédés{account.at && ` · mis à jour ${timeAgo(account.at).toLowerCase()}`}
          </span>
          {account.error && <span className="account-error"><TriangleAlert /> {account.error}</span>}
        </div>
      </div>
      <div className="setting-actions">
        {account.error ? (
          <>
            {browserButton}
            <button className="btn primary" onClick={login} disabled={!!busy}>{spin('login', LogIn)} Se reconnecter</button>
          </>
        ) : (
          <button className="btn" onClick={refresh} disabled={!!busy}>{spin('refresh', RefreshCw)} Actualiser</button>
        )}
        <button className="btn" onClick={logout} disabled={!!busy}>{spin('logout', LogOut)} Se déconnecter</button>
      </div>
      {pasteBox}
    </div>
  );
}

// Mises à jour : Pimplay vérifie tout seul (au démarrage puis toutes les 6 h) ; ici, l'état et une
// vérification à la demande
function UpdateSetting({ version }) {
  const update = useUpdate();
  const s = update?.status;
  let text = 'Pimplay vérifie les nouvelles versions au démarrage puis toutes les 6 heures, et les télécharge en arrière-plan.';
  if (s === 'dev') text = 'Version de développement : les mises à jour automatiques ne concernent que la version installée.';
  else if (s === 'checking') text = 'Recherche d’une nouvelle version…';
  else if (s === 'latest') text = `Vous avez la dernière version${update.checkedAt ? ` (vérifié ${timeAgo(update.checkedAt).toLowerCase()})` : ''}.`;
  else if (s === 'downloading') text = `Téléchargement de la version ${update.version}… ${update.progress || 0} %`;
  else if (s === 'ready') text = `La version ${update.version} est prête : redémarrez Pimplay pour l'installer.`;
  else if (s === 'error') text = update.error;
  return (
    <div className="setting">
      <div className="txt">
        <strong>Mises à jour{version && <span className="setting-version">Version {version}</span>}</strong>
        <span>{text}</span>
      </div>
      {s === 'ready' ? (
        <button className="btn primary" onClick={() => window.pimplay.update.install()}><RotateCw /> Redémarrer</button>
      ) : (
        <button className="btn" onClick={() => window.pimplay.update.check()} disabled={!update || ['dev', 'checking', 'downloading'].includes(s)}>
          {s === 'checking' ? <Loader2 className="spin" /> : <RefreshCw />} Rechercher
        </button>
      )}
    </div>
  );
}

export default function Settings() {
  const { settings, updateSettings: update, library, modTools } = useApp();
  const [info, setInfo] = useState(null);
  const hiddenCount = library.filter((g) => g.hidden).length;
  // Couleur libre : aperçu en direct pendant le choix, enregistrée dès que la sélection se stabilise
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    if (!draft) return undefined;
    applyAccent({ main: draft });
    const t = setTimeout(() => update({ accent: { main: draft, custom: true } }), 500);
    return () => clearTimeout(t);
  }, [draft]);
  const current = resolveAccent(settings.accent);

  useEffect(() => {
    window.pimplay.app.info().then(setInfo);
  }, []);
  return (
    <div className="page">
      <div className="page-head"><h1>Paramètres</h1></div>
      <div className="settings">
        <h2 className="section" style={{ margin: '4px 0 0' }}>Comptes</h2>
        <Account kind="steam" />
        <Account kind="epic" />
        <Account kind="gog" />

        <h2 className="section" style={{ margin: '18px 0 0' }}>Bibliothèque</h2>
        <div className="setting">
          <div className="txt">
            <strong>Afficher le filtre « Masqués »</strong>
            <span>
              Montre le bouton « Masqués » dans Mes jeux pour retrouver et réafficher les jeux masqués.
              Désactivé, rien n'indique qu'il en existe ; réactivez-le ici pour y accéder.
              {hiddenCount > 0 && ` (${hiddenCount} jeu${hiddenCount > 1 ? 'x' : ''} masqué${hiddenCount > 1 ? 's' : ''})`}
            </span>
          </div>
          <Toggle on={settings.showHiddenFilter !== false} onChange={(v) => update({ showHiddenFilter: v })} />
        </div>
        <div className="setting">
          <div className="txt">
            <strong>Jeux gratuits Epic sur l'Accueil</strong>
            <span>Affiche les jeux offerts cette semaine sur l'Epic Games Store et les prochains, avec ceux que vous avez déjà récupérés.</span>
          </div>
          <Toggle on={settings.showEpicFree !== false} onChange={(v) => update({ showEpicFree: v })} />
        </div>
        <div className="setting">
          <div className="txt">
            <strong>Données de l'application</strong>
            <span>Favoris, jeux ajoutés manuellement, jaquettes personnalisées, temps de jeu et trainers.</span>
          </div>
          <button className="btn" onClick={() => window.pimplay.app.openData()}><FolderOpen /> Ouvrir le dossier</button>
        </div>

        <h2 className="section" style={{ margin: '18px 0 0' }}>Application</h2>
        <div className="setting">
          <div className="txt">
            <strong>Quand je ferme la fenêtre</strong>
            <span>Réduit dans la zone de notification, Pimplay continue de suivre vos jeux et de compter le temps de jeu (jeux hors Steam).</span>
          </div>
          <Select
            width={290}
            label="Quand je ferme la fenêtre"
            value={settings.closeAction || 'ask'}
            onChange={(v) => update({ closeAction: v })}
            options={[
              ['ask', 'Me demander', CircleHelp],
              ['tray', 'Réduire dans la zone de notification', ArrowDownToLine],
              ['quit', 'Quitter Pimplay', Power],
            ]}
          />
        </div>
        <UpdateSetting version={info?.version} />

        <h2 className="section" style={{ margin: '18px 0 0' }}>Apparence</h2>
        <div className="setting accent-setting">
          <div className="txt">
            <strong>Couleur d'accent</strong>
            <span>Boutons, sélections, graphiques et logo. Le dégradé va de la couleur principale à une couleur assortie.</span>
          </div>
          <div className="accent-swatches">
            {ACCENTS.map((a) => {
              const active = (current.main === a.main && !settings.accent?.custom) || (!settings.accent && a.id === 'violet');
              return (
                <button
                  key={a.id}
                  className={`accent-swatch ${active ? 'active' : ''}`}
                  style={{ background: `linear-gradient(135deg, ${a.main}, ${a.second})` }}
                  title={a.name}
                  aria-label={a.name}
                  onClick={() => update({ accent: { main: a.main, second: a.second } })}
                >
                  {active && <Check />}
                </button>
              );
            })}
            <label
              className={`accent-swatch custom ${settings.accent?.custom ? 'active' : ''}`}
              title="Couleur personnalisée"
              style={settings.accent?.custom ? { background: `linear-gradient(135deg, ${current.main}, ${current.second})` } : undefined}
            >
              {settings.accent?.custom ? <Check /> : <Pipette />}
              <input
                type="color"
                value={current.main}
                onChange={(e) => setDraft(e.target.value)}
              />
            </label>
          </div>
        </div>

        <h2 className="section" style={{ margin: '18px 0 0' }}>Lancement des jeux</h2>
        <div className="setting">
          <div className="txt">
            <strong>Démarrer Steam en arrière-plan</strong>
            <span>Si Steam est fermé, il démarre directement dans la zone de notification, sans ouvrir sa fenêtre. Epic démarre toujours en mode silencieux.</span>
          </div>
          <Toggle on={settings.silentLaunchers !== false} onChange={(v) => update({ silentLaunchers: v })} />
        </div>
        <div className="setting">
          <div className="txt">
            <strong>Réduire le launcher quand le jeu démarre</strong>
            <span>Dès que le jeu est lancé, les fenêtres de Steam ou d'Epic restées ouvertes sont réduites dans la barre des tâches.</span>
          </div>
          <Toggle on={settings.minimizeLauncher !== false} onChange={(v) => update({ minimizeLauncher: v })} />
        </div>
        <div className="setting">
          <div className="txt">
            <strong>Réduire Pimplay pendant que je joue</strong>
            <span>Pimplay se réduit quand un jeu lancé depuis l'app démarre, puis revient à l'écran quand vous le quittez.</span>
          </div>
          <Toggle on={!!settings.minimizeSelf} onChange={(v) => update({ minimizeSelf: v })} />
        </div>

        <h2 className="section" style={{ margin: '18px 0 0' }}>Mods</h2>
        <div className="setting">
          <div className="txt">
            <strong>Outils de mod / trainer</strong>
            <span>
              Scanner mémoire, mods, raccourcis et connexion aux jeux. Désactivé, Pimplay devient un simple launcher :
              tout ce qui touche aux mods disparaît et Pimplay ne s'attache plus aux jeux. Vos mods restent enregistrés.
            </span>
          </div>
          <Toggle on={modTools} onChange={(v) => update({ modTools: v })} />
        </div>
        {modTools && (
          <>
            <div className="setting">
              <div className="txt">
                <strong>Raccourcis clavier globaux</strong>
                <span>Active les raccourcis des mods pendant que vous jouez (uniquement quand un jeu est connecté).</span>
              </div>
              <Toggle on={settings.hotkeysEnabled} onChange={(v) => update({ hotkeysEnabled: v })} />
            </div>
            <div className="setting">
              <div className="txt">
                <strong>Mode administrateur</strong>
                <span>
                  {info?.admin
                    ? 'Pimplay tourne en administrateur : il peut se connecter à tous les jeux.'
                    : "Pimplay tourne sans droits administrateur. Si un jeu refuse la connexion (« Accès refusé »), relancez Pimplay via clic droit › Exécuter en tant qu'administrateur."}
                </span>
              </div>
              <span className={`pill ${info?.admin ? 'ok' : ''}`}><span className="dot" /> {info?.admin ? 'Admin' : 'Standard'}</span>
            </div>
            <div className="notice">
              <ShieldAlert />
              <div>
                Pimplay est conçu pour les jeux solo. Il refuse de se connecter aux jeux protégés par un anti-triche (EasyAntiCheat, BattlEye…).
                N'utilisez jamais de mods dans un jeu en ligne ou compétitif.
              </div>
            </div>
          </>
        )}
        {info && <div style={{ color: 'var(--dim)', fontSize: 12, marginTop: 10 }}>Pimplay {info.version} · Electron {info.electron}</div>}
      </div>
    </div>
  );
}
