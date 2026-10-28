// Réduit les fenêtres visibles d'un ou plusieurs processus (fenêtres des launchers Steam / Epic).
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const FindWindowExW = user32.func('intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, void *cls, void *title)');
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hwnd, void *pid)');
const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(intptr_t hwnd)');
const IsIconic = user32.func('int __stdcall IsIconic(intptr_t hwnd)');
const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(intptr_t hwnd)');
const ShowWindow = user32.func('int __stdcall ShowWindow(intptr_t hwnd, int cmd)');
const PostMessageW = user32.func('int __stdcall PostMessageW(intptr_t hwnd, uint32_t msg, uintptr_t wparam, intptr_t lparam)');

const SW_SHOWMINNOACTIVE = 7; // réduit sans voler le focus au jeu
const WM_CLOSE = 0x0010;

// Fenêtres de premier niveau visibles et titrées (pas les fenêtres techniques cachées) des processus donnés
function visibleWindowsOf(pids) {
  const wanted = new Set(pids);
  const out = [];
  if (!wanted.size) return out;
  const pid = Buffer.alloc(4);
  let hwnd = 0;
  while ((hwnd = FindWindowExW(0, hwnd, null, null))) {
    GetWindowThreadProcessId(hwnd, pid);
    if (wanted.has(pid.readUInt32LE(0)) && IsWindowVisible(hwnd) && GetWindowTextLengthW(hwnd)) out.push(hwnd);
  }
  return out;
}

// Renvoie le nombre de fenêtres réduites
function minimizeWindowsOf(pids) {
  const list = visibleWindowsOf(pids).filter((h) => !IsIconic(h));
  for (const h of list) ShowWindow(h, SW_SHOWMINNOACTIVE);
  return list.length;
}

// Demande la fermeture comme un clic sur la croix (le jeu peut sauvegarder / confirmer) ; renvoie le nombre de fenêtres
function closeWindowsOf(pids) {
  const list = visibleWindowsOf(pids);
  for (const h of list) PostMessageW(h, WM_CLOSE, 0, 0);
  return list.length;
}

// Arrêt forcé (TerminateProcess) ; renvoie le nombre de processus arrêtés
function killProcesses(pids) {
  let n = 0;
  for (const pid of pids) {
    try { process.kill(pid); n++; } catch {}
  }
  return n;
}

module.exports = { minimizeWindowsOf, closeWindowsOf, killProcesses };
