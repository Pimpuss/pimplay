// Test du « qui écrit ici ? » sur le faux jeu natif (sub dword [rcx],1 toutes les 200 ms) :
// trouve l'instruction, la patche en NOP via une session, vérifie l'effet puis la restauration.
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert');
const { GameProcess } = require('../electron/engine/process.cjs');
const { Scanner } = require('../electron/engine/scanner.cjs');
const { WriteWatcher } = require('../electron/engine/debugger.cjs');
const { TrainerSession } = require('../electron/engine/session.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const child = spawn(process.execPath, [path.join(__dirname, 'native-game.cjs')], { stdio: ['ignore', 'pipe', 'inherit'] });
  let last = null;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => { last = d.trim().split('\n').pop(); });
  await wait(500);

  const proc = GameProcess.open(child.pid);
  const scanner = new Scanner(proc);
  await scanner.firstScan({ type: 'int32', value: last });
  await wait(450);
  await scanner.nextScan({ mode: 'decreased' });
  await wait(450);
  await scanner.nextScan({ mode: 'exact', value: last });
  const addrs = scanner.results(0, 4).map((r) => r.address);
  console.log(`${scanner.count} adresse(s) :`, addrs.join(', '));
  assert.ok(addrs.length >= 1);

  const w = new WriteWatcher(proc);
  w.start(addrs, 4);
  await wait(1500);
  const snap = w.snapshot();
  console.log('état :', snap.state);
  for (const h of snap.hits) console.log(`  ${h.count}× ${h.address}  ${h.text}  [${h.bytes}]  puis ${h.next.join(' ; ')}`);
  assert.equal(snap.state, 'running');
  const hit = snap.hits.find((h) => h.text === 'sub dword ptr [rcx],1' || h.text === 'sub dword [rcx],1');
  assert.ok(hit, "l'instruction sub [rcx],1 doit être trouvée");
  assert.equal(hit.bytes, '83 29 01');

  const p = w.makePatch(hit.id);
  console.log('patch :', p);
  assert.equal(p.patch, '90 90 90');
  await w.stop();
  console.log('détaché :', w.state);
  await wait(500);
  assert.equal(child.exitCode, null, 'le jeu doit survivre au détachement');

  const session = new TrainerSession();
  session.setTarget('test', { cheats: [{ id: 'p', name: p.name, kind: 'patch', patch: p.patch, target: { address: p.offset } }] });
  session.attach(child.pid);
  session.toggle('p', true);
  assert.equal(session.snapshot().cheats.p.error, null);
  await wait(300);
  const frozen = last;
  await wait(800);
  console.log(`patch actif : ${frozen} -> ${last}`);
  assert.equal(frozen, last, 'la vie ne doit plus baisser');

  session.toggle('p', false);
  await wait(800);
  console.log(`patch retiré : ${frozen} -> ${last}`);
  assert.ok(Number(last) < Number(frozen), 'la vie doit de nouveau baisser');

  session.detach();
  child.kill();
  proc.close();
  console.log('\nOK — débogueur et patch fonctionnels');
  process.exit(0);
})().catch((e) => { console.error('ÉCHEC :', e); process.exit(1); });
