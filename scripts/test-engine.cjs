// Test bout-en-bout du moteur : lance un faux jeu, scanne, affine, écrit, gèle et teste l'AOB.
const { spawn } = require('node:child_process');
const assert = require('node:assert');
const { GameProcess, listProcesses, toHex } = require('../electron/engine/process.cjs');
const { Scanner } = require('../electron/engine/scanner.cjs');
const { TrainerSession } = require('../electron/engine/session.cjs');

const GAME = `
const b = Buffer.alloc(64);
b.writeInt32LE(1337421, 0);
b.writeFloatLE(87.25, 8);
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', (cmd) => {
  if (cmd === 'hit') b.writeInt32LE(b.readInt32LE(0) - 10, 0);
  console.log(JSON.stringify({ hp: b.readInt32LE(0), stamina: b.readFloatLE(8) }));
});
console.log('ready');
`;

function startGame() {
  const child = spawn(process.execPath, ['-e', GAME], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  let waiter = null;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    for (const l of d.split('\n').filter(Boolean)) {
      if (waiter) { const w = waiter; waiter = null; w(l); } else lines.push(l);
    }
  });
  const next = () => new Promise((r) => (lines.length ? r(lines.shift()) : (waiter = r)));
  const send = async (cmd) => { child.stdin.write(cmd + '\n'); return JSON.parse(await next()); };
  return { child, next, send };
}

(async () => {
  const game = startGame();
  assert.equal(await game.next(), 'ready');
  const pid = game.child.pid;
  assert.ok(listProcesses().some((p) => p.pid === pid), 'process listé');

  const proc = GameProcess.open(pid);
  console.log(`attaché à ${proc.exeName} (pid ${pid}, ${proc.is32 ? '32' : '64'} bits)`);

  const scanner = new Scanner(proc);
  let t = Date.now();
  let r = await scanner.firstScan({ type: 'int32', value: '1337421' });
  console.log(`premier scan : ${r.count} résultats en ${Date.now() - t} ms`);
  assert.ok(r.count >= 1);

  await game.send('hit'); // hp 1337411
  r = await scanner.nextScan({ mode: 'decreased' });
  console.log(`après « diminué » : ${r.count} résultats`);
  r = await scanner.nextScan({ mode: 'exact', value: '1337411' });
  console.log(`après « exact 1337411 » : ${r.count} résultats`);
  assert.ok(r.count >= 1);

  const hit = scanner.results(0, 10)[0];
  assert.ok(proc.writeValue(BigInt(hit.address), 'int32', 9999));
  let state = await game.send('show');
  console.log('écriture directe ->', state);
  assert.equal(state.hp, 9999);

  // Float : comparaison arrondie
  const fs = new Scanner(proc);
  r = await fs.firstScan({ type: 'float', value: '87.25' });
  console.log(`scan float 87.25 : ${r.count} résultats`);
  assert.ok(r.count >= 1);

  // Session : gel de la santé via adresse absolue
  const session = new TrainerSession();
  session.setTarget('test', {
    cheats: [
      { id: 'hp', name: 'Santé infinie', kind: 'freeze', valueType: 'int32', value: 5000, target: { address: hit.address } },
      { id: 'mz', name: 'MZ', kind: 'button', valueType: 'int16', value: 0x5a4d, target: { module: proc.exeName, offset: '0' } },
    ],
  });
  session.attach(pid);
  session.toggle('hp', true);
  await new Promise((res) => setTimeout(res, 250));
  await game.send('hit');
  await new Promise((res) => setTimeout(res, 250));
  state = await game.send('show');
  console.log('gel actif ->', state);
  assert.equal(state.hp, 5000);
  session.toggle('hp', false);

  // Module + offset et AOB : l'en-tête PE « MZ » est en tête du module principal
  const mod = proc.findModule(proc.exeName);
  const aob = proc.aobScan('4D 5A ?? 00', proc.exeName);
  console.log(`module ${mod.name} @ ${toHex(mod.base)}, AOB « 4D 5A ?? 00 » @ ${aob === null ? 'introuvable' : toHex(aob)}`);
  assert.equal(aob, mod.base);
  assert.equal(proc.resolve({ module: proc.exeName, offset: '0' }), mod.base);

  session.detach();
  proc.close();
  game.child.kill();
  console.log('\nOK — moteur fonctionnel');
})().catch((e) => {
  console.error('ÉCHEC :', e);
  process.exit(1);
});
