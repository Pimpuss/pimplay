// Faux jeu « natif » : la vie est décrémentée par une vraie instruction machine dédiée
// (sub dword [rcx],1), comme dans un jeu compilé. Sert à tester « Qui écrit ici ? » et les patchs.
const koffi = require('koffi');

const k32 = koffi.load('kernel32.dll');
const VirtualAlloc = k32.func('uintptr_t __stdcall VirtualAlloc(uintptr_t addr, size_t size, uint32_t type, uint32_t prot)');
const RtlMoveMemory = k32.func('void __stdcall RtlMoveMemory(uintptr_t dst, void *src, size_t n)');
const MEM_COMMIT_RESERVE = 0x3000;

// Code : un peu de remplissage puis la fonction « prendre un coup »
const CODE = Buffer.from([
  0x48, 0x89, 0xc8, // mov rax, rcx
  0x83, 0x29, 0x01, // sub dword [rcx], 1   <- l'instruction à trouver
  0x8b, 0x00, //       mov eax, [rax]
  0xc3, //             ret
]);
const code = VirtualAlloc(0, 4096, MEM_COMMIT_RESERVE, 0x40); // PAGE_EXECUTE_READWRITE
RtlMoveMemory(code, CODE, CODE.length);
const hit = koffi.proto('int Hit(uintptr_t hp)');

const hp = VirtualAlloc(0, 4096, MEM_COMMIT_RESERVE, 0x04); // PAGE_READWRITE
RtlMoveMemory(hp, Buffer.from(new Int32Array([5000]).buffer), 4);

setInterval(() => {
  const v = koffi.call(code, hit, hp);
  console.log(v);
}, Number(process.argv[2] || 200));
