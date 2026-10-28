// Accès à un processus : énumération, lecture/écriture typée, modules, régions mémoire, AOB.
const path = require('node:path');
const { api, C, wstr, PROCESSENTRY32W_SIZE, MODULEENTRY32W_SIZE, MBI_SIZE } = require('./win32.cjs');

const TYPES = {
  byte: { size: 1, read: (b, o) => b.readUInt8(o), write: (b, o, v) => b.writeUInt8(Math.trunc(v) & 0xff, o) },
  int16: { size: 2, read: (b, o) => b.readInt16LE(o), write: (b, o, v) => b.writeInt16LE(Math.trunc(v), o) },
  int32: { size: 4, read: (b, o) => b.readInt32LE(o), write: (b, o, v) => b.writeInt32LE(Math.trunc(v) | 0, o) },
  int64: { size: 8, read: (b, o) => Number(b.readBigInt64LE(o)), write: (b, o, v) => b.writeBigInt64LE(BigInt(Math.trunc(v)), o) },
  float: { size: 4, read: (b, o) => b.readFloatLE(o), write: (b, o, v) => b.writeFloatLE(v, o) },
  double: { size: 8, read: (b, o) => b.readDoubleLE(o), write: (b, o, v) => b.writeDoubleLE(v, o) },
};

function parseHex(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  let s = String(value).trim().replace(/\s+/g, '');
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^0x/i.test(s)) s = '0x' + s;
  const n = BigInt(s);
  return neg ? -n : n;
}

const toHex = (n) => '0x' + BigInt(n).toString(16).toUpperCase();

function listProcesses() {
  const snap = api.CreateToolhelp32Snapshot(C.TH32CS_SNAPPROCESS, 0);
  if (snap === C.INVALID_HANDLE_VALUE) return [];
  const entry = Buffer.alloc(PROCESSENTRY32W_SIZE);
  entry.writeUInt32LE(PROCESSENTRY32W_SIZE, 0);
  const out = [];
  try {
    let ok = api.Process32FirstW(snap, entry);
    while (ok) {
      out.push({
        pid: entry.readUInt32LE(8),
        parentPid: entry.readUInt32LE(32),
        name: wstr(entry, 44, 520),
      });
      ok = api.Process32NextW(snap, entry);
    }
  } finally {
    api.CloseHandle(snap);
  }
  return out;
}

function getProcessPath(pid) {
  const h = api.OpenProcess(C.PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!h) return null;
  try {
    const buf = Buffer.alloc(2048);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(1024, 0);
    if (!api.QueryFullProcessImageNameW(h, 0, buf, size)) return null;
    return buf.toString('utf16le', 0, size.readUInt32LE(0) * 2);
  } finally {
    api.CloseHandle(h);
  }
}

function parseAob(pattern) {
  return String(pattern).trim().split(/\s+/).map((t) => (/^\?{1,2}$/.test(t) ? -1 : parseInt(t, 16)));
}

class GameProcess {
  static open(pid) {
    const access = C.PROCESS_VM_READ | C.PROCESS_VM_WRITE | C.PROCESS_VM_OPERATION | C.PROCESS_QUERY_INFORMATION;
    const handle = api.OpenProcess(access, 0, pid);
    if (!handle) {
      const err = api.GetLastError();
      throw new Error(err === 5
        ? "Accès refusé au processus (le jeu tourne peut-être en administrateur : relancez Pimplay en administrateur)."
        : `Impossible d'ouvrir le processus ${pid} (erreur ${err}).`);
    }
    return new GameProcess(pid, handle);
  }

  constructor(pid, handle) {
    this.pid = pid;
    this.handle = handle;
    const wow = Buffer.alloc(4);
    api.IsWow64Process(handle, wow);
    this.is32 = wow.readInt32LE(0) !== 0;
    this.ptrSize = this.is32 ? 4 : 8;
    this.exePath = getProcessPath(pid);
    this.exeName = this.exePath ? path.basename(this.exePath) : `pid ${pid}`;
    this._modules = null;
    this._aobCache = new Map();
  }

  isAlive() {
    if (!this.handle) return false;
    const code = Buffer.alloc(4);
    if (!api.GetExitCodeProcess(this.handle, code)) return false;
    return code.readUInt32LE(0) === C.STILL_ACTIVE;
  }

  close() {
    if (this.handle) api.CloseHandle(this.handle);
    this.handle = 0;
  }

  read(addr, size) {
    const buf = Buffer.allocUnsafe(size);
    return api.ReadProcessMemory(this.handle, BigInt(addr), buf, size, null) ? buf : null;
  }

  write(addr, buf) {
    return !!api.WriteProcessMemory(this.handle, BigInt(addr), buf, buf.length, null);
  }

  // Écriture dans une page protégée (code) : on ouvre temporairement les droits.
  writeProtected(addr, buf) {
    const old = Buffer.alloc(4);
    const a = BigInt(addr);
    if (!api.VirtualProtectEx(this.handle, a, buf.length, C.PAGE_EXECUTE_READWRITE, old)) return this.write(a, buf);
    const ok = this.write(a, buf);
    api.VirtualProtectEx(this.handle, a, buf.length, old.readUInt32LE(0), Buffer.alloc(4));
    return ok;
  }

  readValue(addr, type) {
    const t = TYPES[type];
    const buf = this.read(addr, t.size);
    return buf ? t.read(buf, 0) : null;
  }

  writeValue(addr, type, value) {
    const t = TYPES[type];
    const buf = Buffer.alloc(t.size);
    t.write(buf, 0, Number(value));
    return this.write(addr, buf);
  }

  readPointer(addr) {
    const buf = this.read(addr, this.ptrSize);
    if (!buf) return null;
    return this.is32 ? BigInt(buf.readUInt32LE(0)) : buf.readBigUInt64LE(0);
  }

  modules(refresh = false) {
    if (this._modules && !refresh) return this._modules;
    const snap = api.CreateToolhelp32Snapshot(C.TH32CS_SNAPMODULE | C.TH32CS_SNAPMODULE32, this.pid);
    const mods = [];
    if (snap !== C.INVALID_HANDLE_VALUE) {
      const entry = Buffer.alloc(MODULEENTRY32W_SIZE);
      entry.writeUInt32LE(MODULEENTRY32W_SIZE, 0);
      try {
        let ok = api.Module32FirstW(snap, entry);
        while (ok) {
          mods.push({
            name: wstr(entry, 48, 512),
            base: entry.readBigUInt64LE(24),
            size: entry.readUInt32LE(32),
            path: wstr(entry, 560, 520),
          });
          ok = api.Module32NextW(snap, entry);
        }
      } finally {
        api.CloseHandle(snap);
      }
    }
    this._modules = mods;
    return mods;
  }

  findModule(name) {
    const lower = String(name).toLowerCase();
    const find = () => this.modules().find((m) => m.name.toLowerCase() === lower);
    return find() || (this.modules(true), find());
  }

  *regions({ writable = true, min = 0n, max = this.is32 ? 0x7fffffffn : 0x7fffffffffffn } = {}) {
    const mbi = Buffer.alloc(MBI_SIZE);
    let addr = min;
    while (addr < max) {
      if (!Number(api.VirtualQueryEx(this.handle, addr, mbi, MBI_SIZE))) break;
      const base = mbi.readBigUInt64LE(0);
      const size = mbi.readBigUInt64LE(24);
      const state = mbi.readUInt32LE(32);
      const protect = mbi.readUInt32LE(36);
      const type = mbi.readUInt32LE(40);
      if (size === 0n) break;
      const readable = state === C.MEM_COMMIT && !(protect & C.PAGE_GUARD) && !(protect & C.PAGE_NOACCESS) && protect !== 0;
      const isWritable = (protect & (C.PAGE_READWRITE | C.PAGE_WRITECOPY | C.PAGE_EXECUTE_READWRITE | C.PAGE_EXECUTE_WRITECOPY)) !== 0;
      if (readable && (!writable || (isWritable && type !== C.MEM_MAPPED))) {
        yield { base, size, protect, type };
      }
      addr = base + size;
    }
  }

  aobScan(pattern, moduleName) {
    const key = `${moduleName || '*'}|${pattern}`;
    if (this._aobCache.has(key)) return this._aobCache.get(key);
    const found = this.aobFindAll(pattern, moduleName, 1)[0] ?? null;
    this._aobCache.set(key, found);
    return found;
  }

  // Toutes les occurrences d'une signature (jusqu'à `limit`), dans un module ou toute la mémoire lisible
  aobFindAll(pattern, moduleName, limit = 2) {
    const bytes = parseAob(pattern);
    const anchor = bytes.findIndex((b) => b !== -1);
    if (anchor === -1) throw new Error('Signature AOB invalide.');
    let range = {};
    if (moduleName) {
      const mod = this.findModule(moduleName);
      if (!mod) throw new Error(`Module introuvable : ${moduleName}`);
      range = { min: mod.base, max: mod.base + BigInt(mod.size) };
    }
    const found = [];
    outer: for (const r of this.regions({ writable: false, ...range })) {
      const buf = this.read(r.base, Number(r.size));
      if (!buf) continue;
      let pos = buf.indexOf(bytes[anchor], anchor);
      while (pos !== -1) {
        const start = pos - anchor;
        if (start + bytes.length <= buf.length) {
          let ok = true;
          for (let i = 0; i < bytes.length; i++) {
            if (bytes[i] !== -1 && buf[start + i] !== bytes[i]) { ok = false; break; }
          }
          if (ok) {
            found.push(r.base + BigInt(start));
            if (found.length >= limit) break outer;
          }
        }
        pos = buf.indexOf(bytes[anchor], pos + 1);
      }
    }
    return found;
  }

  // Résout une cible de mod : adresse absolue, module+offset (+ chaîne de pointeurs) ou signature AOB.
  resolve(target) {
    if (!target) return null;
    let addr;
    if (target.aob) {
      addr = this.aobScan(target.aob, target.module);
      if (addr === null) return null;
      addr += parseHex(target.aobOffset || 0);
    } else if (target.module) {
      const mod = this.findModule(target.module);
      if (!mod) return null;
      addr = mod.base + parseHex(target.offset || 0);
    } else if (target.address) {
      addr = parseHex(target.address);
    } else {
      return null;
    }
    for (const off of target.pointers || []) {
      const p = this.readPointer(addr);
      if (!p) return null;
      addr = p + parseHex(off);
    }
    return addr;
  }
}

module.exports = { GameProcess, listProcesses, getProcessPath, TYPES, parseHex, toHex, parseAob };
