import { useState } from 'react';
import { Modal, Seg, HotkeyInput } from './ui.jsx';

export const KINDS = [
  ['freeze', 'Gel de valeur'],
  ['slider', 'Curseur'],
  ['button', 'Bouton'],
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

const modeOf = (t) => (t.aob ? 'aob' : t.module ? 'module' : 'address');

export default function CheatEditor({ cheat, categories = [], onSave, onClose }) {
  const [c, setC] = useState(() => ({ ...cheat, target: { ...cheat.target } }));
  const [mode, setMode] = useState(() => modeOf(cheat.target));
  const [pointers, setPointers] = useState((cheat.target.pointers || []).join(', '));
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
    } else {
      if (!t.aob?.trim()) return setError('Indiquez la signature AOB.');
      target.aob = t.aob.trim().toUpperCase();
      if (t.module?.trim()) target.module = t.module.trim();
      if (t.aobOffset) target.aobOffset = String(t.aobOffset).trim();
    }
    const ptrs = pointers.split(/[,\s]+/).map((p) => p.trim()).filter(Boolean);
    if (ptrs.length && c.kind !== 'patch') target.pointers = ptrs;
    if (c.kind === 'patch' && !/^([0-9a-f]{2}\s*)+$/i.test(c.patch.trim())) return setError('Octets du patch invalides (ex. 90 90 90).');

    const out = { id: c.id, name: c.name.trim(), category: c.category.trim() || 'Général', kind: c.kind, hotkey: c.hotkey, target };
    if (c.kind === 'patch') out.patch = c.patch.trim().toUpperCase();
    else {
      out.valueType = c.valueType;
      out.value = Number(c.value);
    }
    if (c.kind === 'slider') Object.assign(out, { min: Number(c.min), max: Number(c.max), step: Number(c.step) || 1, freeze: !!c.freeze });
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
        <Seg value={c.kind} options={KINDS} onChange={(kind) => set({ kind })} />
        <span className="hint">
          {{
            freeze: 'Réécrit la valeur en continu tant que le mod est activé (vie, munitions, endurance…).',
            slider: "Choisissez une valeur avec un curseur (argent, vitesse…). Option : la geler.",
            button: "Écrit (ou ajoute) une valeur une fois à chaque clic ou raccourci.",
            patch: "Remplace des octets de code (ex. NOP sur l'instruction qui retire de la vie). Restauré à la désactivation.",
          }[c.kind]}
        </span>
      </div>

      {c.kind !== 'patch' && (
        <div className="row">
          <div className="field">
            <label>Type de valeur</label>
            <select className="select" value={c.valueType} onChange={(e) => set({ valueType: e.target.value })}>
              {VALUE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {c.kind === 'button' && (
            <div className="field">
              <label>Opération</label>
              <Seg value={c.op} options={[['set', 'Définir'], ['add', 'Ajouter']]} onChange={(op) => set({ op })} />
            </div>
          )}
          <div className="field">
            <label>{c.kind === 'slider' ? 'Valeur par défaut' : c.op === 'add' && c.kind === 'button' ? 'Quantité' : 'Valeur'}</label>
            <input className="input" type="number" value={c.value} onChange={(e) => set({ value: e.target.value })} />
          </div>
        </div>
      )}

      {c.kind === 'slider' && (
        <>
          <div className="row">
            <div className="field"><label>Minimum</label><input className="input" type="number" value={c.min} onChange={(e) => set({ min: e.target.value })} /></div>
            <div className="field"><label>Maximum</label><input className="input" type="number" value={c.max} onChange={(e) => set({ max: e.target.value })} /></div>
            <div className="field"><label>Pas</label><input className="input" type="number" value={c.step} onChange={(e) => set({ step: e.target.value })} /></div>
          </div>
          <label className="check"><input type="checkbox" checked={!!c.freeze} onChange={(e) => set({ freeze: e.target.checked })} /> Geler la valeur (ajoute un interrupteur)</label>
        </>
      )}

      {c.kind === 'patch' && (
        <div className="field">
          <label>Octets de remplacement</label>
          <input className="input mono" value={c.patch} onChange={(e) => set({ patch: e.target.value })} placeholder="90 90 90 90 90 90" />
        </div>
      )}

      <div className="field">
        <label>Cible en mémoire</label>
        <Seg value={mode} options={[['address', 'Adresse'], ['module', 'Module + offset'], ['aob', 'Signature AOB']]} onChange={setMode} />
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
      {c.kind !== 'patch' && mode !== 'aob' && (
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
