// Faux « jeu » pour tester Pimplay : garde de la vie (int32) et de l'or (float) en mémoire.
// Tapez Entrée pour prendre 10 dégâts ; l'état s'affiche à chaque tour.
const b = Buffer.alloc(64);
b.writeInt32LE(4242421, 0);
b.writeFloatLE(1250.5, 8);
const show = () => console.log(`PID ${process.pid} | vie ${b.readInt32LE(0)} | or ${b.readFloatLE(8)}`);
show();
require('node:readline').createInterface({ input: process.stdin }).on('line', () => {
  b.writeInt32LE(b.readInt32LE(0) - 10, 0);
  show();
});
setInterval(show, 2000);
