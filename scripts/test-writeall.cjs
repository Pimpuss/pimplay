// Vérifie Scanner.writeAll sur un faux jeu qui garde deux copies d'une même valeur.
const { spawn } = require('node:child_process');
const assert = require('node:assert');
const { GameProcess } = require('../electron/engine/process.cjs');
const { Scanner } = require('../electron/engine/scanner.cjs');

const GAME = `
const a = Buffer.alloc(16), b = Buffer.alloc(16);
a.writeInt32LE(7654321, 0); b.writeInt32LE(7654321, 0);
require('node:readline').createInterface({ input: process.stdin }).on('line', () =>
  console.log(a.readInt32LE(0) + ' ' + b.readInt32LE(0)));
console.log('ready');
`;

(async () => {
  const child = spawn(process.execPath, ['-e', GAME], { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdout.setEncoding('utf8');
  const lines = [];
  child.stdout.on('data', (d) => lines.push(...d.trim().split('\n')));
  const next = async () => { while (!lines.length) await new Promise((r) => setTimeout(r, 20)); return lines.shift(); };
  assert.equal(await next(), 'ready');

  const scanner = new Scanner(GameProcess.open(child.pid));
  const r = await scanner.firstScan({ type: 'int32', value: '7654321' });
  console.log(`${r.count} résultats`);
  const n = scanner.writeAll(99);
  child.stdin.write('\n');
  const out = await next();
  console.log(`writeAll -> ${n} écritures, le jeu voit : ${out}`);
  assert.equal(out, '99 99');
  child.kill();
  console.log('OK');
})().catch((e) => { console.error('ÉCHEC :', e); process.exit(1); });
