// Lecture du registre Windows via reg.exe (aucune dépendance native)
const { execFile } = require('node:child_process');

function regQuery(args) {
  return new Promise((resolve) => {
    execFile('reg', ['query', ...args], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

async function regValue(key, name) {
  const out = await regQuery([key, '/v', name]);
  const m = out.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.*)`));
  return m ? m[1].trim() : null;
}

// Valeur par défaut d'une clé (le libellé « (par défaut) » dépend de la langue de Windows)
async function regDefault(key) {
  const out = await regQuery([key, '/ve']);
  return out.match(/REG_\w+\s+(.*)/)?.[1]?.trim() || null;
}

// Toutes les sous-clés d'une clé avec leurs valeurs : [{ key, name, values: { Nom: valeur } }]
async function regTree(key) {
  const out = await regQuery([key, '/s']);
  const blocks = [];
  let cur = null;
  for (const line of out.split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) {
      cur = { key: line.trim(), name: line.trim().split('\\').pop(), values: {} };
      blocks.push(cur);
    } else if (cur) {
      const m = line.match(/^\s{4}(.+?)\s{4}REG_\w+\s{4}(.*)$/);
      if (m) cur.values[m[1]] = m[2].trim();
    }
  }
  return blocks;
}

// Entrées « Programmes et fonctionnalités » (vues 32 et 64 bits)
async function uninstallEntries() {
  const keys = [
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const all = (await Promise.all(keys.map(regTree))).flat();
  return all.filter((e) => e.values.DisplayName);
}

module.exports = { regQuery, regValue, regDefault, regTree, uninstallEntries };
