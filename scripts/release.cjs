// Publie la version construite (release/) dans les Releases GitHub, d'où Pimplay se met à jour tout seul.
// Usage : npm run release -- "Notes de version"  (nécessite le CLI gh connecté au compte du dépôt)
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { version, build } = require('../package.json');
const { owner, repo } = build.publish[0];
const dir = path.join(__dirname, '..', 'release');
const exe = `Pimplay-Setup-${version}.exe`;
const files = [exe, `${exe}.blockmap`, 'latest.yml'].map((f) => path.join(dir, f));

for (const f of files) {
  if (!fs.existsSync(f)) {
    console.error(`Fichier manquant : ${f} (lancez d'abord la construction)`);
    process.exit(1);
  }
}
// latest.yml doit annoncer cette version, sinon les applications installées ne verraient rien
if (!fs.readFileSync(files[2], 'utf8').includes(`version: ${version}`)) {
  console.error(`latest.yml ne correspond pas à la version ${version}`);
  process.exit(1);
}

const tag = `v${version}`;
const notes = process.argv.slice(2).join(' ').trim() || `Pimplay ${version}`;
execFileSync('gh', ['release', 'create', tag, ...files, '--repo', `${owner}/${repo}`, '--title', `Pimplay ${version}`, '--notes', notes], { stdio: 'inherit' });
console.log(`Version ${version} publiée : les Pimplay installés la téléchargeront à leur prochaine vérification.`);
