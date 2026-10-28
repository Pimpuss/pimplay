// Scanner de valeurs : premier scan (valeur exacte) puis affinages successifs.
const { TYPES, toHex } = require('./process.cjs');

const MAX_RESULTS = 5_000_000;
const CHUNK = 16 * 1024 * 1024;
const BATCH_SPAN = 0x10000;

const tick = () => new Promise((r) => setImmediate(r));

function decimalsOf(input) {
  const m = String(input).match(/[.,](\d+)/);
  return m ? m[1].length : 0;
}

function makeMatcher(type, input) {
  const target = Number(String(input).replace(',', '.'));
  if (Number.isNaN(target)) throw new Error('Valeur invalide.');
  if (type === 'float' || type === 'double') {
    // Comparaison « arrondie » : 100 trouve 99.5..100.49, 12.5 trouve 12.45..12.549
    const f = 10 ** decimalsOf(input);
    return (v) => Math.round(v * f) / f === target;
  }
  return (v) => v === target;
}

class Scanner {
  constructor(proc) {
    this.proc = proc;
    this.reset();
  }

  reset() {
    this.type = null;
    this.addrs = [];
    this.values = [];
    this.scanCount = 0;
    this.cancelled = false;
  }

  cancel() { this.cancelled = true; }

  get count() { return this.addrs.length; }

  async firstScan({ type, value }, onProgress) {
    const t = TYPES[type];
    if (!t) throw new Error(`Type inconnu : ${type}`);
    const match = makeMatcher(type, value);
    this.reset();
    this.type = type;
    const align = Math.min(t.size, 4);
    const regions = [...this.proc.regions({ writable: true })];
    const total = regions.reduce((s, r) => s + Number(r.size), 0) || 1;
    let done = 0;
    let truncated = false;

    for (const r of regions) {
      const size = Number(r.size);
      for (let off = 0; off < size; off += CHUNK) {
        if (this.cancelled) return this.summary(truncated);
        const len = Math.min(CHUNK, size - off);
        const base = r.base + BigInt(off);
        const buf = this.proc.read(base, len);
        if (buf) {
          const baseNum = Number(base);
          const end = len - t.size;
          for (let i = 0; i <= end; i += align) {
            const v = t.read(buf, i);
            if (match(v)) {
              if (this.addrs.length >= MAX_RESULTS) { truncated = true; break; }
              this.addrs.push(baseNum + i);
              this.values.push(v);
            }
          }
        }
        done += len;
        onProgress?.(done / total);
        await tick();
      }
      if (truncated) break;
    }
    this.scanCount = 1;
    return this.summary(truncated);
  }

  async nextScan({ mode, value }, onProgress) {
    if (!this.type) throw new Error("Faites d'abord un premier scan.");
    const t = TYPES[this.type];
    const match = mode === 'exact' ? makeMatcher(this.type, value) : null;
    const keep = {
      exact: (v) => match(v),
      increased: (v, old) => v > old,
      decreased: (v, old) => v < old,
      changed: (v, old) => v !== old,
      unchanged: (v, old) => v === old,
    }[mode];
    if (!keep) throw new Error(`Mode inconnu : ${mode}`);

    const nextAddrs = [];
    const nextValues = [];
    const n = this.addrs.length;
    let i = 0;
    let batches = 0;
    while (i < n) {
      if (this.cancelled) break;
      // Lecture groupée des adresses proches pour limiter les appels système
      const start = this.addrs[i];
      let j = i;
      while (j + 1 < n && this.addrs[j + 1] + t.size - start <= BATCH_SPAN) j++;
      const span = this.addrs[j] + t.size - start;
      const buf = this.proc.read(BigInt(start), span);
      for (let k = i; k <= j; k++) {
        let v;
        if (buf) v = t.read(buf, this.addrs[k] - start);
        else v = this.proc.readValue(BigInt(this.addrs[k]), this.type);
        if (v !== null && v !== undefined && keep(v, this.values[k])) {
          nextAddrs.push(this.addrs[k]);
          nextValues.push(v);
        }
      }
      i = j + 1;
      if (++batches % 64 === 0) {
        onProgress?.(i / n);
        await tick();
      }
    }
    this.addrs = nextAddrs;
    this.values = nextValues;
    this.scanCount++;
    onProgress?.(1);
    return this.summary(false);
  }

  summary(truncated) {
    return { count: this.addrs.length, scanCount: this.scanCount, type: this.type, truncated, cancelled: this.cancelled };
  }

  // Écrit la même valeur dans tous les résultats (plafonné pour éviter de corrompre le jeu)
  writeAll(value, max = 1000) {
    if (this.addrs.length > max) throw new Error(`Trop de résultats (${this.addrs.length}) : affinez d'abord la recherche (max ${max}).`);
    let ok = 0;
    for (const a of this.addrs) if (this.proc.writeValue(BigInt(a), this.type, value)) ok++;
    return ok;
  }

  // Valeurs actuelles des premiers résultats (pour l'affichage)
  results(offset = 0, limit = 200) {
    const out = [];
    const end = Math.min(this.addrs.length, offset + limit);
    for (let k = offset; k < end; k++) {
      const addr = BigInt(this.addrs[k]);
      out.push({ address: toHex(addr), value: this.proc.readValue(addr, this.type), previous: this.values[k] });
    }
    return out;
  }
}

module.exports = { Scanner };
