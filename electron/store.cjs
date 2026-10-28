// Persistance JSON simple dans le dossier userData : réglages, jeux perso, stats, trainers.
const fs = require('node:fs');
const path = require('node:path');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'pimplay.json');
    this.trainersDir = path.join(dir, 'trainers');
    fs.mkdirSync(this.trainersDir, { recursive: true });
    this.coversDir = path.join(dir, 'covers');
    fs.mkdirSync(this.coversDir, { recursive: true });
    this.data = { customGames: [], favorites: [], hidden: [], meta: {}, steamAssets: {}, stats: {}, settings: { hotkeysEnabled: true } };
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch {}
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  trainerFile(gameId) {
    return path.join(this.trainersDir, gameId.replace(/[^a-z0-9_-]+/gi, '_') + '.json');
  }

  getTrainer(gameId) {
    try {
      const t = JSON.parse(fs.readFileSync(this.trainerFile(gameId), 'utf8'));
      return { process: '', notes: '', ...t, cheats: t.cheats || [] };
    } catch {
      return { process: '', notes: '', cheats: [] };
    }
  }

  saveTrainer(gameId, trainer) {
    fs.writeFileSync(this.trainerFile(gameId), JSON.stringify({ ...trainer, game: gameId }, null, 2));
  }

  hasTrainer(gameId) {
    return this.getTrainer(gameId).cheats.length;
  }
}

module.exports = { Store };
