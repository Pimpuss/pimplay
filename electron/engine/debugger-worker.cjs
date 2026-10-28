// Thread débogueur : s'attache au jeu, pose des points d'arrêt matériels en écriture (DR0..DR3)
// et remonte l'adresse des instructions qui écrivent. Les API de débogage Windows exigent que
// tout se passe dans le même thread, d'où ce worker à boucle bloquante.
const { parentPort, workerData } = require('node:worker_threads');
const koffi = require('koffi');

const k32 = koffi.load('kernel32.dll');
const api = {
  DebugActiveProcess: k32.func('int __stdcall DebugActiveProcess(uint32_t pid)'),
  DebugActiveProcessStop: k32.func('int __stdcall DebugActiveProcessStop(uint32_t pid)'),
  DebugSetProcessKillOnExit: k32.func('int __stdcall DebugSetProcessKillOnExit(int kill)'),
  WaitForDebugEvent: k32.func('int __stdcall WaitForDebugEvent(void *ev, uint32_t ms)'),
  ContinueDebugEvent: k32.func('int __stdcall ContinueDebugEvent(uint32_t pid, uint32_t tid, uint32_t status)'),
  GetThreadContext: k32.func('int __stdcall GetThreadContext(intptr_t h, void *ctx)'),
  SetThreadContext: k32.func('int __stdcall SetThreadContext(intptr_t h, void *ctx)'),
  SuspendThread: k32.func('uint32_t __stdcall SuspendThread(intptr_t h)'),
  ResumeThread: k32.func('uint32_t __stdcall ResumeThread(intptr_t h)'),
  CloseHandle: k32.func('int __stdcall CloseHandle(intptr_t h)'),
  GetLastError: k32.func('uint32_t __stdcall GetLastError()'),
  RtlMoveMemory: k32.func('void __stdcall RtlMoveMemory(void *dst, void *src, size_t n)'),
};

const DBG_CONTINUE = 0x00010002;
const DBG_EXCEPTION_NOT_HANDLED = 0x80010001;
const EXCEPTION_BREAKPOINT = 0x80000003;
const EXCEPTION_SINGLE_STEP = 0x80000004;
const STATUS_WX86_BREAKPOINT = 0x4000001f;

// CONTEXT x64 : 1232 octets, aligné sur 16 octets, d'où une copie via mémoire native alignée
const CTX_SIZE = 1232;
const CTX_FLAGS = 0x100013; // CONTEXT_AMD64 | CONTROL | INTEGER | DEBUG_REGISTERS
const OFF = { flags: 0x30, dr0: 0x48, dr6: 0x68, dr7: 0x70, rax: 0x78, rip: 0xf8 };
const REGS = ['rax', 'rcx', 'rdx', 'rbx', 'rsp', 'rbp', 'rsi', 'rdi', 'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15'];
const LEN_BITS = { 1: 0b00, 2: 0b01, 8: 0b10, 4: 0b11 };

const { pid, targets, flags } = workerData; // flags : Int32Array partagé [stop, terminé]
const rawPtr = koffi.alloc('uint8_t', CTX_SIZE + 16);
const ctxPtr = (BigInt(rawPtr) + 15n) & ~15n;
const ctx = Buffer.alloc(CTX_SIZE);
const ev = Buffer.alloc(176); // DEBUG_EVENT x64

function getCtx(h) {
  ctx.fill(0);
  ctx.writeUInt32LE(CTX_FLAGS, OFF.flags);
  api.RtlMoveMemory(ctxPtr, ctx, CTX_SIZE);
  const ok = api.GetThreadContext(h, ctxPtr);
  api.RtlMoveMemory(ctx, ctxPtr, CTX_SIZE);
  return ok;
}

function setCtx(h) {
  api.RtlMoveMemory(ctxPtr, ctx, CTX_SIZE);
  return api.SetThreadContext(h, ctxPtr);
}

let dr7 = 0n;
targets.forEach((t, i) => {
  dr7 |= 1n << BigInt(i * 2); // activation locale Li
  dr7 |= 0b01n << BigInt(16 + i * 4); // RW = écriture
  dr7 |= BigInt(LEN_BITS[t.size]) << BigInt(18 + i * 4);
});

function applyDr(h, enable) {
  if (!getCtx(h)) return false;
  for (let i = 0; i < 4; i++) {
    ctx.writeBigUInt64LE(enable && targets[i] ? BigInt(targets[i].address) : 0n, OFF.dr0 + i * 8);
  }
  ctx.writeBigUInt64LE(0n, OFF.dr6);
  ctx.writeBigUInt64LE(enable ? dr7 : 0n, OFF.dr7);
  return setCtx(h);
}

const threads = new Map(); // tid -> handle (fournis par les événements de débogage)
const hits = new Map(); // rip -> { rip, count, targets:Set, regs }
let lastFlush = Date.now();
let initialBreakpoint = false;
let exited = false;

// Sécurité : chaque déclenchement fige tout le jeu un instant. Trop d'écritures par seconde
// (synchronisation à chaque image…) peuvent le faire décrocher : on coupe avant.
const MAX_HITS_PER_SEC = 300;
let rateStart = Date.now();
let rateCount = 0;
let tooFast = false;
function countHit() {
  const now = Date.now();
  if (now - rateStart > 1000) { rateStart = now; rateCount = 0; }
  if (++rateCount > MAX_HITS_PER_SEC) tooFast = true;
}

function flush(force) {
  if (!hits.size || (!force && Date.now() - lastFlush < 250)) return;
  parentPort.postMessage({
    type: 'hits',
    hits: [...hits.values()].map((h) => ({ ...h, targets: [...h.targets] })),
  });
  hits.clear();
  lastFlush = Date.now();
}

// Traite un événement ; renvoie le statut à passer à ContinueDebugEvent
function handle(draining) {
  const code = ev.readUInt32LE(0);
  const tid = ev.readUInt32LE(8);
  switch (code) {
    case 3: { // CREATE_PROCESS_DEBUG_EVENT
      const hFile = Number(ev.readBigInt64LE(16));
      if (hFile) api.CloseHandle(hFile);
      const hThread = Number(ev.readBigInt64LE(32));
      threads.set(tid, hThread);
      if (!draining) applyDr(hThread, true);
      return DBG_CONTINUE;
    }
    case 2: { // CREATE_THREAD_DEBUG_EVENT
      const hThread = Number(ev.readBigInt64LE(16));
      threads.set(tid, hThread);
      if (!draining) applyDr(hThread, true);
      return DBG_CONTINUE;
    }
    case 4: // EXIT_THREAD
      threads.delete(tid);
      return DBG_CONTINUE;
    case 5: // EXIT_PROCESS
      exited = true;
      return DBG_CONTINUE;
    case 6: { // LOAD_DLL
      const hFile = Number(ev.readBigInt64LE(16));
      if (hFile) api.CloseHandle(hFile);
      return DBG_CONTINUE;
    }
    case 1: { // EXCEPTION_DEBUG_EVENT
      const exc = ev.readUInt32LE(16);
      if (exc === EXCEPTION_SINGLE_STEP) {
        const h = threads.get(tid);
        if (!h || !getCtx(h)) return DBG_EXCEPTION_NOT_HANDLED;
        const dr6 = ctx.readBigUInt64LE(OFF.dr6);
        const which = [0, 1, 2, 3].filter((i) => targets[i] && (dr6 & (1n << BigInt(i))));
        if (!which.length) return DBG_EXCEPTION_NOT_HANDLED;
        if (!draining) {
          const rip = ctx.readBigUInt64LE(OFF.rip).toString();
          let hit = hits.get(rip);
          if (!hit) {
            const regs = {};
            REGS.forEach((r, i) => { regs[r] = '0x' + ctx.readBigUInt64LE(OFF.rax + i * 8).toString(16).toUpperCase(); });
            hit = { rip, count: 0, targets: new Set(), regs };
            hits.set(rip, hit);
          }
          hit.count++;
          which.forEach((i) => hit.targets.add(i));
          countHit();
        }
        ctx.writeBigUInt64LE(0n, OFF.dr6);
        setCtx(h);
        return DBG_CONTINUE;
      }
      if ((exc === EXCEPTION_BREAKPOINT || exc === STATUS_WX86_BREAKPOINT) && !initialBreakpoint) {
        initialBreakpoint = true; // point d'arrêt injecté par Windows à l'attachement
        return DBG_CONTINUE;
      }
      return DBG_EXCEPTION_NOT_HANDLED; // exception propre au jeu : on la lui rend
    }
    default:
      return DBG_CONTINUE;
  }
}

function run() {
  if (!api.DebugActiveProcess(pid)) {
    const err = api.GetLastError();
    parentPort.postMessage({
      type: 'error',
      message: err === 5
        ? "Impossible de déboguer le jeu : accès refusé, ou un autre débogueur (Cheat Engine…) est déjà attaché."
        : `Impossible de déboguer le jeu (erreur ${err}).`,
    });
    return;
  }
  api.DebugSetProcessKillOnExit(0); // si Pimplay se ferme, le jeu continue
  parentPort.postMessage({ type: 'started' });

  while (Atomics.load(flags, 0) === 0 && !exited && !tooFast) {
    if (api.WaitForDebugEvent(ev, 100)) {
      const status = handle(false);
      api.ContinueDebugEvent(ev.readUInt32LE(4), ev.readUInt32LE(8), status);
    }
    flush(false);
  }
  flush(true);
  if (tooFast) {
    parentPort.postMessage({
      type: 'error',
      message: `Surveillance coupée : plus de ${MAX_HITS_PER_SEC} écritures par seconde, le jeu risquait de décrocher. Surveillez une seule adresse à la fois (🐞 sur la ligne) en évitant celle qui change sans cesse.`,
    });
  }
  if (exited) {
    parentPort.postMessage({ type: 'exited' });
    return;
  }

  // Nettoyage : retirer les points d'arrêt de tous les threads avant de se détacher,
  // sinon la prochaine écriture déclencherait une exception sans débogueur (plantage du jeu).
  for (const h of threads.values()) {
    api.SuspendThread(h);
    applyDr(h, false);
    api.ResumeThread(h);
  }
  while (api.WaitForDebugEvent(ev, 50)) {
    const status = handle(true);
    api.ContinueDebugEvent(ev.readUInt32LE(4), ev.readUInt32LE(8), status);
  }
  api.DebugActiveProcessStop(pid);
}

try {
  run();
} catch (e) {
  parentPort.postMessage({ type: 'error', message: e.message });
  try { api.DebugActiveProcessStop(pid); } catch {}
} finally {
  koffi.free(rawPtr);
  Atomics.store(flags, 1, 1);
  Atomics.notify(flags, 1);
  parentPort.postMessage({ type: 'stopped' });
}
