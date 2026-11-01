# Moon Sweepers — notes de trainer

Relevé sur Moon Sweepers 1.0.4 (build f87fd7e5, Unity 6000.6, IL2CPP), le 31/10/2026, puis vérifié sur la
1.0.5 Steam (build 0121bf5e) le 01/11/2026 : toutes les fonctions y ont changé d'adresse, mais le trainer les
retrouve par leur nom et les octets attendus des patchs correspondent. Les offsets ci-dessous sont ceux de
la 1.0.4 et changent avec les mises à jour ; le trainer vise les champs par leur nom (cible IL2CPP).

## Mods et d'où ils viennent

Chaque champ a été choisi en lisant le code du jeu qui l'utilise (désassemblage de `GameAssembly.dll`).

| Mod | Cible | Lu par |
|---|---|---|
| Vitesse de déplacement | `MoonWalker.<DevSpeedMultiplier>` (1) | `MoonWalker.FixedUpdate` : `settings.runSpeed × EquipmentSpeedMultiplier × DevSpeedMultiplier` |
| Hauteur de saut | `MoonSettings.jumpHeight` (2.5) | `MoonWalker.FixedUpdate` |
| Gravité | `MoonSettings.gravity` (1.62) | `MoonWalker.FixedUpdate`, `get_Gravity` |
| Boosts de jetpack infinis | `MoonWalker.<BoostsLeft>` (4) | décrémenté par `StartBoost`, rechargé par `RefillBoosts` |
| Énergie de l'équipement infinie | `MoonPrototypeEquipment.<Energy>` (100) | `SpendEnergy`, `Recharge`, `UpdateTool` |
| Largeur de la brosse | `MoonToolDefinition.cleaningWidth`, les 7 outils (`all`) | `MoonBrush.LateUpdate` → `ApplyUpgrades`, à chaque frame : `brosse.cleaningWidth = outil.cleaningWidth × CleaningWidthMultiplier()` |
| Portée de la brosse | `MoonToolDefinition.reach`, les 7 outils (`all`) | idem : `brosse.reach = outil.reach + CleaningReachBonus()` |
| Largeur de brosse du véhicule | `MoonPrototypeVehicle.authored.cleaningWidth`, ×5 au plus | `get_CleaningWidth`, voir plus bas |
| Vitesse du véhicule | `MoonPrototypeVehicle.<SpeedFactor>` | `get_MaximumSpeed = Spec.speed × SpeedFactor × BoostFactor` |
| Vitesse des robots | `MoonRobotVacuum.travelSpeed`, tous les robots | `MoonRobotVacuum.Update`, `Due` |
| Capacité des robots | `MoonRobotVacuum.capacityKilograms` (double), tous les robots | `Update`, `Full`, `get_BinFraction` |
| Capacité de transport | `MoonUpgradeCatalog.containers[].capacityMultiplier` (×2, ×4, ×8 selon le niveau) | `MoonWorld.ContainerMultiplier` → `ContainerCapacityKg` ; sans conteneur acheté, pas d'effet |
| Dépôts instantanés | patch de `MoonWorld.DepositTimeMultiplier` → renvoie 0 | `MoonDustHand.DepositSeconds = max(0.15, durée × DepositTimeMultiplier())` |
| Remplir le conteneur à poussière | patch `MoonWorld.FinishInventorySweep` +0xea : NOP sur `movaps xmm7,xmm6` | voir plus bas : chaque coup de balai remplit le conteneur à sa capacité |
| Remplir le réservoir du véhicule | même fonction, +0x162 (branche `cleaningVehicleStorage`) | idem quand on nettoie avec un véhicule |
| Chambre de pression rapide | `MoonWorld.ChamberSpec.cycleSeconds` (statique, 12 s) | `MoonWorld.StepProduction` : `Progress += dt × Power / cycleSeconds` |
| Presse rapide | `MoonWorld.PressSpec.cycleSeconds` (statique, 6 s) | idem |
| Arbre d'améliorations gratuit | patch `TryGetTreePrice` +0x173 : `movups [rbp],xmm0` → NOP | le prix de sortie reste à 0 (mis à zéro en entrée) |
| Améliorations de véhicule gratuites | patch `TryGetVehicleUpgradePrice` +0xe4, même principe | |
| Outils et conteneurs gratuits | patch `MoonWorld.Discounted` → renvoie le décimal 0 | appelé par `TryGetToolPrice`, `TryGetContainerPrice`, `TryPurchaseTool` |
| Figer l'heure (plein jour) | patch `MoonSolarSystem.get_LunarTime` → renvoie 0.5 | fraction de la journée lunaire (3600 s) utilisée par le ciel, le soleil et `LunarCycle` |
| Menu développeur du jeu | 2 emplacements : `MoonPauseMenu.Build` +0xb2b (`call Debug.isDebugBuild` → `mov al,1`) et `MoonDevTools.get_Enabled` → `mov al,1 ; ret` | voir plus bas |
| Gains par kilo de poussière | `MoonSettings.dollarsPerKilogram` (1) | `MoonWorld.CreditShare` et le crédit des lancements |
| Ajouter de l'argent | `MoonWorld.wallets.Balance` (`TeamWallet`, `System.Decimal`) | `MoonWorld.WalletDollars` |

Les patchs visent la méthode par son nom et vérifient les octets d'origine (`expect`) : après une mise à
jour qui change le code, ils refusent de s'appliquer au lieu de corrompre le jeu.

Le véhicule ne ramasse plus la poussière s'il roule trop vite (vitesse du véhicule ×2 et plus) : `Clean`
ignore les déplacements plus grands que `Spec.speed × SpeedFactor × BoostFactor × 0.3` par passage.

### Remplissage du conteneur

La poussière portée est dans `MoonWorld.inventoryMass` (`Dictionary<string, double>`, clé =
`MoonDustInventory.playerId`, ex. `steam-7656…`) ; la capacité n'est stockée nulle part, elle est recalculée
(`InventoryCapacityKg`). À la fin de chaque balayage, `FinishInventorySweep` fait :

```
nouveau = porté + balayé
si capacité − nouveau ≤ 0.001 : nouveau = capacité      ; comisd / jae
sinon                          : (garde nouveau)       ; movaps xmm7,xmm6  ← neutralisé par le mod
inventoryMass[cleaningPlayer] = nouveau
```

Avec le mod, la valeur écrite est toujours la capacité calculée par le jeu : un coup de balai remplit le
conteneur, sans connaître la capacité ni le joueur local.

« Remplir le conteneur » est un patch à usage unique (`until`) : le bouton l'arme, il se retire dès que la
jauge du HUD (`MoonDustGaugeAnimator.targetKg`) change, c'est-à-dire au remplissage. `LastCollectedKilograms`
ne convient pas : il reste à 0 lors du balayage qui remplit, puis le conteneur plein bloque les suivants
(relevé en jeu). « Remplir le réservoir du véhicule » reste un interrupteur.

### Menu développeur

Le jeu embarque un menu développeur dans le menu pause (`MoonPauseMenu.BuildDev`), affiché seulement si
`Debug.isDebugBuild`. Il contient : remplir / vider la poussière portée (`DevSetCarriedDust(joueur,
double.MaxValue)`, ramené à la capacité : remplissage instantané, comme Wand), trois boutons d'argent
(`AddMoney`), l'heure de la journée (`SetLunarTime`) et d'autres réglages. Les actions `Dev*` vérifient en
plus `MoonDevTools.get_Enabled`. Le mod patche les deux. Effet de bord : `MoonWalker.Update` active aussi les
touches de debug du jeu (indicateur de noclip, clavier) tant que le mod est actif.

Écartés :
- Achat de véhicules gratuit : prix calculé ailleurs (`TryBuyVehicle`), non relevé.
- Figer l'heure en gardant l'heure actuelle : l'horloge vaut `secondes × clockSpeed + clockOffset` (statiques
  de `MoonSolarSystem`, ou `crewValue`/`crewSpeed` en coop) ; mettre la vitesse à 0 fait sauter l'heure.
- Capacité d'inventaire : elle dépend du conteneur porté et de ses améliorations (`MoonWorld.ContainerCapacityKg`) ; `MoonSettings.inventoryCapacityKg` n'est qu'une valeur de repli.
- Mode vol (`MoonWalker.<Flying>`, `FlySpeed`, `FlyStep`) : un gel ne remet pas la valeur à la désactivation et le joueur resterait en vol.
- `MoonBrush.cleaningWidth` / `reach` directement : `ApplyUpgrades` les réécrit à chaque frame, le mod n'avait aucun effet (testé).
- Les bonus d'amélioration de la brosse (`MoonWorld.CleaningWidthMultiplier`, `CleaningReachBonus`) : calculés depuis les niveaux de l'arbre et des constantes du code, aucun champ à viser.
- Largeur des robots (`MoonRobotVacuum.cleaningWidth`) : lue une seule fois, dans `Setup`.

En coop, l'argent est un portefeuille d'équipe (`TeamWallet`) synchronisé : l'ajout peut être écrasé si on n'est pas l'hôte.

## Largeur de brosse des véhicules

`MoonPrototypeVehicle.get_CleaningWidth` (RVA 0x4cd880) :

```
si authored (MoonAuthoredVehicleView) existe : largeur = authored.cleaningWidth × |échelle de l'objet|
sinon                                        : largeur = Spec.width (Item)
puis                                           largeur × coefficient d'aspiration[Suction]
```

Les véhicules avec une vue « authored » (Mega vacuum rover…) ignorent `Item.width` : modifier la fiche seule
n'a aucun effet en jeu (testé).

La largeur part ensuite dans `MoonWorld.QueueToolStroke`, qui découpe le trait en sous-traits selon la
largeur, puis `CleanToolStroke` la limite à [0.05, 12]. À 18.5 (×5) le ramassage fonctionne ; à 25.9 (×7) et
37 (×10), le véhicule ne ramasse plus rien (testé). Le mod est donc plafonné à ×5.

## Ce que fait Wand

Wand ne modifie aucun fichier. Il injecte son trainer dans `MoonSweepers.exe` et, dès qu'un mod est activé,
place un `jmp` au début de 22 fonctions de `GameAssembly.dll` ; chaque mod est ensuite un interrupteur interne :
`MoonBrush.LateUpdate`, `MoonWalker.Update`, `MoonPrototypeVehicle.Update` / `FixedUpdate`,
`MoonDustStation.Update`, `MoonDepositIntake.Update`, et dans `MoonWorld` les `TryPurchase*`, `TryGet*Price`,
`TryBuild*`, `TryBuyVehicle`, `TryUpgradeVehicle`, `TryPayTeleport`, `PaySection`, `CreditLaunch`.
On le voit aussi écrire brièvement `Item.width × 5` dans la fiche du véhicule. Ne pas cumuler Wand et Pimplay
sur les mêmes valeurs.

## Offsets relevés

| Objet | Champ | Offset |
|---|---|---|
| `MoonWalker` | `<EquipmentSpeedMultiplier>` / `<Flying>` / `<FlySpeed>` / `<DevSpeedMultiplier>` / `<BoostsLeft>` | +0xbc / +0xc8 / +0xcc / +0xd0 / +0xe4 |
| `MoonSettings` | `gravity` / `runSpeed` / `jumpHeight` / `inventoryCapacityKg` / `dollarsPerKilogram` | +0x10c / +0x110 / +0x114 / +0x14c / +0x150 |
| `MoonBrush` | `cleaningWidth` / `cleaningEdgeWidth` / `reach` | +0x68 / +0x70 / +0x7c |
| `MoonPrototypeEquipment` | `<Energy>` / `reserveEnergy` | +0x38 / +0xe4 |
| `MoonPrototypeVehicle` | `<Spec>` / `<IsDriven>` / `authored` / `<SpeedFactor>` / `<BoostFactor>` / `<Suction>` | +0x20 / +0x2c / +0x68 / +0x90 / +0x94 / +0x160 |
| `MoonAuthoredVehicleView` | `cleaningWidth` | +0x6c |
| `Item` (fiche véhicule) | `width` / `speed` / `capacity` | +0x24 / +0x30 / +0x38 |
| `MoonWorld` | `wallets` (`TeamWallet`, `Balance` à +0x10) | +0x538 |
