// « Qu'est-ce qui écrit à cette adresse ? » : pilote le thread débogueur, décode les
// instructions trouvées et fabrique un patch NOP avec une signature AOB unique.
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { EventEmitter } = require('node:events');
const iced = require('iced-x86');
const { toHex } = require('./process.cjs');

const formatter = new iced.Formatter(iced.FormatterSyntax.Intel);
const BRANCHES = new Set([iced.FlowControl.UnconditionalBranch, iced.FlowControl.ConditionalBranch, iced.FlowControl.Call]);

// Décode les instructions de `bytes` (adresse `ip`) ; chaque entrée garde ses octets et les zones variables
function decodeAll(bytes, ip, max = Infinity) {
  const d = new iced.Decoder(64, new Uint8Array(bytes), iced.DecoderOptions.None);
  d.ip = ip;
  const out = [];
  while (d.canDecode && out.length < max) {
    const ins = d.decode();
    const invalid = ins.code === iced.Code.INVALID;
    const start = Number(ins.ip - ip);
    const item = { ip: ins.ip, length: ins.length, invalid, text: invalid ? '(invalide)' : formatter.format(ins), wild: [] };
    if (!invalid) {
      // Octets qui changent d'une version du jeu à l'autre : déplacements RIP-relatifs et cibles de saut
      const c = d.getConstantOffsets(ins);
      if (ins.isIpRelMemoryOperand && c.displacementSize) item.wild.push([c.displacementOffset, c.displacementSize]);
      if (BRANCHES.has(ins.flowControl) && c.immediateSize) item.wild.push([c.immediateOffset, c.immediateSize]);
      c.free();
    }
    item.bytes = [...bytes.subarray(start, start + ins.length)];
    ins.free();
    out.push(item);
  }
  d.free();
  return out;
}

// Les points d'arrêt matériels se déclenchent APRÈS l'instruction : on retrouve son début en
// décodant depuis plusieurs points en amont (le x86 se resynchronise vite) et en votant.
function instructionBefore(proc, rip) {
  let back = 64n;
  let buf = proc.read(rip - back, Number(back));
  if (!buf) {
    // La page précédente peut être illisible : on se limite au début de la page courante
    back = rip - (rip & ~0xfffn);
    buf = back ? proc.read(rip - back, Number(back)) : null;
  }
  if (!buf) return null;
  const votes = new Map();
  for (let s = 0; s < Math.min(24, Number(back)); s++) {
    let last = null;
    for (const ins of decodeAll(buf.subarray(s), rip - back + BigInt(s))) {
      if (ins.invalid) break;
      if (ins.ip + BigInt(ins.length) === rip) { last = ins; break; }
      if (ins.ip + BigInt(ins.length) > rip) break;
    }
    if (last) {
      const key = last.ip.toString();
      const v = votes.get(key) || { ins: last, n: 0 };
      v.n += 1 + (last.text.includes('[') ? 0.5 : 0);
      votes.set(key, v);
    }
  }
  const best = [...votes.values()].sort((a, b) => b.n - a.n)[0];
  return best?.ins || null;
}

const sigOf = (instrs) => instrs.flatMap((ins) => ins.bytes.map((b, i) =>
  ins.wild.some(([o, n]) => i >= o && i < o + n) ? '??' : b.toString(16).toUpperCase().padStart(2, '0'))).join(' ');

class WriteWatcher extends EventEmitter {
  constructor(proc) {
    super();
    this.proc = proc;
    this.hits = new Map();
    this.state = 'idle';
    this.error = null;
    this.worker = null;
  }

  start(addresses, size) {
    if (this.proc.is32) throw new Error('La recherche d\'instructions ne gère pas encore les jeux 32 bits.');
    if (!addresses.length || addresses.length > 4) throw new Error('Sélectionnez entre 1 et 4 adresses (4 registres matériels).');
    this.targets = addresses.map((a) => {
      const address = BigInt(a);
      // Un point d'arrêt de N octets doit être aligné sur N
      const len = [8, 4, 2, 1].find((n) => n <= size && address % BigInt(n) === 0n);
      return { address: address.toString(), size: len, label: toHex(address) };
    });
    this.flags = new Int32Array(new SharedArrayBuffer(8));
    this.state = 'starting';
    this.worker = new Worker(path.join(__dirname, 'debugger-worker.cjs'), {
      workerData: { pid: this.proc.pid, targets: this.targets.map(({ address, size: s }) => ({ address, size: s })), flags: this.flags },
    });
    this.worker.on('message', (m) => this.onMessage(m));
    this.worker.on('error', (e) => { this.state = 'error'; this.error = e.message; this.emitUpdate(); });
    this.worker.on('exit', () => { if (this.state === 'running' || this.state === 'starting') this.state = 'stopped'; this.emitUpdate(); });
  }

  onMessage(m) {
    if (m.type === 'started') this.state = 'running';
    else if (m.type === 'error') { this.state = 'error'; this.error = m.message; }
    else if (m.type === 'exited') { this.state = 'stopped'; this.error = 'Le jeu a été fermé.'; }
    else if (m.type === 'stopped' && this.state !== 'error') this.state = 'stopped';
    else if (m.type === 'hits') this.merge(m.hits);
    this.emitUpdate();
  }

  merge(hits) {
    for (const h of hits) {
      let e = this.hits.get(h.rip);
      if (!e) {
        const rip = BigInt(h.rip);
        const ins = instructionBefore(this.proc, rip);
        const addr = ins ? ins.ip : rip;
        const mod = this.proc.modules().find((x) => addr >= x.base && addr < x.base + BigInt(x.size));
        const after = this.proc.read(addr, 48);
        const next = after ? decodeAll(after, addr, 5) : [];
        e = {
          id: h.rip,
          address: toHex(addr),
          module: mod ? { name: mod.name, offset: toHex(addr - mod.base) } : null,
          text: ins?.text || '(instruction introuvable)',
          length: ins?.length || 0,
          bytes: ins ? ins.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ') : '',
          next: next.slice(1).map((x) => x.text),
          regs: h.regs,
          count: 0,
          targets: new Set(),
        };
        this.hits.set(h.rip, e);
      }
      e.count += h.count;
      h.targets.forEach((t) => e.targets.add(t));
    }
  }

  // Patch NOP + signature AOB la plus courte possible qui reste unique dans le module
  makePatch(id) {
    const e = this.hits.get(id);
    if (!e || !e.length) throw new Error('Instruction inconnue.');
    const addr = BigInt(e.address);
    const bytes = this.proc.read(addr, 96);
    if (!bytes) throw new Error('Lecture du code impossible.');
    const instrs = decodeAll(bytes, addr, 16).filter((x) => !x.invalid);
    let sig = null;
    let unique = false;
    for (let n = 1; n <= instrs.length; n++) {
      const part = instrs.slice(0, n);
      if (part.reduce((s, x) => s + x.length, 0) < 6 && n < instrs.length) continue;
      sig = sigOf(part);
      const found = e.module ? this.proc.aobFindAll(sig, e.module.name, 2) : [];
      if (found.length === 1 && found[0] === addr) { unique = true; break; }
      if (part.reduce((s, x) => s + x.length, 0) >= 64) break;
    }
    return {
      name: `Bloquer « ${e.text} »`,
      module: e.module?.name || null,
      offset: e.module?.offset || e.address,
      aob: sig,
      unique,
      patch: Array(e.length).fill('90').join(' '),
      text: e.text,
    };
  }

  list() {
    return [...this.hits.values()]
      .sort((a, b) => b.count - a.count)
      .map((e) => ({ ...e, targets: [...e.targets] }));
  }

  snapshot() {
    return { state: this.state, error: this.error, targets: this.targets?.map((t) => t.label) || [], hits: this.list() };
  }

  emitUpdate() {
    this.emit('update', this.snapshot());
  }

  stop() {
    if (!this.worker) return Promise.resolve();
    Atomics.store(this.flags, 0, 1);
    return new Promise((resolve) => {
      if (Atomics.load(this.flags, 1) === 1) return resolve();
      this.worker.once('exit', resolve);
      setTimeout(resolve, 5000);
    });
  }

  // À la fermeture de l'app : attend (bloquant) que les points d'arrêt soient retirés
  stopSync() {
    if (!this.worker) return;
    Atomics.store(this.flags, 0, 1);
    Atomics.wait(this.flags, 1, 0, 3000);
  }
}

module.exports = { WriteWatcher, instructionBefore, decodeAll };
