# Zadání pro ChatGPT: 300 modelů prostředí pro Potatofield

Zkopíruj celý blok mezi čarami do ChatGPT. Pošli ho ve stejném vlákně, kde vznikla referenční sada
(FPS_Reference), ať může navázat na svůj generátor v Blenderu.

---

Navazujeme na tvoji referenční sadu **FPS_Reference** (fasáda s výklenky, dveře, chodník, bedna, jersey
bariéra, vrak sedanu). Geometrie i měřítko jsou dobré. Teď potřebuji **300 modelů prostředí** pro
prohlížečovou multiplayerovou FPS ve stylu **Battlefield 2 (blízkovýchodní město, vesnice, vojenské
objekty)**. Běží v Three.js na běžných noteboocích, server je Node.js. Nejde o filmové rendery, ale
o hratelné modely: hráč je musí číst na 5 i 300 m a musí se za nimi dát krýt.

## 0. Co musíš změnit oproti referenční sadě (povinné)

1. **Žádné vložené textury v GLB.** Šest referenčních souborů má 27 MB, protože každý nese vlastní kopie
   textur 512×512. Při 300 modelech by to byl 1 GB. Model nese **jen geometrii, UV a pojmenované
   materiály** z mého seznamu (oddíl 3). Textury dodá hra (má vlastní procedurální textury, rozpití,
   prach a variace).
2. **Rozpočty trojúhelníků** (oddíl 4). Bedna se 7 120 trojúhelníky je pro web desetkrát víc, než
   unese mapa se stovkami beden. Úkos hran (bevel) jen 1 segment a jen tam, kde je vidět. Malé
   rekvizity úkos nemají.
3. **Kolizní tvary** u každého modelu (oddíl 5). Bez nich se model ve hře nedá použít.
4. **LOD** (oddíl 4): u všeho většího než 2 m dodej `LOD1` (a u budov i `LOD2`).
5. **Sklo**: okna jsou buď **otevřený otvor** (průstřelný a průchozí), nebo tenká výplň materiálu
   `glass`. Žádná tmavá neprůhledná deska.

## 1. Formát a souřadnice

- **GLB 2.0**, jednotky **metry**, osa **Y nahoru**, **přední strana k −Z** (hráč stojí před objektem
  na straně −Z a dívá se k +Z).
- **Počátek**: střed půdorysu na úrovni země (y = 0). Výjimka: doplňky na zeď (klimatizace, markýza,
  cedule, okenice, satelit…) mají počátek **na zadní ploše, kterou se dotýkají zdi**, a záda ke +Z.
- **Rotace a měřítko aplikované** (žádný scale na uzlech), žádné kamery ani světla.
- Uzly v GLB přesně takto:
  - `LOD0`: hlavní mesh (může mít víc primitiv po materiálech),
  - `LOD1`, `LOD2`: zjednodušené verze (podle oddílu 4),
  - `COL_*`: kolizní kvádry (viz oddíl 5). Mají materiál `collision`, ve hře se nekreslí.
- **UV ve světových metrech**: 1 jednotka UV = 1 m (stejně jako v referenci, ať se textury nenatahují).
  Druhé UV (`TEXCOORD_1`) nepotřebuji.
- Volitelně **barvy vrcholů** (`COLOR_0`) jen pro zapečené stínění koutů a špínu (stupně šedi). Žádné
  barevné kreslení přes vrcholy.

## 2. Ke každému modelu doplňkový JSON (stejné jméno, `.json`)

Server hry Three.js nemá, kolize a herní údaje čte z JSONu:

```json
{
  "id": "res_house_2f_courtyard_a",
  "label_cs": "Dům se dvorem, 2 patra (A)",
  "category": "buildings_residential",
  "footprint_m": [10.0, 8.0],
  "height_m": 6.6,
  "triangles": { "LOD0": 9800, "LOD1": 3100, "LOD2": 600 },
  "materials": ["plasterWarm", "concreteLight", "woodDark", "metal", "glass"],
  "collision": [
    { "center": [0, 1.45, -3.9], "size": [10, 2.9, 0.3], "rotY": 0, "surface": "plaster" },
    { "center": [0, 3.0, 0], "size": [10, 0.22, 8], "rotY": 0, "surface": "concrete" }
  ],
  "walkable_roof": true,
  "ladders": [{ "base": [4.6, 0, 3.6], "height": 6.4, "facing_deg": 180 }],
  "entrances": [{ "pos": [0, 0, -4], "width": 1.1, "height": 2.2, "recess_depth": 1.4 }],
  "cover_heights": [1.0, 1.8],
  "mount": null,
  "variants_of": null
}
```

- `mount`: `null` | `"wall"` (lepí se na zeď) | `"top"` (lepí se na střechu/plochu).
- `surface` v kolizi: `concrete | plaster | brick | metal | wood | sand | dirt | asphalt | fabric`
  (zvuky a efekty zásahů).
- Kolize je nanejvýš **24 kvádrů** u budov a **6** u rekvizit. Ploty a pletiva mají navíc příznak
  `"moveOnly": true` (střely projdou), plachty a markýzy `"bulletOnly": true` (hráč projde, střela ne).

## 3. Povolené názvy materiálů (přesně tyto)

`concrete, concreteLight, concreteDark, plaster, plasterWarm, plasterWhite, plasterOchre, brick,
sandstone, stoneWall, paving, plazaTile, asphalt, dirt, sand, wood, woodDark, metal, paintedMetal,
paintedMetalBlue, paintedMetalRed, metalSheet, metalSheetRust, burntMetal, shutter, roof, glass,
rubber, fabricSand, hescoFill, chainLink (alfa), awningRed, awningBlue, awningGreen, awningSand,
containerRed, containerBlue, containerGreen, containerSand, acUnit, lamp, water, bark, palmBark,
rock, rockWarm, leafOlive (alfa), leafGreen (alfa), leafDry (alfa), palmFrond (alfa), collision`

Alfa materiály (listí, pletivo) jsou **oboustranné ploché karty**, žádná modelovaná pletiva ani listy.

## 4. Rozpočty a LOD

| Kategorie | LOD0 max. trojúhelníků | LOD1 | LOD2 |
|---|---|---|---|
| Malá rekvizita (< 1 m) | 300 | – | – |
| Rekvizita / kryt (1–3 m) | 1 200 | 400 (nad 2 m) | – |
| Vrak vozidla | 4 000 | 1 200 | 300 |
| Stavební modul (fasáda, roh) | 4 000 | 1 200 | 250 |
| Celá budova | 12 000 | 3 500 | 600 |
| Strom / palma | 2 500 (karty listí) | 800 | 2 křížené karty |

- LOD1 = stejná silueta, bez drobností (kliky, šrouby, lišty pod 5 cm). LOD2 = krabice se správnou
  siluetou a otvory dveří.
- **Žádné skryté stěny navíc** (vnitřní strany, které nikdo neuvidí, vynech).

## 5. Pravidla hratelnosti (nejdůležitější)

Postava: výška **1,80 m**, poloměr **0,30 m**, v podřepu 1,20 m, vleže 0,45 m. Výška očí ve stoje 1,65 m.

- **Dveře a průchody**: světlost min. **1,10 × 2,20 m**. Dveře jsou **otevřený otvor** (případně
  dveřní křídlo otevřené o 90° jako samostatný uzel `DOOR_*`). Žádné zavřené dveře, které nejdou projít.
- **Zapuštěné vchody (výklenky)**: u části budov (ve výčtu označené **[výklenek]**) je vchod zapuštěný
  **1,2–2,0 m** do hmoty domu, široký **1,4–2,5 m**. Voják se v něm musí schovat celý (ve stoje
  i v podřepu) a z ulice ho z boku nesmí být vidět. Boční stěny výklenku jsou plné a průstřel nemají.
- **Podloubí a průjezdy**: světlá výška min. 2,6 m, sloupy 0,4–0,6 m (dají se použít jako kryt).
- **Okna**: parapet **0,9–1,1 m** nad podlahou (střelba vkleče přes parapet), otvor min. 0,8 × 1,0 m.
  Část oken v přízemí zamřížovaná (průstřel ano, průchod ne – kolize `moveOnly`).
- **Tloušťka zdí** 0,25–0,5 m (rozpoznatelná v ostění). Žádné „papírové“ stěny.
- **Schody** výška stupně 0,15–0,19 m, hloubka 0,28–0,32 m, šířka min. 1,0 m. Do kolize dej **jeden
  šikmý kvádr (rampu)** místo jednotlivých stupňů.
- **Pochozí střechy** s atikou **0,9–1,1 m** (kryt vkleče). Přístup schody, žebříkem (v JSONu
  `ladders`) nebo z vedlejší střechy.
- **Kryty**: nízký kryt **0,9–1,2 m** (vkleče), vysoký **1,8–2,2 m** (ve stoje). Do JSONu
  `cover_heights`.
- **Interiéry**: celé budovy mají vnitřek s podlahou a aspoň minimem nábytku (stůl, police, matrace)
  z rekvizit níže. Žádné pokoje-krabice bez otvorů.
- **Žádné pasti**: mezery 0,3–0,7 m, kam hráč zapadne a nedostane se ven, ani hrany, o které se
  zasekne (malé schody do 0,35 m hráč vyjde sám).
- **Čitelnost na dálku**: výrazná silueta, tmavší otvory, světlejší okraje (lišty, parapety).

## 6. Styl

- Inspirace: pouštní blízkovýchodní město a vesnice z Battlefield 2 (prašné omítky, ploché střechy
  s nádržemi na vodu, dvory se zdmi, palmy, olivovníky, cihly, beton, rezavý plech), plus vojenské
  objekty (HESCO, pytle s pískem, kontrolní stanoviště).
- **Vlastní tvorba**: nic převzatého z BF2 ani jiné hry, žádná loga, značky aut, skutečné nápisy firem
  ani ochranné známky. Nápisy jen jako prázdné cedule (text dodá hra).
- Opotřebení: odprýsknutá omítka a ulomené rohy **jako geometrie** jen tam, kde to mění siluetu.
  Jinak to řeší textura hry.
- Varianty: u každého typu budovy a krytu **čistá / poškozená** (díry po zásazích, zřícený roh,
  utržená markýza). Poškozená verze má upravenou kolizi.

## 7. Seznam 300 modelů (11 kategorií)

Formát: `ID-předpona – popis ×počet`. Varianty A/B/C se liší tvarem, ne jen materiálem.

### A. Obytné budovy, celé a přístupné (30)
- `res_house_1f` přízemní dům s plochou střechou, nádrží a schody na střechu ×4 (A–D, 1 [výklenek])
- `res_house_2f` dvoupatrový dům s terasou ×5 (2 [výklenek], 1 s podloubím)
- `res_house_courtyard` dům se dvorem a zdí, brána do dvora ×4
- `res_apartment_3f` činžák 3 patra, balkony, schodiště uvnitř ×4 (2 [výklenek])
- `res_apartment_5f` činžák 5 pater s průjezdem do dvora ×2
- `res_corner` rohový dům (2 ulice), obchod v přízemí ×3 ([výklenek] na rohu)
- `res_mud_house` vesnický hliněný dům s malými okny ×4
- `res_villa` větší vila s plochou střechou a vnitřním dvorem ×2
- poškozené varianty: `res_house_2f_damaged`, `res_apartment_3f_damaged` ×2 (zřícený roh, díra ve
  stěně průchozí 1,2 m)

### B. Stavební moduly pro skládání budov (30)
- `mod_facade` fasáda 4 m a 8 m: okna, dveře, výloha, slepá ×8
- `mod_facade_recess` fasáda se zapuštěným vchodem [výklenek] 1,5 m a 2 m hluboká ×4
- `mod_corner_out/in` vnější a vnitřní roh ×4
- `mod_gable` štítová / slepá stěna s požární zdí ×2
- `mod_roof_flat` deska střechy s atikou 4×4 a 4×8 m ×3
- `mod_roof_props` střešní nástavba (výstup na střechu se dveřmi) ×2
- `mod_stairs_ext` venkovní schodiště podél zdi 1 a 2 patra ×3
- `mod_balcony` balkon se zábradlím (zděné / kovové) ×2
- `mod_arcade` podloubí 4 m (3 oblouky / sloupy) ×2

### C. Vstupy, výklenky a průchody (25)
- `entry_recess_arch` klenutý zapuštěný vchod 1,4–2 m hluboký ×4
- `entry_recess_square` pravoúhlý zapuštěný vchod se schodkem ×4
- `entry_gate_courtyard` brána do dvora (vrata otevřená) ×4
- `entry_passage` průjezd domem (tunel 3×3 m, délka 6 m) ×3
- `entry_shop_shutter` vchod obchodu s napůl staženou roletou (pod ní se dá podlézt vleže) ×3
- `entry_basement` vstup do sklepa (schody dolů, kryté stěnami) ×3
- `entry_stair_porch` krytá veranda se schody ×2
- `entry_breach` vybouraný otvor ve zdi (zubatý okraj, suť) ×2

### D. Obchody a městská vybavenost (20)
- `shop_stall` tržní stánek s plachtou ×4
- `shop_kiosk` kiosek / budka prodavače ×2
- `shop_cafe_front` kavárna s posezením ×2
- `shop_garage` dílna s otevřenými vraty ×2
- `gas_station` čerpací stanice: přístřešek, stojany, budova ×3 (části)
- `mosque_like_tower` věž (bez náboženských symbolů) a kupole jako dominanta ×2
- `school_block` škola / úřad (dlouhá budova, chodba) ×2
- `market_hall` tržnice se střechou na sloupech ×3

### E. Průmysl a vojenské (30)
- `ind_warehouse` sklad z vlnitého plechu (vrata, vnitřek s regály) ×3
- `ind_hangar` hangár (obloukový) ×2
- `ind_silo` silo / vodojem se žebříkem ×3
- `ind_tank_farm` nádrže na palivo s potrubím ×2
- `ind_pipe_rack` potrubní most ×2
- `ind_crane` portálový jeřáb (statický) ×1
- `mil_checkpoint` kontrolní stanoviště (budka, závora, pytle) ×3
- `mil_guard_tower` strážní věž dřevěná / betonová se žebříkem ×3
- `mil_bunker` bunkr se střílnou ×3
- `mil_hesco_wall` HESCO stěna rovná / roh / s průchodem ×4
- `mil_tent` vojenský stan (plachta bulletOnly) ×2
- `mil_radio_mast` anténní stožár s kotvením ×2

### F. Zdi, ploty a brány (25)
- `wall_courtyard` dvorní zeď s pilíři 4 m modul, rovná / roh / s bránou ×5
- `wall_courtyard_broken` rozbitá dvorní zeď (proražení, sesutí) ×3
- `wall_stone_dry` kamenná zídka nasucho 4 m, rovná / roh / zbořená ×3
- `wall_concrete_t` betonová T-stěna (vojenská) ×2
- `fence_chainlink` pletivo s ostnatým drátem, rovné / roh / brána ×3
- `fence_metal_sheet` plot z plechu ×2
- `fence_wood` dřevěný plot ×2
- `rail_metal` kovové zábradlí 2 m ×2
- `gate_sliding` posuvná brána (otevřená) ×3

### G. Kryty a barikády (30)
- `cover_sandbags` pytle s pískem: rovné 2 m, oblouk, stanoviště U, kulometné hnízdo ×6
- `cover_jersey` jersey bariéra: rovná, poškozená, s plotem nahoře ×3
- `cover_block` betonové bloky a kostky ×3
- `cover_hedgehog` protitankový ježek ×2
- `cover_rubble` hromady sutě s armaturou (malá, velká, zeď) ×4
- `cover_barricade_car` barikáda z převrácených aut a pneumatik ×2
- `cover_barricade_furniture` barikáda z nábytku a dveří ×2
- `cover_pipe` betonové roury (průlezné) ×2
- `cover_crate_stack` stoh beden (2–3 výšky) ×3
- `cover_tire_wall` zeď z pneumatik ×1
- `cover_dirt_berm` hliněný val (nízký, vysoký) ×2

### H. Vraky vozidel (statické) (20)
- `wreck_sedan` sedan: ohořelý / opuštěný / převrácený ×3
- `wreck_hatch` malé auto ×2
- `wreck_pickup` pickup (s korbou, bez korby) ×2
- `wreck_van` dodávka ×2
- `wreck_bus` autobus (dá se projít uvnitř) ×1
- `wreck_truck` nákladní auto s plachtou ×2
- `wreck_tanker` cisterna ×1
- `wreck_tank` vrak tanku (věž odtržená) ×2
- `wreck_apc` vrak obrněného transportéru ×2
- `wreck_heli` vrak vrtulníku ×1
- `wreck_moto` motorka, kolo ×2

### I. Uliční mobiliář a doplňky na budovy (35)
- `street_lamp` lampa: jedno a dvě ramena ×2
- `street_pole_power` sloup vedení dřevo / beton ×2
- `street_sign_road` směrová tabule (prázdná) ×2
- `street_sign_small` dopravní značky (tvary bez symbolů) ×3
- `street_bench` lavička ×2
- `street_bin` koš, kontejner na odpad ×3
- `street_phone` telefonní budka ×1
- `street_bus_stop` zastávka s přístřeškem ×1
- `street_hydrant`, `street_bollard` hydrant, sloupky ×2
- `street_planter` květináče (s rostlinou je kategorie K) ×2
- `wall_ac` klimatizace (mount wall) ×2
- `wall_awning` markýza rovná / šikmá / utržená (mount wall) ×3
- `wall_shutters` okenice (mount wall) ×2
- `wall_dish` satelitní parabola (mount wall) ×1
- `wall_sign_blank` cedule obchodu prázdná (mount wall) ×2
- `wall_cable_bundle` svazek kabelů a krabice (mount wall) ×1
- `roof_tank` nádrž na vodu na nohách (mount top) ×2
- `roof_antenna` anténa, solární panel (mount top) ×2
- `roof_clothesline` sušák na prádlo s látkou (bulletOnly) ×1

### J. Rekvizity a interiér (30)
- `prop_crate` bedny: malá, velká, vojenská s municí, otevřená ×5
- `prop_barrel` sudy: kov, plast, ležící, prostřelený ×4
- `prop_pallet` palety a stoh palet ×2
- `prop_tires` pneumatiky (stoh, jednotlivá) ×2
- `prop_jerrycan` kanystry, plynové lahve ×2
- `prop_sack` pytle s moukou / cementem ×1
- `int_table`, `int_chair` stůl, židle (plast / dřevo) ×3
- `int_shelf` regál, skříň ×2
- `int_bed` postel, matrace na zemi ×2
- `int_sofa` gauč, koberec (plochý) ×2
- `int_fridge_stove` lednice, sporák ×2
- `int_tv_radio` televize, rádio, krabice ×2
- `int_rubble_floor` suť a papíry na podlaze (ploché) ×1

### K. Příroda (25)
- `tree_palm` datlová palma: 6, 9, 12 m, nakloněná, pahýl ×5
- `tree_olive` olivovník malý / velký ×3
- `tree_acacia` akácie / deštníkovitý strom ×2
- `tree_dead` suchý strom ×1
- `bush` keř zelený / šedozelený / suchý ×4
- `plant_cycad` nízká palma / agáve ×2
- `grass_tuft` trsy trávy (karty) ×2
- `rock` balvany 1 m, 2,5 m, 5 m ×3
- `rock_cliff` skalní stěna (modul 8 m) ×2
- `planter_palm` palma v květináči ×1

Součet: 30 + 30 + 25 + 20 + 30 + 25 + 30 + 20 + 35 + 30 + 25 = **300**.

## 8. Dodání po dávkách

Neposílej všech 300 naráz. Dodávej **po dávkách cca 30 modelů**:

1. ZIP s `*.glb` + `*.json` + **`manifest.json`** (seznam, kategorie, počty trojúhelníků po LOD,
   velikost souborů).
2. **Kontaktní list** (PNG) každého modelu: pohled zepředu, ze 3/4 a **z očí hráče 1,65 m ve
   vzdálenosti 3 m**, u budov i pohled do výklenku a do interiéru.
3. **Kontrolní skript** (Python pro Blender), který u každého souboru ověří: metry, Y nahoru, počátek
   u země, přední strana −Z, rozpočet trojúhelníků, povolené názvy materiálů, existenci `COL_*`,
   světlost dveří ≥ 1,10 × 2,20 m a hloubku výklenků. Výsledek přilož jako `validation.txt`.
4. Zdrojový generátor (`.py` pro Blender), ať jde model upravit parametry.

**První dávka (pilot):** `res_house_2f` ×2 (1 s výklenkem), `mod_facade_recess` ×2,
`entry_recess_arch` ×2, `cover_sandbags` ×3, `wall_courtyard` ×3, `wreck_pickup` ×1, `wall_ac` ×1,
`roof_tank` ×1, `tree_palm` ×2, `prop_crate` ×3, `bush` ×2. To je 22 modelů. Po schválení pilotu
pokračuj zbytkem.

Licence: modely jsou tvoje vlastní tvorba vytvořená pro mě a převádím je do svého projektu pod
licencí CC0. Nesmí obsahovat převzaté části.

Nevymýšlej, že je něco hotové nebo ověřené, když není: co jsi nevyrenderoval nebo neověřil
skriptem, označ jako „neověřeno“.

---

## Pozn. pro mě (Claude): co bude potřeba udělat ve hře před zapojením

- Nový typ assetu „model GLB“: klient načte GLB (sdílené procedurální materiály podle názvů, LOD),
  server a editor čtou kolize a údaje z JSONu.
- Editor: náhledy, kategorie, přilepování (`mount`), žebříky z JSONu.
- Úložiště: modely do `public/models/` (malé, bez textur). Při 300 modelech je potřeba líné
  načítání jen těch, které mapa používá.
