// Cibles IL2CPP (jeux Unity) : retrouve une classe et ses champs par leur nom, puis ses instances
// dans le tas. Un mod vise ainsi « MoonPrototypeVehicle.Spec.width » sans offset codé en dur,
// et survit aux mises à jour du jeu tant que les noms ne changent pas.
const { parseHex } = require('./process.cjs');

// Disposition des structures du runtime IL2CPP 64 bits (Unity 2021 → 6)
const KLASS = { name: 0x10, namespaze: 0x18, parent: 0x58, fields: 0x80, methods: 0x88, staticFields: 0x98, methodCount: 0x118 };
const FIELD = { size: 0x20, name: 0x00, type: 0x08, parent: 0x10, offset: 0x18 };
const METHOD = { pointer: 0x00, name: 0x18, klass: 0x20 };
const ARRAY_DATA = 0x20n; // Il2CppArray : en-tête, bornes, longueur (+0x18), puis les éléments
const LIST = { items: 0x10n, size: 0x18n }; // System.Collections.Generic.List<T>
const TYPE_ATTRS = 0x08;
const FIELD_STATIC = 0x10;
const MAX_FIELDS = 1024;
const METADATA_SANITY = 0xfab11baf;

// Il2CppTypeEnum -> type de valeur Pimplay
const VALUE_OF = { 0x02: 'byte', 0x04: 'byte', 0x05: 'byte', 0x06: 'int16', 0x07: 'int16', 0x08: 'int32', 0x09: 'int32', 0x0a: 'int64', 0x0b: 'int64', 0x0c: 'float', 0x0d: 'double' };
const REFERENCE = new Set([0x0e, 0x12, 0x14, 0x15, 0x1c, 0x1d]); // string, class, array, generic, object, szarray

const CHUNK = 64 * 1024 * 1024;
const RETRY_MS = 15_000; // classe absente (pas encore chargée) : nouvel essai
const RESCAN_MS = 10_000; // aucune instance ne convient (objet pas encore créé…) : nouvelle recherche dans le tas
const RESCAN_ALL_MS = 60_000; // cible « all » : rafraîchit la liste des objets

const tick = () => new Promise((r) => setImmediate(r));
const ptrBytes = (addr) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(addr)); return b; };

function splitClass(full) {
  const s = String(full).trim();
  const i = s.lastIndexOf('.');
  return i === -1 ? { ns: '', name: s } : { ns: s.slice(0, i), name: s.slice(i + 1) };
}

class Il2Cpp {
  constructor(proc) {
    this.proc = proc;
    this.classes = new Map(); // "Ns.Classe" -> { klass, at, pending }
    this.fields = new Map(); // klass -> Map(nom -> { offset, type })
    this.instances = new Map(); // klass -> { list, at, pending }
  }

  cstr(addr, max = 128) {
    if (!addr) return null;
    const buf = this.proc.read(addr, max);
    if (!buf) return null;
    const end = buf.indexOf(0);
    return buf.toString('utf8', 0, end === -1 ? max : end);
  }

  className(klass) {
    return klass ? this.cstr(this.proc.readPointer(klass + BigInt(KLASS.name))) : null;
  }

  // Un objet managé commence par le pointeur vers sa classe : on vérifie qu'il mène à un nom lisible
  isObject(addr) {
    const klass = addr && this.proc.readPointer(addr);
    const name = klass && this.className(klass);
    return !!name && /^[A-Za-z_<][\w<>`.|[\]-]*$/.test(name);
  }

  // Parcourt la mémoire lisible par blocs en rendant la main entre chaque, pour ne pas figer l'interface
  async *chunks(writable) {
    for (const r of this.proc.regions({ writable })) {
      const size = Number(r.size);
      for (let off = 0; off < size; off += CHUNK) {
        const len = Math.min(CHUNK, size - off);
        const buf = this.proc.read(r.base + BigInt(off), len);
        if (buf) yield { base: r.base + BigInt(off), buf };
        await tick();
      }
    }
  }

  // Toutes les occurrences de plusieurs motifs en une seule lecture de la mémoire : [[adresses du motif 0], …]
  async findAll(patterns, writable, align = 1) {
    const hits = patterns.map(() => []);
    for await (const { base, buf } of this.chunks(writable)) {
      patterns.forEach((pattern, p) => {
        let i = buf.indexOf(pattern);
        while (i !== -1) {
          const addr = base + BigInt(i);
          if (addr % BigInt(align) === 0n) hits[p].push(addr);
          i = buf.indexOf(pattern, i + 1);
        }
      });
    }
    return hits;
  }

  // global-metadata.dat chargé par le jeu : une région qui commence par la signature IL2CPP
  metadataRegion() {
    if (this.metadata === undefined) {
      this.metadata = null;
      for (const r of this.proc.regions({ writable: false })) {
        const head = this.proc.read(r.base, 4);
        if (head && head.readUInt32LE(0) === METADATA_SANITY) { this.metadata = r; break; }
      }
    }
    return this.metadata;
  }

  // Chaînes des noms : dans les métadonnées si on les trouve (les Il2CppClass pointent dedans),
  // sinon dans toute la mémoire lisible, où elles ont beaucoup plus de copies.
  async findNames(names) {
    const patterns = names.map((n) => Buffer.from(`\0${n}\0`, 'utf8'));
    const meta = this.metadataRegion();
    const buf = meta && this.proc.read(meta.base, Number(meta.size));
    if (!buf) return this.findAll(patterns, false);
    return patterns.map((pattern) => {
      const hits = [];
      for (let i = buf.indexOf(pattern); i !== -1; i = buf.indexOf(pattern, i + 1)) hits.push(meta.base + BigInt(i));
      return hits;
    });
  }

  // Le nom de la classe est une chaîne des métadonnées ; l'Il2CppClass pointe dessus (+0x10).
  // Plusieurs classes sont cherchées ensemble, en une lecture du tas.
  async findClasses(fulls) {
    const wanted = fulls.map(splitClass);
    const strings = await this.findNames(wanted.map(({ name }) => name));
    const owners = strings.flatMap((list, i) => list.map((s) => ({ i, s })));
    const found = fulls.map(() => null);
    if (!owners.length) return found;
    const refs = await this.findAll(owners.map(({ s }) => ptrBytes(s + 1n)), true, 8);
    refs.forEach((list, j) => {
      const i = owners[j].i;
      for (const ref of list) {
        const klass = ref - BigInt(KLASS.name);
        if (found[i] === null && this.cstr(this.proc.readPointer(klass + BigInt(KLASS.namespaze))) === wanted[i].ns) found[i] = klass;
      }
    });
    return found;
  }

  async findInstances(klasses) {
    const hits = await this.findAll(klasses.map(ptrBytes), true, 8);
    return klasses.map((klass, i) => {
      // Écarte les références internes à la structure de classe elle-même
      const own = hits[i].filter((h) => h < klass || h > klass + 0x200n);
      return this.isUnityClass(klass) ? own.filter((h) => this.isLiveUnityObject(h)) : own;
    });
  }

  // Classe dérivée de UnityEngine.Object (MonoBehaviour, ScriptableObject…)
  isUnityClass(klass) {
    if (!this.unityClasses) this.unityClasses = new Map();
    if (this.unityClasses.has(klass)) return this.unityClasses.get(klass);
    let unity = false;
    for (let k = klass, depth = 0; k && depth < 16 && !unity; k = this.proc.readPointer(k + BigInt(KLASS.parent)), depth++) {
      unity = this.className(k) === 'Object' && this.cstr(this.proc.readPointer(k + BigInt(KLASS.namespaze))) === 'UnityEngine';
    }
    this.unityClasses.set(klass, unity);
    return unity;
  }

  // Un objet Unity vivant a un objet natif (m_CachedPtr, +0x10) dont la table virtuelle est dans
  // UnityPlayer.dll ; il est remis à zéro quand l'objet est détruit. Les simples références à la
  // classe trouvées dans le tas (tables de types…) échouent aussi à ce test.
  isLiveUnityObject(addr) {
    if (this.unityPlayer === undefined) this.unityPlayer = this.proc.findModule('UnityPlayer.dll') || null;
    const up = this.unityPlayer;
    if (!up) return true;
    if (this.proc.readPointer(addr + 8n) !== 0n) return false;
    const native = this.proc.readPointer(addr + 0x10n);
    const vtable = native && this.proc.readPointer(native);
    return !!vtable && vtable >= up.base && vtable < up.base + BigInt(up.size);
  }

  // Champs de la classe : nom -> { offset, type }. Champs d'instance (avec ceux des parents), ou
  // champs statiques de la classe seule, dont l'offset est relatif au bloc statique.
  fieldMap(klass, statics = false) {
    const key = `${klass}${statics ? 's' : ''}`;
    if (this.fields.has(key)) return this.fields.get(key);
    const map = new Map();
    for (let k = klass, depth = 0; k && depth < (statics ? 1 : 16); k = this.proc.readPointer(k + BigInt(KLASS.parent)), depth++) {
      const arr = this.proc.readPointer(k + BigInt(KLASS.fields));
      if (!arr) continue;
      for (let i = 0; i < MAX_FIELDS; i++) {
        const f = arr + BigInt(i * FIELD.size);
        if (this.proc.readPointer(f + BigInt(FIELD.parent)) !== k) break;
        const fname = this.cstr(this.proc.readPointer(f + BigInt(FIELD.name)));
        const type = this.proc.readPointer(f + BigInt(FIELD.type));
        const attrs = type ? this.proc.readValue(type + BigInt(TYPE_ATTRS), 'int32') >>> 0 : 0;
        if (!fname || !!(attrs & FIELD_STATIC) !== statics || map.has(fname)) continue;
        map.set(fname, { offset: BigInt(this.proc.readValue(f + BigInt(FIELD.offset), 'int32')), type: (attrs >> 16) & 0xff });
      }
    }
    if (map.size) this.fields.set(key, map);
    return map;
  }

  field(klass, name, statics = false) {
    const f = this.fieldMap(klass, statics).get(name);
    if (!f) throw new Error(`Champ ${statics ? 'statique ' : ''}introuvable : ${this.className(klass)}.${name}`);
    return f;
  }

  readField(obj, f) {
    return this.proc.readValue(obj + f.offset, VALUE_OF[f.type] || 'int32');
  }

  // Code d'une méthode de la classe, par son nom (table des MethodInfo du runtime)
  methodPointer(klass, name) {
    const arr = this.proc.readPointer(klass + BigInt(KLASS.methods));
    const count = this.proc.readValue(klass + BigInt(KLASS.methodCount), 'int16');
    if (!arr || !(count > 0)) throw new Error(`Méthodes de ${this.className(klass)} pas encore chargées`);
    for (let i = 0; i < count; i++) {
      const m = this.proc.readPointer(arr + BigInt(i * 8));
      if (!m || this.proc.readPointer(m + BigInt(METHOD.klass)) !== klass) continue;
      if (this.cstr(this.proc.readPointer(m + BigInt(METHOD.name))) === name) {
        const code = this.proc.readPointer(m + BigInt(METHOD.pointer));
        if (code) return code;
      }
    }
    throw new Error(`Méthode introuvable : ${this.className(klass)}.${name}`);
  }

  // Éléments (objets) d'une liste ou d'un tableau
  elements(obj) {
    const name = this.className(this.proc.readPointer(obj)) || '';
    let data = obj;
    let count;
    if (name.endsWith('[]')) count = Number(this.proc.readValue(obj + 0x18n, 'int64'));
    else if (name.startsWith('List`')) {
      data = this.proc.readPointer(obj + LIST.items);
      count = this.proc.readValue(obj + LIST.size, 'int32');
    } else throw new Error(`${name} n'est ni une liste ni un tableau : « [] » impossible.`);
    if (!data || !(count >= 0) || count > 100_000) return [];
    const out = [];
    for (let i = 0; i < count; i++) {
      const el = this.proc.readPointer(data + ARRAY_DATA + BigInt(i * 8));
      if (el && this.isObject(el)) out.push(el);
    }
    return out;
  }

  // Suit le chemin depuis un objet (ou depuis le bloc statique de la classe pour le premier champ).
  // « [] » parcourt chaque élément d'une liste ou d'un tableau : plusieurs adresses possibles.
  walk(obj, klass, path, spec, statics = false) {
    const end = (addr) => [addr + parseHex(spec.offset || 0)];
    if (!path.length) return end(obj);
    const [name, ...rest] = path;
    if (name === '[]') return this.elements(obj).flatMap((el) => this.walk(el, this.proc.readPointer(el), rest, spec));
    const f = this.field(klass, name, statics);
    if (!rest.length) return end(obj + f.offset);
    if (!REFERENCE.has(f.type)) throw new Error(`${name} n'est pas une référence : impossible de le suivre.`);
    const next = this.proc.readPointer(obj + f.offset);
    if (!next || !this.isObject(next)) return [];
    return this.walk(next, this.proc.readPointer(next), rest, spec);
  }

  // Adresses visées depuis une instance ; aucune si elle ne convient pas (morte, conditions non remplies…)
  follow(inst, klass, spec) {
    if (this.proc.readPointer(inst) !== klass) return [];
    if (this.isUnityClass(klass) && !this.isLiveUnityObject(inst)) return [];
    for (const [name, expected] of Object.entries(spec.where || {})) {
      const v = this.readField(inst, this.field(klass, name));
      if (v === null || v !== Number(expected)) return [];
    }
    return this.walk(inst, klass, spec.path || [], spec);
  }

  // Lance une recherche en arrière-plan. Les demandes faites pendant le même tour (tous les mods
  // résolus par la session) sont regroupées en une seule lecture de la mémoire.
  run(map, key, finder) {
    const entry = map.get(key) || {};
    if (entry.pending) return;
    entry.pending = true;
    map.set(key, entry);
    if (!this.queues) this.queues = new Map();
    if (!this.queues.has(finder)) {
      this.queues.set(finder, new Set());
      setImmediate(() => {
        const keys = [...this.queues.get(finder)];
        this.queues.delete(finder);
        finder.call(this, keys).then(
          (values) => keys.forEach((k, i) => Object.assign(map.get(k), { value: values[i], at: Date.now(), pending: false, error: null })),
          (e) => keys.forEach((k) => Object.assign(map.get(k), { value: null, at: Date.now(), pending: false, error: e.message })),
        );
      });
    }
    this.queues.get(finder).add(key);
  }

  resolve(spec, passive) {
    return this.matches(spec, false, passive)[0];
  }

  // Une adresse par objet qui convient (option « all » : tous les outils, tous les robots…)
  resolveAll(spec, passive) {
    return this.matches(spec, true, passive);
  }

  // Résolution synchrone appelée en boucle par la session : lance les recherches en arrière-plan
  // et lève une erreur explicite tant que le résultat n'est pas prêt. « passive » (simple affichage
  // de la valeur) fait la première recherche mais jamais les suivantes : chacune relit toute la
  // mémoire du jeu, seuls les mods activés doivent les déclencher.
  matches(spec, all, passive = false) {
    if (this.proc.is32) throw new Error('Cibles IL2CPP : jeux 64 bits uniquement.');
    if (!spec?.class) throw new Error('Classe IL2CPP manquante.');
    const now = Date.now();

    const c = this.classes.get(spec.class);
    if (!c || (!passive && !c.pending && !c.value && now - c.at > RETRY_MS)) this.run(this.classes, spec.class, this.findClasses);
    const cls = this.classes.get(spec.class);
    if (cls.pending && !cls.value) throw new Error('Recherche de la classe…');
    if (!cls.value) throw new Error(cls.error || `Classe introuvable : ${spec.class}`);
    const klass = cls.value;

    // Code d'une méthode (patch) ou champs statiques : pas besoin de chercher des instances
    if (spec.method) return [this.methodPointer(klass, spec.method) + parseHex(spec.offset || 0)];
    if (spec.static) {
      const block = this.proc.readPointer(klass + BigInt(KLASS.staticFields));
      if (!block) throw new Error(`Champs statiques de ${spec.class} pas encore initialisés`);
      const addrs = this.walk(block, klass, spec.path || [], spec, true);
      if (!addrs.length) throw new Error('Aucun objet trouvé');
      return all ? addrs : addrs.slice(0, 1);
    }

    if (!this.instances.has(klass)) this.run(this.instances, klass, this.findInstances);
    const inst = this.instances.get(klass);
    const found = [];
    for (const obj of inst.value || []) {
      for (const addr of this.follow(obj, klass, spec)) {
        if (found.includes(addr)) continue;
        found.push(addr);
        if (!all) return found;
      }
    }
    // Nouvelle recherche des objets créés depuis (véhicule acheté, robot…) : vite s'il n'en reste aucun
    // de vivant, rarement s'ils existent mais ne remplissent pas les conditions (pas au volant…) ou
    // pour une cible « all » déjà servie.
    const alive = (inst.value || []).some((obj) => this.proc.readPointer(obj) === klass && (!this.isUnityClass(klass) || this.isLiveUnityObject(obj)));
    const due = !found.length && !alive ? RESCAN_MS : RESCAN_ALL_MS;
    const rescan = !passive && !inst.pending && now - inst.at > due && (!found.length || all);
    if (rescan) this.run(this.instances, klass, this.findInstances);
    if (found.length) return found;
    if (inst.pending && !inst.value) throw new Error('Recherche des objets du jeu…');
    throw new Error(spec.where ? 'Aucun objet ne remplit les conditions' : 'Aucun objet trouvé');
  }
}

module.exports = { Il2Cpp, splitClass };
