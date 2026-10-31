import { useState } from 'react';
import { Modal, Seg, HotkeyInput } from './ui.jsx';

export const KINDS = [
  ['freeze', 'Gel de valeur'],
  ['slider', 'Curseur'],
  ['button', 'Bouton'],
  ['multiplier', 'Multiplicateur'],
  ['patch', 'Patch de code'],
];

export const VALUE_TYPES = [
  ['int32', 'Entier 4 octets'],
  ['float', 'Flottant'],
  ['double', 'Double'],
  ['int16', 'Entier 2 octets'],
  ['int64', 'Entier 8 octets'],
  ['byte', 'Octet'],
];

// Les mods acceptent aussi le décimal .NET (argent des jeux Unity), que le scanner ne propose pas
export const CHEAT_VALUE_TYPES = [...VALUE_TYPES, ['decimal', 'Décimal .NET']];

export function newCheat(partial = {}) {
  return {
    id: crypto.randomUUID(),
    name: '',
    category: 'Général',
    kind: 'freeze',
    valueType: 'int32',
    value: 999,
    min: 0,
    max: 9999,
    step: 1,
    freeze: false,
    op: 'set',
    patch: '',
    hotkey: '',
    target: { address: '' },
    ...partial,
    isNew: true,
  };
}

const modeOf = (t) => (t.il2cpp ? 'il2cpp' : t.aob ? 'aob' : t.module ? 'module' : 'address');

// Conditions IL2CPP en texte : « <IsDriven>k__BackingField = true, Index = 2 »
const whereToText = (w) => Object.entries(w || {}).map(([k, v]) => `${k} = ${v}`).join(', ');
function parseWhere(text) {
  const out = {};
  for (const part of text.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [k, v] = part.split('=').map((x) => x.trim());
    if (!k || v === undefined) throw new Error(`Condition invalide : « ${part} » (attendu : champ = valeur).`);
    out[k] = v === 'true' ? true : v === 'false' ? false : Number(v);
    if (Number.isNaN(out[k])) throw new Error(`Valeur invalide dans « ${part} ».`);
  }
  return out;
}

export default function CheatEditor({ cheat, categories = [], onSave, onClose }) {
  const [c, setC] = useState(() => ({ ...cheat, target: { ...cheat.target } }));
  const [mode, setMode] = useState(() => modeOf(cheat.target));
  const [pointers, setPointers] = useState((cheat.target.pointers || []).join(', '));
  const [il, setIl] = useState(() => ({
    class: cheat.target.il2cpp?.class || '',
    path: (cheat.target.il2cpp?.path || []).join(', '),
    where: whereToText(cheat.target.il2cpp?.where),
    all: !!cheat.target.il2cpp?.all,
    static: !!cheat.target.il2cpp?.static,
    method: cheat.target.il2cpp?.method || '',
    offset: cheat.target.il2cpp?.offset || '',
  }));
  const [error, setError] = useState(null);
  const set = (patch) => setC((x) => ({ ...x, ...patch }));
  const setT = (patch) => setC((x) => ({ ...x, target: { ...x.target, ...patch } }));

  const submit = () => {
    if (!c.name.trim()) return setError('Donnez un nom au mod.');
    const t = c.target;
    const target = {};
    if (mode === 'address') {
      if (!t.address?.trim()) return setError("Indiquez l'adresse.");
      target.address = t.address.trim();
    } else if (mode === 'module') {
      if (!t.module?.trim()) return setError('Indiquez le module (ex. Game.exe).');
      target.module = t.module.trim();
      target.offset = (t.offset || '0').trim();
    } else if (mode === 'il2cpp') {
      if (!il.class.trim()) return setError('Indiquez la classe (ex. MoonCleaners.MoonPrototypeVehicle).');
      const path = il.path.split(',').map((p) => p.trim()).filter(Boolean);
      if (il.method.trim()) target.il2cpp = { class: il.class.trim(), method: il.method.trim() };
      else {
        if (!path.length) return setError('Indiquez le chemin des champs (ex. <Spec>k__BackingField, width) ou une méthode.');
        target.il2cpp = { class: il.class.trim(), path };
        if (il.static) target.il2cpp.static = true;
        if (il.all) target.il2cpp.all = true;
      }
      if (il.offset.trim() && il.offset.trim() !== '0') target.il2cpp.offset = il.offset.trim();
      try {
        const where = parseWhere(il.where);
        if (Object.keys(where).length && !target.il2cpp.method && !target.il2cpp.static) target.il2cpp.where = where;
      } catch (e) {
        return setError(e.message);
      }
    } else {
      if (!t.aob?.trim()) return setError('Indiquez la signature AOB.');
      target.aob = t.aob.trim().toUpperCase();
      if (t.module?.trim()) target.module = t.module.trim();
      if (t.aobOffset) target.aobOffset = String(t.aobOffset).trim();
    }
    const ptrs = pointers.split(/[,\s]+/).map((p) => p.trim()).filter(Boolean);
    if (ptrs.length && c.kind !== 'patch' && mode !== 'il2cpp') target.pointers = ptrs;
    if (c.kind === 'patch' && !/^([0-9a-f]{2}\s*)+$/i.test(c.patch.trim())) return setError('Octets du patch invalides (ex. 90 90 90).');
    if (c.kind === 'patch' && c.expect?.trim() && !/^([0-9a-f]{2}\s*)+$/i.test(c.expect.trim())) return setError('Octets attendus invalides (ex. 0F 11 45 00).');

    const out = { id: c.id, name: c.name.trim(), category: c.category.trim() || 'Général', kind: c.kind, hotkey: c.hotkey, target };
    if (c.kind === 'patch') out.patch = c.patch.trim().toUpperCase();
    if (c.kind === 'patch' && c.expect?.trim()) out.expect = c.expect.trim().toUpperCase();
    else {
      out.valueType = c.valueType;
      out.value = Number(c.value);
    }
    if (c.kind === 'slider') Object.assign(out, { min: Number(c.min), max: Number(c.max), step: Number(c.step) || 1, freeze: !!c.freeze });
    if (c.kind === 'multiplier') Object.assign(out, { min: Number(c.min), max: Number(c.max), step: Number(c.step) || 0.5 });
    if (c.kind === 'button') out.op = c.op;
    onSave(out);
  };

  return (
    <Modal
      title={cheat.isNew ? 'Nouveau mod' : `Modifier « ${cheat.name} »`}
      onClose={onClose}
      footer={
        <>
          {error && <span style={{ color: 'var(--danger)', marginRight: 'auto', fontSize: 13, alignSelf: 'center' }}>{error}</span>}
          <button className="btn ghost" onClick={onClose}>Annuler</button>
          <button className="btn primary" onClick={submit}>Enregistrer</button>
        </>
      }
    >
      <div className="row">
        <div className="field" style={{ flex: 2 }}>
          <label>Nom</label>
          <input className="input" autoFocus value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="Santé infinie" />
        </div>
        <div className="field">
          <label>Catégorie</label>
          <input className="input" list="cats" value={c.category} onChange={(e) => set({ category: e.target.value })} />
          <datalist id="cats">{categories.map((x) => <option key={x} value={x} />)}</datalist>
        </div>
      </div>

      <div className="field">
        <label>Type de mod</label>
        <Seg
          value={c.kind}
          options={KINDS}
          onChange={(kind) => set(kind === 'multiplier' && c.kind !== 'multiplier' ? { kind, valueType: 'float', value: 2, min: 1, max: 10, step: 0.5 } : { kind })}
        />
        <span className="hint">
          {{
            freeze: 'Réécrit la valeur en continu tant que le mod est activé (vie, munitions, endurance…).',
            slider: "Choisissez une valeur avec un curseur (argent, vitesse…). Option : la geler.",
            button: "Écrit (ou ajoute) une valeur une fois à chaque clic ou raccourci.",
            multiplier: "Multiplie la valeur d'origine du jeu (vitesse, largeur…) et la remet telle quelle à la désactivation.",
            patch: "Remplace des octets de code (ex. NOP sur l'instruction qui retire de la vie). Restauré à la désactivation.",
          }[c.kind]}
        </span>
      </div>

      {c.kind !== 'patch' && (
        <div className="row">
          <div className="field">
            <label>Type de valeur</label>
            <select className="select" value={c.valueType} onChange={(e) => set({ valueType: e.target.value })}>
              {CHEAT_VALUE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {c.kind === 'button' && (
            <div className="field">
              <label>Opération</label>
              <Seg value={c.op} options={[['set', 'Définir'], ['add', 'Ajouter']]} onChange={(op) => set({ op })} />
            </div>
          )}
          <div className="field">
            <label>{c.kind === 'slider' ? 'Valeur par défaut' : c.kind === 'multiplier' ? 'Multiplicateur par défaut' : c.op === 'add' && c.kind === 'button' ? 'Quantité' : 'Valeur'}</label>
            <input className="input" type="number" value={c.value} onChange={(e) => set({ value: e.target.value })} />
          </div>
        </div>
      )}

      {(c.kind === 'slider' || c.kind === 'multiplier') && (
        <>
          <div className="row">
            <div className="field"><label>Minimum</label><input className="input" type="number" value={c.min} onChange={(e) => set({ min: e.target.value })} /></div>
            <div className="field"><label>Maximum</label><input className="input" type="number" value={c.max} onChange={(e) => set({ max: e.target.value })} /></div>
            <div className="field"><label>Pas</label><input className="input" type="number" value={c.step} onChange={(e) => set({ step: e.target.value })} /></div>
          </div>
          {c.kind === 'slider' && <label className="check"><input type="checkbox" checked={!!c.freeze} onChange={(e) => set({ freeze: e.target.checked })} /> Geler la valeur (ajoute un interrupteur)</label>}
        </>
      )}

      {c.kind === 'patch' && (
        <div className="field">
          <label>Octets de remplacement</label>
          <input className="input mono" value={c.patch} onChange={(e) => set({ patch: e.target.value })} placeholder="90 90 90 90 90 90" />
          <label>Octets attendus avant le patch (optionnel)</label>
          <input className="input mono" value={c.expect || ''} onChange={(e) => set({ expect: e.target.value })} placeholder="0F 11 45 00" />
          <span className="hint">Si le code du jeu ne commence pas par ces octets (mise à jour), le patch n'est pas appliqué.</span>
        </div>
      )}

      <div className="field">
        <label>Cible en mémoire</label>
        <Seg value={mode} options={[['address', 'Adresse'], ['module', 'Module + offset'], ['aob', 'Signature AOB'], ['il2cpp', 'Objet Unity (IL2CPP)']]} onChange={setMode} />
      </div>

      {mode === 'address' && (
        <div className="field">
          <input className="input mono" value={c.target.address || ''} onChange={(e) => setT({ address: e.target.value })} placeholder="0x1A2B3C4D" />
          <span className="hint">Adresse dynamique : elle change souvent au relancement du jeu. Pour un mod durable, utilisez module + offset avec une chaîne de pointeurs, ou une signature AOB.</span>
        </div>
      )}
      {mode === 'module' && (
        <div className="row">
          <div className="field" style={{ flex: 2 }}><label>Module</label><input className="input mono" value={c.target.module || ''} onChange={(e) => setT({ module: e.target.value })} placeholder="Game.exe" /></div>
          <div className="field"><label>Offset</label><input className="input mono" value={c.target.offset || ''} onChange={(e) => setT({ offset: e.target.value })} placeholder="0x1A2B3C" /></div>
        </div>
      )}
      {mode === 'aob' && (
        <>
          <div className="field"><label>Signature (?? = joker)</label><input className="input mono" value={c.target.aob || ''} onChange={(e) => setT({ aob: e.target.value })} placeholder="29 83 ?? ?? 00 00 8B 45" /></div>
          <div className="row">
            <div className="field" style={{ flex: 2 }}><label>Module (optionnel)</label><input className="input mono" value={c.target.module || ''} onChange={(e) => setT({ module: e.target.value })} placeholder="Game.exe" /></div>
            <div className="field"><label>Décalage</label><input className="input mono" value={c.target.aobOffset || ''} onChange={(e) => setT({ aobOffset: e.target.value })} placeholder="0" /></div>
          </div>
        </>
      )}
      {mode === 'il2cpp' && (
        <>
          <div className="field">
            <label>Classe (espace de noms.Classe)</label>
            <input className="input mono" value={il.class} onChange={(e) => setIl({ ...il, class: e.target.value })} placeholder="MoonCleaners.MoonPrototypeVehicle" />
          </div>
          <div className="field">
            <label>Chemin des champs</label>
            <input className="input mono" value={il.path} onChange={(e) => setIl({ ...il, path: e.target.value })} placeholder="<Spec>k__BackingField, width" />
            <span className="hint">Champs suivis depuis l'objet, séparés par des virgules. Le dernier est la valeur visée. Une propriété C# « Spec » s'écrit &lt;Spec&gt;k__BackingField.</span>
          </div>
          <div className="field">
            <label>Conditions (optionnel)</label>
            <input className="input mono" value={il.where} onChange={(e) => setIl({ ...il, where: e.target.value })} placeholder="<IsDriven>k__BackingField = true" />
            <span className="hint">Choisit l'objet quand il y en a plusieurs (ex. le véhicule conduit). Jeux Unity 64 bits ; la première recherche prend quelques secondes.</span>
          </div>
          <label className="check"><input type="checkbox" checked={il.all} onChange={(e) => setIl({ ...il, all: e.target.checked })} /> Appliquer à tous les objets de la classe (tous les outils, tous les robots…)</label>
          <label className="check"><input type="checkbox" checked={il.static} onChange={(e) => setIl({ ...il, static: e.target.checked })} /> Le premier champ est statique (partagé par la classe)</label>
          <div className="row">
            <div className="field" style={{ flex: 2 }}>
              <label>Méthode (pour un patch de code)</label>
              <input className="input mono" value={il.method} onChange={(e) => setIl({ ...il, method: e.target.value })} placeholder="DepositTimeMultiplier" />
            </div>
            <div className="field">
              <label>Décalage</label>
              <input className="input mono" value={il.offset} onChange={(e) => setIl({ ...il, offset: e.target.value })} placeholder="0x173" />
            </div>
          </div>
          <span className="hint">Avec une méthode, la cible est son code (+ décalage) et le chemin est ignoré. « [] » dans le chemin parcourt chaque élément d'une liste ou d'un tableau.</span>
        </>
      )}
      {c.kind !== 'patch' && mode !== 'aob' && mode !== 'il2cpp' && (
        <div className="field">
          <label>Chaîne de pointeurs (optionnel)</label>
          <input className="input mono" value={pointers} onChange={(e) => setPointers(e.target.value)} placeholder="0x10, 0x48, 0x2C" />
          <span className="hint">Chaque offset est appliqué après avoir lu le pointeur à l'adresse courante (comme dans Cheat Engine).</span>
        </div>
      )}

      <div className="field">
        <label>Raccourci clavier</label>
        <div><HotkeyInput value={c.hotkey} onChange={(hotkey) => set({ hotkey })} /></div>
      </div>
    </Modal>
  );
}
