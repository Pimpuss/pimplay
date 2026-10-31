# Pimplay

Bibliothèque de jeux + trainer pour **jeux solo**, dans l'esprit de Wand (ex-WeMod).
Electron + React, moteur mémoire Win32 via [koffi](https://koffi.dev).

## Lancer

```bash
npm install
npm run dev        # Vite + Electron avec rechargement à chaud
npm run build      # build de l'interface (dist/)
npm start          # lance l'app sur le build
npm run dist       # installateur Windows (release/)
npm run icons      # régénère build/icon.png et build/icon.ico depuis build/logo.svg
npm run test:engine
```

## Publier une mise à jour

Les Pimplay installés vérifient les [Releases GitHub](https://github.com/Pimpuss/pimplay/releases) au démarrage puis
toutes les 6 h, téléchargent la nouvelle version en arrière-plan et l'installent au redémarrage (electron-updater).

1. Augmenter `version` dans `package.json` (ex. `0.2.0` → `0.2.1`) : une version égale ou inférieure est ignorée.
2. Commiter et pousser.
3. `npm run release -- "Ce qui change"` : construit l'installateur puis crée la release `vX.Y.Z` avec
   `Pimplay-Setup-X.Y.Z.exe`, son `.blockmap` et `latest.yml` (nécessite le CLI `gh` connecté au compte du dépôt).

## Fonctionnalités

- **Bibliothèque** : détection automatique des jeux Steam (toutes les bibliothèques), Epic Games et GOG, ajout manuel d'un `.exe`. Jaquettes depuis le cache local de Steam puis le CDN.
- **Détection en jeu** : surveille les processus toutes les 2 s et repère les jeux lancés (exécutable situé dans le dossier d'installation).
- **Trainer** : quand on clique sur *Jouer* ou *Activer les mods*, Pimplay s'attache au jeu dès qu'il tourne. Cinq types de mods :
  - **Gel** : réécrit une valeur toutes les 100 ms (vie, munitions…)
  - **Curseur** : choisit une valeur (argent, vitesse…), éventuellement gelée
  - **Bouton** : définit ou ajoute une valeur à chaque déclenchement
  - **Multiplicateur** : multiplie la valeur d'origine du jeu (×2, ×5…) et la remet à la désactivation ; si le jeu change lui-même la valeur (autre outil équipé…), elle devient la nouvelle base
  - **Patch** : remplace des octets de code (NOP…), restauré à la désactivation
- **Cibles** : adresse absolue, `module + offset` avec chaîne de pointeurs, signature AOB (`48 8B ?? 05`), ou **objet Unity (IL2CPP)** : classe et champs désignés par leur nom, instances retrouvées dans le tas, donc sans offset codé en dur (64 bits).
- **Raccourcis globaux** (F1, Ctrl+F2, pavé numérique…) actifs uniquement quand un jeu est connecté.
- **Scanner mémoire** à la Cheat Engine : premier scan (valeur exacte, 6 types), affinage (exacte, augmentée, diminuée, changée, inchangée), édition de valeur, création de mod en un clic. Les adresses statiques sont affichées en `module+offset`.
- **« Qui écrit ici ? »** : débogueur à points d'arrêt matériels (jusqu'à 4 adresses à la fois). Affiche les instructions du jeu qui modifient la valeur (désassemblées avec iced-x86) et crée en un clic un patch NOP avec une signature AOB unique, donc un mod qui survit aux relancements. 64 bits uniquement.
- **Import / export** des trainers en JSON pour les partager.
- **Sécurité** : refus de s'attacher aux jeux protégés par un anti-triche (EasyAntiCheat, BattlEye…).

## Format d'un trainer

Un fichier par jeu dans `%APPDATA%/pimplay/trainers/` :

```json
{
  "process": "Game-Win64-Shipping.exe",
  "cheats": [
    { "id": "hp", "name": "Santé infinie", "category": "Joueur", "kind": "freeze",
      "valueType": "float", "value": 100, "hotkey": "F1",
      "target": { "module": "Game-Win64-Shipping.exe", "offset": "0x6F1A2B0", "pointers": ["0x30", "0x2A8"] } },
    { "id": "ammo", "name": "Munitions infinies", "kind": "patch", "patch": "90 90 90", "hotkey": "F2",
      "target": { "module": "Game-Win64-Shipping.exe", "aob": "29 47 ?? 8B 45", "aobOffset": "0" } }
  ]
}
```

Cible IL2CPP avec un multiplicateur (exemple complet : [`trainers/MoonSweepers.pimplay.json`](trainers/MoonSweepers.pimplay.json), notes dans [`trainers/MoonSweepers.md`](trainers/MoonSweepers.md)) :

```json
{ "id": "vehicle-width", "name": "Largeur de brosse du véhicule", "kind": "multiplier",
  "valueType": "float", "value": 5, "min": 1, "max": 10, "step": 0.5,
  "target": { "il2cpp": { "class": "MoonCleaners.MoonPrototypeVehicle",
                          "where": { "<IsDriven>k__BackingField": true },
                          "path": ["authored", "cleaningWidth"] } } }
```

`class` est `espace de noms.Classe` ; `path` suit les champs depuis l'objet (les références sont déréférencées, le dernier champ est la valeur visée) ; `where` choisit l'objet quand il y en a plusieurs ; `"all": true` applique le mod à tous les objets de la classe (tous les outils, tous les robots…) ; `"[]"` dans le chemin parcourt chaque élément d'une liste ou d'un tableau ; `"static": true` part des champs statiques de la classe ; `"method": "Nom"` (+ `offset`) vise le code d'une méthode, pour un patch. Un patch peut indiquer `expect`, les octets d'origine attendus : s'ils diffèrent (mise à jour du jeu), il n'est pas appliqué. Une propriété C# auto-implémentée `Spec` s'écrit `<Spec>k__BackingField`. La première recherche parcourt la mémoire du jeu en arrière-plan (quelques secondes) ; le mod affiche « Recherche des objets du jeu… » en attendant.

## Structure

```
electron/
  main.cjs          fenêtre, IPC, surveillance des processus, raccourcis
  preload.cjs       API exposée au rendu (window.pimplay)
  games.cjs         détection Steam / Epic / GOG
  store.cjs         persistance JSON
  engine/
    win32.cjs       bindings kernel32 (koffi)
    process.cjs     lecture/écriture, modules, régions, AOB, pointeurs
    il2cpp.cjs      cibles Unity IL2CPP : classe, champs et instances par leur nom
    scanner.cjs     scan de valeurs
    session.cjs     application des mods
    debugger.cjs    « qui écrit ici ? » : décodage, signature AOB, patch
    debugger-worker.cjs  boucle de débogage Win32 (thread dédié)
src/                interface React (pages Accueil, Mes jeux, Jeu, Scanner, Paramètres)
trainers/           trainers prêts à importer, avec leurs notes
scripts/            test du moteur, faux jeu de test, client CDP
```

## Tester sans vrai jeu

```bash
node scripts/fake-game.cjs
```

Puis dans Pimplay › Scanner mémoire : choisir `node.exe`, chercher `4242421`, appuyer sur Entrée dans le terminal du faux jeu (−10 de vie), scan suivant « A diminué »…

Pour « Qui écrit ici ? », `node scripts/native-game.cjs` perd 1 PV toutes les 200 ms via une vraie instruction machine (`sub dword [rcx],1`). `node scripts/test-debugger.cjs` fait tout le parcours automatiquement (scan, débogueur, patch, restauration).

> Si un jeu refuse la connexion (« Accès refusé »), lancez Pimplay en administrateur.
