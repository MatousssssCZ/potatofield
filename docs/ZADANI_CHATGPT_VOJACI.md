# Zadání pro ChatGPT: uniformy a výstroj vojáků (Potatofield)

> Tento text zkopíruj celý do ChatGPT. Výstupy (PNG + TypeScript) pak vlož do repa podle sekce „Předání“.

---

Jsi technický 3D/2D artist a TypeScript vývojář. Pracuješ pro malou webovou FPS **Potatofield** (Three.js 0.186, WebGL2, TypeScript). Hra se inspiruje atmosférou Battlefieldu 2 (poušť, střední východ, realistický, ale čitelný styl). Rozpočet je nulový a vše musí být **vlastní původní dílo**. Potřebuji od tebe uniformy, insignie a výstroj vojáků.

## 1. Právní pravidla (závazná)

- Žádné převzaté assety, loga, ikony, textury ani vzory z Battlefieldu ani z jiných her.
- Žádné skutečné vojenské vzory 1:1 (MARPAT, DCU, Multicam, Flecktarn …), žádné skutečné státní vlajky, hodnosti, znaky jednotek ani texty skutečných armád. Inspirace typem vzoru (digitální / skvrnitý) je v pořádku, konkrétní vzor musí být tvůj.
- Frakce jsou fiktivní: **Falcon Corps** (id `usmc`, modrá identifikační barva `#2f5d9a`) a **Dune League** (id `mec`, červená `#b2392e`). Třetí frakce **Jade Pact** (id `pla`) je volitelná.
- Výstupy předáš jako vlastní dílo s licencí **CC0** (veřejná doména), uveď to na konci odpovědi.

## 2. Jak voják technicky funguje (musíš dodržet)

- **Tělo**: skinovaný model Mannequin (Quaternius Universal Animation Library, CC0). Na tělo se kamufláž nanáší v shaderu **triplanárně v klidové póze** (nemá použitelné UV pro atlas). Proto potřebuji **bezešvé (tileable) dlaždice**, ne UV atlas.
- **Výstroj** (helma, vesta, sumky, batohy, doplňky): procedurální geometrie z kódu, navázaná pevně na kosti. Píše se jako TypeScript funkce nad třídou `Builder` (API níže). Barva = barva vrcholů (žádné textury na výstroji).
- Souřadnice: metry, **Y nahoru, voják hledí k −Z**, levá strana je −X. Klidová póza „I“ (paže podél těla). Výška ~1,80 m s helmou.
- Výstroj na **nohách** (stehna, holeně, chodidla) se nad Mannequinem zatím nekreslí → nepoužívej kosti `thigh*`, `shin*`, `foot*` (kromě pasu/opasku na `pelvis`).

### Kosti a jejich klidová poloha (světové souřadnice, m)

| kost | x | y | z |
|---|---|---|---|
| pelvis | 0 | 0.96 | 0 |
| spine1 | 0 | 1.08 | 0 |
| spine2 | 0 | 1.24 | 0 |
| neck | 0 | 1.44 | 0 |
| head | 0 | 1.53 | 0 (střed lebky `headC` = 0, 1.635, −0.005) |
| clavL / clavR | ∓0.03 | 1.39 | 0 |
| upperArmL / R (rameno) | ∓0.19 | 1.39 | 0 |
| lowerArmL / R (loket) | ∓0.19 | 1.11 | 0 |
| handL / R (zápěstí) | ∓0.19 | 0.86 | 0 |

Obrys trupu (elipsa, poloosy rx do stran, rz dopředu/dozadu): y 0.95 → rx 0.165, rz 0.105; y 1.15 → 0.158 / 0.10; y 1.33 → 0.185 / 0.115; y 1.44 → 0.13 / 0.085. Vesta má sedět ~1–2 cm nad tímto povrchem. Hlava: elipsoid kolem `headC` s poloosami 0.083 × 0.108 × 0.098; helma ~0.118 × 0.12 × 0.13.

### API `Builder` (to je vše, co smíš volat)

```ts
type W = Array<[BoneName, number]>; // vlivy kostí, součet vah libovolný (normalizuje se), max 4
// m = 1 vždy (materiál výstroje). Barvy jako hex string '#rrggbb'.
B.box(1, center: THREE.Vector3, size: [sx, sy, sz], color, w: W, rot?: THREE.Euler);
B.ellipsoid(1, center, [rx, ry, rz], segU, segV, color | ((p: Vector3) => Color), w: W, thetaMax = Math.PI);
//   thetaMax < PI = jen horní část (např. Math.PI * 0.52 pro skořepinu helmy)
B.profile(1, rings: Array<{ y, rx, rz, cx, cz }>, seg, color, w: W | ((p) => W), null, capTop?, capBottom?);
//   svislý „tubus“ z elips – vesta, opasek, láhev, límec. Prstence seřazené podle y.
```

Kontext funkce, kterou napíšeš:

```ts
type SoldierFaction = 'usmc' | 'mec';
type Kit = 'assault' | 'medic' | 'support' | 'engineer' | 'sniper';
interface LodSpec { seg: number; detail: number } // LOD0 {18,1}, LOD1 {10,0.35}, LOD2 {6,0}
export function gearV2(B: Builder, faction: SoldierFaction, kit: Kit, lod: LodSpec, headC: THREE.Vector3): void
```

- `lod.detail === 0` (LOD2, voják daleko): jen hlavní obrys – helma/pokrývka, vesta, batoh. Drobnosti (spony, antény, granáty, nášivky) jen pro `detail > 0`.
- Rozpočet trojúhelníků **jen výstroje**: LOD0 ≤ 2 500, LOD1 ≤ 1 000, LOD2 ≤ 300. Na konci odpovědi uveď odhad pro každý kit.
- Kód deterministický (žádné `Math.random`; pokud potřebuješ náhodu, napiš si malý seedovaný generátor podle frakce a kitu).
- Neprůhledná geometrie, žádné průhledné listy, žádné tenké plochy bez tloušťky (min. 4 mm).

## 3. Co přesně chci

### A) Kamufláž – bezešvé dlaždice (PNG)

Pro každou frakci **2 dlaždice**: blůza (`shirt`) a kalhoty (`pants`) – mohou se lišit odstínem.

- 512 × 512 px, sRGB, **bezešvé ve všech směrech** (ověř posunem o polovinu), dlaždice pokrývá cca **0,6 × 0,6 m** látky (podle toho volíš velikost skvrn).
- **Falcon Corps**: pouštní digitální (pixelový) vzor ve 3–4 odstínech béžové/písku/hnědé, střední kontrast, čitelný na 50 m jako „světlá béžová“.
- **Dune League**: měkké organické skvrny, olivová / hnědá / tmavě zelenohnědá, tmavší celkový tón než Falcon Corps (frakce se musí rozlišit siluetou i jasem).
- Jemná textura tkaniny a lehké sešednutí, **žádné** zapečené světlo/stíny, žádné švy, kapsy ani text.
- Navíc ke každé dlaždici odpovídající **roughness** mapu (šedotón, 512 × 512, bezešvá) – volitelné.
- Přilož k nim **paletu** (hex kódy použitých barev) jako JSON.

### B) Insignie a nášivky (PNG s alfa kanálem)

- Znak každé frakce, 256 × 256 px, průhledné pozadí, plochý styl (2–3 barvy, silné tvary, čitelné i v 32 px). Falcon Corps: stylizovaný sokol/křídlo, Dune League: stylizovaná duna/srpek/hvězda – vlastní tvar, nepodobný skutečným znakům.
- Rameno: obdélníková nášivka frakce 256 × 160 px (barva frakce + znak).
- Červený kříž ani červený půlměsíc **nepoužívej** (chráněné znaky). Navrhni vlastní neutrální symbol zdravotníka (např. stylizované srdce nebo lékárnička v barvě frakce), nepodobný reálným značkám.
- Každý obrázek dodej jako PNG + krátký popis, kde na vojákovi má být.

### C) Výstroj podle frakce a kitu (TypeScript `gearV2`)

Siluety musí jít rozlišit **na 30–50 m** (to je hlavní herní účel – hráč pozná třídu a stranu nepřítele):

| kit | Falcon Corps | Dune League |
|---|---|---|
| assault | helma s brýlemi, plná vesta, 3 sumky zásobníků na hrudi, 2 granáty | helma s krytem zátylku, hrudní nosič (chest rig), bandalír přes rameno |
| medic | helma s potahem, malý batoh se symbolem zdravotníka, brašna na boku | měkká čepice/šátek, velký brašnový batoh |
| support | helma, vesta, **velký box na munici / kulometná sumka** na břiše, pás nábojů | baret nebo šátek, pás nábojů přes hruď, velká sumka |
| engineer | helma, vesta, **batoh s nářadím** (klíč/rýč přes záda), kleště na opasku | kšiltovka nebo šátek, plátěná taška přes rameno, nářadí |
| sniper | lehká kapuce/hejkal na ramenou, minimum výstroje, dalekohled na hrudi | šátek přes obličej, lehký chest rig, dalekohled |

Pro všechny: opasek s polní láhví, rukavice ladí s frakcí (FC: písková, DL: tmavá), nášivka frakce na levém rameni (jen barevný blok – textury na výstroji nejsou), u FC rádio + krátká anténa u velitelských kitů (assault, support).

Barvy výstroje drž v jedné paletě na frakci (FC: coyote / olivová `#5c5f3d` až pískové tóny; DL: hnědé a olivové `#3f3527`, `#4b3d2c`), aby voják nepůsobil jako vánoční stromeček.

### D) Volitelné (pokud zbude místo)

- 3 varianty obličejové pokrývky (balaklava, šátek, brýle) jako samostatné funkce `headwear(B, faction, variant, lod, headC)`.
- Návrh **špíny a opotřebení**: popiš v GLSL (fragment shader, vstup `vec3 vCamoP` = klidová poloha v metrech, výstup úprava `diffuseColor.rgb`) – prach od kolen dolů, tmavší lokty/kolena, vybledlá ramena od slunce. Max 25 řádků, bez textur.

## 4. Předání (formát odpovědi)

1. Seznam souborů s názvy přesně takto:
   - `public/textures/soldier/fc_shirt.png`, `fc_pants.png`, `dl_shirt.png`, `dl_pants.png` (+ `_rough.png` volitelně)
   - `public/textures/soldier/fc_emblem.png`, `dl_emblem.png`, `fc_patch.png`, `dl_patch.png`, `medic_symbol.png`
   - `public/textures/soldier/palette.json`
   - `src/client/render/soldier/gearV2.ts` (exportuje `gearV2`, importuje jen `three` a typy `Builder`, `LodSpec`, `SoldierFaction`, `BoneName` z `./body` a `./rig`)
2. Celý kód `gearV2.ts` v jednom bloku, bez zkratek „…“ a bez TODO.
3. Tabulka: kit × LOD → odhad trojúhelníků výstroje.
4. Prohlášení licence: „Vše výše je mé původní dílo, uvolňuji ho jako CC0.“
5. Seznam věcí, které jsi **neudělal** nebo si jimi nejsi jistý (poctivě).

## 5. Akceptační kritéria (podle nich to zkontroluji)

- Dlaždice jsou bezešvé a na vojákovi z 50 m odliší frakci jasem i barvou.
- Na snímku z 30 m (bez jmenovek) lze poznat kit: assault / medic / support / engineer / sniper.
- `gearV2.ts` projde `tsc --noEmit` bez chyb, nevolá nic mimo API výše a nepřekročí rozpočty trojúhelníků.
- Nic nepřipomíná konkrétní existující herní ani vojenskou grafiku.
