// Bindings Win32 minimales (kernel32) pour lire/écrire la mémoire d'un autre processus.
const koffi = require('koffi');

const k32 = koffi.load('kernel32.dll');

// BOOL = int, HANDLE = intptr_t (évite les objets pointeur et permet de comparer à -1/0)
const api = {
  OpenProcess: k32.func('intptr_t __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),
  CloseHandle: k32.func('int __stdcall CloseHandle(intptr_t h)'),
  ReadProcessMemory: k32.func('int __stdcall ReadProcessMemory(intptr_t h, uintptr_t addr, void *buf, size_t size, void *read)'),
  WriteProcessMemory: k32.func('int __stdcall WriteProcessMemory(intptr_t h, uintptr_t addr, void *buf, size_t size, void *written)'),
  VirtualQueryEx: k32.func('size_t __stdcall VirtualQueryEx(intptr_t h, uintptr_t addr, void *mbi, size_t len)'),
  VirtualProtectEx: k32.func('int __stdcall VirtualProtectEx(intptr_t h, uintptr_t addr, size_t size, uint32_t prot, void *old)'),
  CreateToolhelp32Snapshot: k32.func('intptr_t __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)'),
  Process32FirstW: k32.func('int __stdcall Process32FirstW(intptr_t snap, void *entry)'),
  Process32NextW: k32.func('int __stdcall Process32NextW(intptr_t snap, void *entry)'),
  Module32FirstW: k32.func('int __stdcall Module32FirstW(intptr_t snap, void *entry)'),
  Module32NextW: k32.func('int __stdcall Module32NextW(intptr_t snap, void *entry)'),
  QueryFullProcessImageNameW: k32.func('int __stdcall QueryFullProcessImageNameW(intptr_t h, uint32_t flags, void *name, void *size)'),
  IsWow64Process: k32.func('int __stdcall IsWow64Process(intptr_t h, void *wow)'),
  GetExitCodeProcess: k32.func('int __stdcall GetExitCodeProcess(intptr_t h, void *code)'),
  GetLastError: k32.func('uint32_t __stdcall GetLastError()'),
};

const C = {
  PROCESS_VM_OPERATION: 0x0008,
  PROCESS_VM_READ: 0x0010,
  PROCESS_VM_WRITE: 0x0020,
  PROCESS_QUERY_INFORMATION: 0x0400,
  PROCESS_QUERY_LIMITED_INFORMATION: 0x1000,
  TH32CS_SNAPPROCESS: 0x2,
  TH32CS_SNAPMODULE: 0x8,
  TH32CS_SNAPMODULE32: 0x10,
  INVALID_HANDLE_VALUE: -1,
  STILL_ACTIVE: 259,
  MEM_COMMIT: 0x1000,
  MEM_PRIVATE: 0x20000,
  MEM_MAPPED: 0x40000,
  MEM_IMAGE: 0x1000000,
  PAGE_NOACCESS: 0x01,
  PAGE_READONLY: 0x02,
  PAGE_READWRITE: 0x04,
  PAGE_WRITECOPY: 0x08,
  PAGE_EXECUTE_READ: 0x20,
  PAGE_EXECUTE_READWRITE: 0x40,
  PAGE_EXECUTE_WRITECOPY: 0x80,
  PAGE_GUARD: 0x100,
};

// Tailles x64 des structures Toolhelp / MEMORY_BASIC_INFORMATION
const PROCESSENTRY32W_SIZE = 568;
const MODULEENTRY32W_SIZE = 1080;
const MBI_SIZE = 48;

function wstr(buf, offset, maxBytes) {
  const s = buf.toString('utf16le', offset, offset + maxBytes);
  const end = s.indexOf('\0');
  return end === -1 ? s : s.slice(0, end);
}

module.exports = { api, C, wstr, PROCESSENTRY32W_SIZE, MODULEENTRY32W_SIZE, MBI_SIZE };
