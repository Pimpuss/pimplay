// Session de trainer : attache un processus de jeu et applique les mods (gel, patch, bouton, curseur,
// multiplicateur).
const { EventEmitter } = require('node:events');
const { GameProcess, parseHex, toHex } = require('./process.cjs');

const FREEZE_MS = 100;
const READ_MS = 500;

function parseBytes(str) {
  return Buffer.from(String(str).trim().split(/\s+/).map((b) => parseInt(b, 16)));
}

class TrainerSession extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.gameId = null;
    this.trainer = { cheats: [] };
    this.state = new Map(); // id -> { enabled, value, error, current }
    this.patches = new Map(); // id -> { addr, original }
    this.multiplied = new Map(); // id -> { addr, base, written }
    this.error = null;
    this.freezeTimer = null;
    this.readTimer = null;
  }

  get attached() { return !!this.proc; }

  setTarget(gameId, trainer) {
    if (gameId !== this.gameId) {
      this.detach();
      this.state.clear();
      this.gameId = gameId;
      this.error = null;
    }
    this.setTrainer(trainer);
  }

  setTrainer(trainer) {
    this.trainer = trainer || { cheats: [] };
    const ids = new Set(this.trainer.cheats.map((c) => c.id));
    for (const id of [...this.state.keys()]) {
      if (!ids.has(id)) {
        if (this.patches.has(id)) this.restorePatch(id);
        if (this.multiplied.has(id)) this.restoreMultiplier(id);
        this.state.delete(id);
      }
    }
    for (const c of this.trainer.cheats) {
      if (!this.state.has(c.id)) this.state.set(c.id, { enabled: false, value: c.value ?? 0, error: null, current: null });
    }
    this.emitState();
  }

  attach(pid) {
    if (this.proc?.pid === pid) return;
    this.detach();
    try {
      this.proc = GameProcess.open(pid);
      this.error = null;
    } catch (e) {
      this.error = e.message;
      this.emitState();
      return;
    }
    // Ré-applique les mods restés activés (ex. le jeu a été relancé)
    for (const c of this.trainer.cheats) {
      const s = this.state.get(c.id);
      if (s?.enabled && c.kind === 'patch') this.applyPatch(c, s);
    }
    this.freezeTimer = setInterval(() => this.freezeTick(), FREEZE_MS);
    this.readTimer = setInterval(() => this.readTick(), READ_MS);
    this.emitState();
  }

  detach(reason) {
    clearInterval(this.freezeTimer);
    clearInterval(this.readTimer);
    this.freezeTimer = this.readTimer = null;
    if (this.proc) {
      if (this.proc.isAlive()) {
        for (const id of [...this.patches.keys()]) this.restorePatch(id);
        for (const id of [...this.multiplied.keys()]) this.restoreMultiplier(id);
      }
      this.proc.close();
    }
    this.patches.clear();
    this.multiplied.clear();
    this.proc = null;
    if (reason) this.error = reason;
    this.emitState();
  }

  cheat(id) {
    return this.trainer.cheats.find((c) => c.id === id);
  }

  resolve(c, s) {
    try {
      const addr = this.proc.resolve(c.target);
      s.error = addr === null ? 'Adresse introuvable' : null;
      return addr;
    } catch (e) {
      s.error = e.message;
      return null;
    }
  }

  // Toutes les adresses d'un mod (une par objet pour une cible IL2CPP « all »)
  resolveMany(c, s) {
    try {
      const addrs = this.proc.resolveAll(c.target);
      s.error = addrs.length ? null : 'Adresse introuvable';
      return addrs;
    } catch (e) {
      s.error = e.message;
      return [];
    }
  }

  toggle(id, on) {
    const c = this.cheat(id);
    const s = this.state.get(id);
    if (!c || !s) return;
    s.enabled = on ?? !s.enabled;
    if (this.proc && c.kind === 'patch') {
      if (s.enabled) this.applyPatch(c, s);
      else this.restorePatch(id);
    }
    if (this.proc && c.kind === 'multiplier') {
      if (s.enabled) this.applyMultiplier(c, s);
      else this.restoreMultiplier(id);
    }
    if (this.proc && s.enabled) this.writeCheat(c, s);
    this.emitState();
  }

  setValue(id, value) {
    const c = this.cheat(id);
    const s = this.state.get(id);
    if (!c || !s) return;
    s.value = Number(value);
    if (this.proc && c.kind === 'slider' && (!c.freeze || s.enabled)) this.writeCheat(c, s);
    if (this.proc && c.kind === 'multiplier' && s.enabled) this.applyMultiplier(c, s);
    this.emitState();
  }

  trigger(id) {
    const c = this.cheat(id);
    const s = this.state.get(id);
    if (!c || !s || !this.proc) return;
    for (const addr of this.resolveMany(c, s)) {
      if (c.op === 'add') {
        const cur = this.proc.readValue(addr, c.valueType);
        if (cur !== null) this.proc.writeValue(addr, c.valueType, cur + Number(c.value));
      } else {
        this.proc.writeValue(addr, c.valueType, c.value);
      }
    }
    this.emitState();
  }

  // Action déclenchée par un raccourci clavier
  hotkey(id) {
    const c = this.cheat(id);
    if (!c) return;
    if (c.kind === 'button') this.trigger(id);
    else if (c.kind === 'slider' && !c.freeze) this.setValue(id, this.state.get(id).value);
    else this.toggle(id);
  }

  writeCheat(c, s) {
    if (c.kind !== 'freeze' && c.kind !== 'slider') return;
    const value = c.kind === 'slider' ? s.value : c.value;
    for (const addr of this.resolveMany(c, s)) {
      if (!this.proc.writeValue(addr, c.valueType, value)) s.error = 'Écriture impossible';
    }
  }

  applyPatch(c, s) {
    const addr = this.resolve(c, s);
    // Cible IL2CPP encore en recherche : le mod reste activé, freezeTick réessaiera
    if (addr === null) { if (!/^Recherche|pas encore/.test(s.error || '')) s.enabled = false; return; }
    const bytes = parseBytes(c.patch);
    const expect = c.expect ? parseBytes(c.expect) : null;
    const kept = this.patches.get(c.id)?.original;
    const current = kept ? null : this.proc.read(addr, Math.max(bytes.length, expect?.length || 0));
    const original = kept || current?.subarray(0, bytes.length);
    if (!original) { s.error = 'Lecture impossible'; s.enabled = false; return; }
    // Octets attendus avant le patch : si le code a changé (mise à jour du jeu), on ne touche à rien
    if (expect && current && !current.subarray(0, expect.length).equals(expect)) {
      s.error = 'Code du jeu différent de celui attendu (mise à jour ?) : patch non appliqué';
      s.enabled = false;
      return;
    }
    if (!this.proc.writeProtected(addr, bytes)) { s.error = 'Patch impossible'; s.enabled = false; return; }
    this.patches.set(c.id, { addr, original });
  }

  restorePatch(id) {
    const p = this.patches.get(id);
    if (p && this.proc) this.proc.writeProtected(p.addr, p.original);
    this.patches.delete(id);
  }

  // Multiplie la valeur d'origine du jeu et la réécrit tant que le mod est actif. La cible peut changer
  // (autre véhicule) : l'ancienne retrouve alors sa valeur. Si le jeu change lui-même la valeur (autre
  // outil équipé…), elle devient la nouvelle base, mais seulement si elle reste stable sur deux passages :
  // une écriture éclair d'un autre outil (Wand…) serait sinon remultipliée sans fin.
  // Une cible « all » a plusieurs adresses (une par objet) : chacune garde sa propre base.
  applyMultiplier(c, s) {
    const addrs = this.resolveMany(c, s);
    const entries = this.multiplied.get(c.id) || new Map(); // adresse -> { addr, valueType, base, written, changed }
    for (const [key, m] of entries) {
      if (!addrs.includes(m.addr)) { this.restoreEntry(m); entries.delete(key); }
    }
    this.multiplied.set(c.id, entries);
    s.base = null;
    const factor = Number(s.value);
    for (const addr of addrs) {
      const key = addr.toString();
      const m = entries.get(key);
      const cur = this.proc.readValue(addr, c.valueType);
      if (cur === null) { s.error = 'Lecture impossible'; continue; }
      let base = m ? m.base : cur;
      if (m && cur !== m.written) {
        if (m.changed !== cur) { m.changed = cur; s.base ??= m.base; continue; }
        base = cur;
      }
      const value = c.valueType === 'float' || c.valueType === 'double' ? base * factor : Math.trunc(base * factor);
      if (value !== cur && !this.proc.writeValue(addr, c.valueType, value)) { s.error = 'Écriture impossible'; continue; }
      entries.set(key, { addr, valueType: c.valueType, base, written: this.proc.readValue(addr, c.valueType), changed: null });
      s.base ??= base;
    }
  }

  // On ne remet la base que si la valeur est toujours celle qu'on a écrite
  restoreEntry(m) {
    if (this.proc && this.proc.readValue(m.addr, m.valueType) === m.written) this.proc.writeValue(m.addr, m.valueType, m.base);
  }

  restoreMultiplier(id) {
    const entries = this.multiplied.get(id);
    if (entries) for (const m of entries.values()) this.restoreEntry(m);
    this.multiplied.delete(id);
    const s = this.state.get(id);
    if (s) s.base = null;
  }

  freezeTick() {
    if (!this.proc) return;
    if (!this.proc.isAlive()) return this.detach('Le jeu a été fermé.');
    for (const c of this.trainer.cheats) {
      const s = this.state.get(c.id);
      if (s?.enabled && (c.kind === 'freeze' || (c.kind === 'slider' && c.freeze))) this.writeCheat(c, s);
      if (s?.enabled && c.kind === 'multiplier') this.applyMultiplier(c, s);
      if (s?.enabled && c.kind === 'patch' && !this.patches.has(c.id)) this.applyPatch(c, s);
    }
  }

  readTick() {
    if (!this.proc) return;
    for (const c of this.trainer.cheats) {
      if (c.kind === 'patch' || !c.valueType) continue;
      const s = this.state.get(c.id);
      try {
        const addr = this.proc.peek(c.target);
        s.current = addr === null ? null : this.proc.readValue(addr, c.valueType);
      } catch {
        s.current = null;
      }
    }
    this.emitState();
  }

  snapshot() {
    return {
      gameId: this.gameId,
      attached: !!this.proc,
      pid: this.proc?.pid ?? null,
      exe: this.proc?.exeName ?? null,
      is32: this.proc?.is32 ?? null,
      error: this.error,
      cheats: Object.fromEntries(this.state),
    };
  }

  emitState() {
    this.emit('state', this.snapshot());
  }
}

module.exports = { TrainerSession, parseHex, toHex };
