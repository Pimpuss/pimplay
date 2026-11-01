// Test bout-en-bout du moteur : lance un faux jeu, scanne, affine, écrit, gèle et teste l'AOB.
const { spawn } = require('node:child_process');
const assert = require('node:assert');
const { GameProcess, listProcesses, toHex, TYPES } = require('../electron/engine/process.cjs');
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

  // Multiplicateur : ×2 sur l'endurance, puis valeur d'origine remise à la désactivation
  // (le scan float trouve aussi des copies de 87.25 : l'endurance est 8 octets après la vie)
  const stamina = toHex(BigInt(hit.address) + 8n);
  session.setTrainer({
    cheats: [...session.trainer.cheats,
      { id: 'st', name: 'Endurance ×2', kind: 'multiplier', valueType: 'float', value: 2, target: { address: stamina } }],
  });
  session.toggle('st', true);
  state = await game.send('show');
  console.log('multiplicateur ×2 ->', state);
  assert.equal(state.stamina, 174.5);
  session.setValue('st', 4);
  state = await game.send('show');
  assert.equal(state.stamina, 349);
  // Le jeu change lui-même la valeur : elle devient la nouvelle base une fois stable
  proc.writeValue(BigInt(stamina), 'float', 50);
  await new Promise((res) => setTimeout(res, 400));
  state = await game.send('show');
  console.log('le jeu passe la base à 50 ->', state);
  assert.equal(state.stamina, 200);
  // Un autre outil multiplie aussi la valeur (×5) : elle ne devient pas la base, Pimplay remet 50 × 4
  proc.writeValue(BigInt(stamina), 'float', 1000);
  await new Promise((res) => setTimeout(res, 400));
  state = await game.send('show');
  console.log('un autre outil écrit 1000 ->', state);
  assert.equal(state.stamina, 200);
  session.toggle('st', false);
  state = await game.send('show');
  console.log('multiplicateur désactivé ->', state);
  assert.equal(state.stamina, 50);

  // Patch avec octets attendus : refusé s'ils ne correspondent pas, appliqué puis restauré sinon
  const current = proc.read(BigInt(stamina), 4).toString('hex').match(/../g).join(' ');
  session.setTrainer({
    cheats: [...session.trainer.cheats,
      { id: 'bad', name: 'Mauvais patch', kind: 'patch', patch: '00 00 80 3F', expect: 'DE AD BE EF', target: { address: stamina } },
      { id: 'ok', name: 'Bon patch', kind: 'patch', patch: '00 00 80 3F', expect: current, target: { address: stamina } }],
  });
  session.toggle('bad', true);
  assert.equal(session.state.get('bad').enabled, false);
  assert.match(session.state.get('bad').error, /différent/);
  session.toggle('ok', true);
  state = await game.send('show');
  assert.equal(state.stamina, 1);
  session.toggle('ok', false);
  state = await game.send('show');
  console.log('patch avec octets attendus appliqué puis restauré ->', state);
  assert.equal(state.stamina, 50);

  // Patch à usage unique : armé par le bouton, retiré tout seul quand la valeur surveillée (la vie) change
  session.setTrainer({
    cheats: [...session.trainer.cheats,
      { id: 'once', name: 'Une fois', kind: 'patch', patch: '00 00 80 3F', expect: current,
        until: { target: { address: hit.address }, valueType: 'int32' }, target: { address: stamina } }],
  });
  session.trigger('once');
  await new Promise((res) => setTimeout(res, 250));
  state = await game.send('show');
  assert.equal(state.stamina, 1);
  assert.equal(session.state.get('once').enabled, true);
  await game.send('hit');
  await new Promise((res) => setTimeout(res, 250));
  state = await game.send('show');
  console.log('patch à usage unique retiré après l\'action ->', state);
  assert.equal(state.stamina, 50);
  assert.equal(session.state.get('once').enabled, false);
  // ignoreZero : un passage à 0 (action à vide) ne retire pas le patch, la valeur suivante si
  session.trainer.cheats.find((x) => x.id === 'once').until.ignoreZero = true;
  session.trigger('once');
  await new Promise((res) => setTimeout(res, 250));
  proc.writeValue(BigInt(hit.address), 'int32', 0);
  await new Promise((res) => setTimeout(res, 250));
  assert.equal(session.state.get('once').enabled, true);
  await game.send('hit');
  await new Promise((res) => setTimeout(res, 250));
  assert.equal(session.state.get('once').enabled, false);
  console.log('ignoreZero : passage à 0 ignoré, retiré à la valeur suivante');

  // Patch sur plusieurs emplacements, jokers « ?? » dans les octets attendus, tout ou rien
  const hpBytes = proc.read(BigInt(hit.address), 4).toString('hex').match(/../g).join(' ');
  const site = (address, patch, expect) => ({ target: { address }, patch, expect });
  session.setTrainer({
    cheats: [...session.trainer.cheats,
      { id: 'multi-bad', name: 'Multi KO', kind: 'patch', target: { address: stamina }, patch: '00 00 80 3F',
        sites: [site(stamina, '00 00 80 3F', '?? ?? ?? ??'), site(hit.address, '01 00 00 00', 'DE AD ?? ??')] },
      { id: 'multi', name: 'Multi', kind: 'patch', target: { address: stamina }, patch: '00 00 80 3F',
        sites: [site(stamina, '00 00 80 3F', `?? ?? ${current.slice(6)}`), site(hit.address, '01 00 00 00', hpBytes)] }],
  });
  session.toggle('multi-bad', true);
  state = await game.send('show');
  assert.equal(session.state.get('multi-bad').enabled, false);
  assert.equal(state.stamina, 50); // le premier emplacement a été remis en état
  session.toggle('multi', true);
  state = await game.send('show');
  assert.deepEqual([state.stamina, state.hp], [1, 1]);
  session.toggle('multi', false);
  state = await game.send('show');
  console.log('patch sur 2 emplacements appliqué puis restauré ->', state);
  assert.equal(state.stamina, 50);

  // « Désactiver les mods » (setTarget(null)) remet le jeu en état : multiplicateur et patch actifs
  session.setTrainer({
    cheats: [...session.trainer.cheats,
      { id: 'hp-patch', name: 'Patch vie', kind: 'patch', patch: '01 00 00 00', target: { address: hit.address } }],
  });
  session.toggle('st', true);
  session.toggle('hp-patch', true);
  state = await game.send('show');
  assert.deepEqual([state.stamina, state.hp], [200, 1]);
  session.setTarget(null, { cheats: [] });
  state = await game.send('show');
  console.log('désactivation des mods ->', state);
  assert.deepEqual([state.stamina, state.hp], [50, -10]);
  session.setTarget('test', { cheats: [] });
  session.attach(pid);

  // Décimal .NET (argent) : 97 547,40 s'écrit échelle 2, mantisse 9754740
  const dec = Buffer.alloc(16);
  TYPES.decimal.write(dec, 0, 97547.4);
  assert.equal(dec.toString('hex'), '000002000000000074d8940000000000');
  assert.equal(TYPES.decimal.read(dec, 0), 97547.4);

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
