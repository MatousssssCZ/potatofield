# Skladová osada: audit, návrh integrace a stav

Zadání: `Potatofield_Skladova_osada_Claude.md` (verze 1.0, 12. 11. 2026), 84 typů objektů, parametrický editor a mapa.
Tento dokument je deník rozhodnutí a stavu podle etap zadání (§11). **Hotové jsou etapy 1, 2 a hlavní část etapy 3 (zbytek etapy 3 je vypsaný v §4). Etapy 4–8 hotové nejsou.**

## 1. Audit existujícího projektu (etapa 1)

Co už v repozitáři je a na co se navazuje (nic z toho se nepřepisuje):

| Oblast | Stav v projektu | Využití pro osadu |
|---|---|---|
| Stack | TypeScript, Vite, Three 0.186, Rapier (klient i server), vitest, Playwright | beze změny |
| Generátory | `src/world/registry.ts` `registerAsset`: parametry (number/int/enum/bool/string/points), `generate(p, seed, material, ctx) → Part[]`; z dílů se odvozuje render i kolize (stejně na serveru) | nové typy jsou běžné assety v kategorii `osada` |
| Kolize | díly s `collide`, `moveOnly` (střely projdou), `bulletOnly`, `render:false`; konvexní obaly pro blob/wedge | profil pohyb / střely / vzhled zvlášť (zadání §3) |
| UV | v metrech, dělené dlaždicí materiálu (`client/render/geometry.ts`) | prodloužení domu nezvětší omítku ani cihly |
| Mapa | `docs/MAP_FORMAT.md`, `schemaVersion 1`: objekty s `id`, `assetId`, `generatorVersion`, `seed`, `params`, `material`, `editor.{group,locked,hidden,name}` | parametry jsou autoritativní, trojúhelníky se neukládají |
| Herní data | `controlPoints` (vlajky, válec zabírání), `spawnPoints` (tým, vazba na vlajku), `zones`, `scenarios`, `testSpawn` | **G02 = controlPoint, G03 = spawnPoint** – existující, nové typy nevznikají |
| Editor | katalog s hledáním a kategoriemi a náhledy, vlastnosti vpravo, undo/redo (příkazy, jedno tažení = jeden krok), G/R/S, Alt vypne přichytávání, mřížka 0,25/0,5/1 (stavový řádek), magnet budov, rozměrové úchopy, kreslení tras (body, Enter/Esc/Backspace, „+“ přidá bod, Shift+klik smaže), terénní štětce, Kontrola s opravami, autosave + IndexedDB, import s validací (vadný soubor nepřepíše mapu), F5/Testovat s výběrem místa | vše se používá; doplněny **oblíbené** v katalogu |
| Silnice | `street.roadPath` (Catmull-Rom, chodníky, křižovatky řezem) | R01–R03 mají nový generátor `osada.road`; staré ulice zůstávají |
| Ploty | `struct.fence`, `struct.wall` (rovné, délka jako parametr) | F01/F04 mají nový trasový `osada.fence` |
| Hráč | kapsle výška 1,8 m (stoj), poloměr 0,3 m; dřep/leh existují | testy průchodu používají skutečnou simulaci |
| AGENTS.md | v repozitáři **není** | — |

Chybí a bude se zakládat modulárně (etapy 3–6): graf silnic s ID uzlů/hran a úseky povrchů, graf plotů s větvením, půdorysy L/U, přepínač perspektiva/půdorys, debug vrstvy výhledů, skupiny v katalogu po typech zadání, galerie.

## 2. Rozhodnutí (zaznamenaná podle §14)

1. **Integrace, ne nový editor.** Všech 84 typů budou assety registru v kategorii `osada` (`src/world/assets/osada/`). Katalogové ID ze zadání (B01, R03 …) a český název drží `OSADA_META` a jsou v popisku položky.
2. **Datový model.** Entita ze zadání §9 odpovídá stávajícímu `MapObject`: `assetType` = `assetId`, `rotationY` = `transform.rotation[1]`, `materialPreset` = `material`. `overrides` zatím neexistují – ruční úpravy jsou parametry (např. zamčené dveře); pole se přidá s migrací schématu v etapě 5, až budou ruční okna. Schéma zůstává verze 1 (nové assety nevyžadují změnu formátu).
3. **Pivot budov = levý přední roh půdorysu** (x 0…délka, z 0…hloubka, čelo k −Z). Prodloužení nehýbe rohem ani dveřmi ukotvenými od levého rohu. Plot a cesta mají pivot v prvním uzlu, samostatné předměty uprostřed spodní plochy (zadání §3).
4. **Ukotvené otvory.** Dveře/vrata ukládají stěnu a vzdálenost středu od levého rohu (při pohledu zvenku). Nezamčené se přichytí ke středu nejbližšího fasádního pole, zamčené drží přesnou polohu. Nevejde-li se zamčený otvor na stěnu, **parametr se nemění**, otvor se dočasně vykreslí na nejbližší platné pozici a editor ukáže konflikt (`validate()` → varování ve vlastnostech). Nic se tiše nemaže.
5. **Fasádní pole.** Počet polí = zaokrouhlení délka / cílová šířka; okno 1,1 × 1,3 m (B21) a dveře 1,2 × 2,3 m (B19) mají pevnou velikost, okno v poli s dveřmi se vynechá.
6. **Uzavřené vs. průchozí budovy.** Uzavřený dům má pevné dveře (kolize), jako dosud BF2 budovy v projektu. Průchozí přízemí má otevřené přední i protilehlé dveře, podlahu a strop. Režim „přízemí s několika místnostmi“ je odložen do etapy 5.
7. **Střechy.** Dům: plochá střecha s atikou, nepřístupná (bez schodů/žebříku). Hala: sedlová, štíty jako klíny s pevnou kolizí, přesahy, hřebenáč; nepřístupná.
8. **Vrata haly.** Posuvná: zavřená = kolize v otvoru, otevřená = křídla odsunutá podél stěny (otvor bez kolize). Dynamické otevírání se nedělá (zadání §2).
9. **Plot.** Každý úsek mezi uzly má ⌈délka / rozteč⌉ stejně dlouhých polí; v každém uzlu (i sdíleném, i v uzavřeném okruhu) je právě jeden sloupek. Pletivo: rozteč nejvýš 2,5 m, výplň blokuje pohyb a propouští střely. Zeď: pilíře v uzlech kryjí rohy (žádné překryvy stěn). Svah: „kopírovat sklon“ nebo „stupňovat“ – stupňované pole sahá pod nižší konec (žádná mezera k podlezení, žádné natažené trojúhelníky).
10. **Cesta.** Povrch je parametr (asfalt, štěrk, hlína, beton, dlažba); krajnice s deterministicky zvlněným okrajem ze seedu. Výchozí sledování terénu bez jeho změny. Ostrá zatáčka (poloměr < polovina šířky) je hlášena jako konflikt. Segmentové povrchy, přechody, T/X uzly a terénní vrstva jsou etapa 3.
11. **Nový materiál `gravel`** (štěrk) – procedurální, ze stávající textury písku s jiným odstínem a měřítkem. Žádné externí assety, žádné licence k evidenci.
12. **Nasazení.** Push na `main` spouští GitHub Pages (veřejné nasazení). Zadání říká „Nenasazuj aplikaci veřejně bez samostatného pokynu“, proto **práce na osadě jde na větev `skladova-osada`**, která nasazení nespouští. Sloučení do `main` (= nasazení) až na pokyn.
13. **Graf cesty uvnitř objektu.** Každá cesta (`osada.road`) je řetěz uzlů se stabilními ID (`nodeIds`); úsek = hrana mezi sousedními uzly, identifikovaný ID počátečního uzlu. Křižovatky jsou spoje mezi objekty (`joins`: uzel vedlejší cesty leží v uzlu hlavní). Hlavní cesta prochází vcelku, vedlejší končí přesně na jejím okraji (rohy `endCut`) – společná plocha bez překryvů a děr. Globální RoadGraph jako samostatná struktura mapy by vyžadoval změnu schématu; tento tvar je zpětně kompatibilní a ID jsou stabilní.
14. **Úseky povrchu** se odkazují na {úsek, t} (+ metry `d`). Posun uzlu je nese poměrně (nebo drží metry, režim „Zachovat metry od uzlu“); vložení / smazání uzlu je přemapuje průmětem stejného místa na nové úseky téže větve. Normalizace: obrácený interval se otočí, prázdný a neplatný se vynechá, překryv se zkrátí – vždy s informací v panelu a v Kontrole.
15. **Přechody** jsou centrované na hranici, výchozí 2 m (0–8 m). Kus mezi dvěma přechody je dělí rovným dílem (přechod ≤ délka kusu), krajní kus dává až celou délku. Přechod je jeden pás s váhou 0 → 1 po délce, míchaný v jednom shaderu (barva, drsnost, AO i normály, UV ve světových metrech, maska ze světových souřadnic → při posunu uzlu textura neskáče). Pravidla dvojic (`transitionRule`): asfalt/beton ↔ hlína/štěrk/písek = rozpad hrany s prachem, beton ↔ dlažba a asfalt ↔ dlažba = spára s tmavým lemem, hlína ↔ štěrk ↔ písek = plynulá směs.
16. **Křížení.** Konec kreslené / tažené cesty u jiné cesty se napojí automaticky (vznikne uzel v hlavní cestě = T). Křížení uprostřed se samo nespojuje: Kontrola ho hlásí jako varování s opravou „Vytvořit křižovatku“ (X, ruční potvrzení). Cesty s rozdílem výšky pivotu > 1,5 m se jako křížení nehlásí ani nespojují.
17. **Formát:** `ranges`/`joins` (JSON) a `nodeIds` mají vlastní mez 20 000 znaků a validaci (MAP_FORMAT.md); ostatní texty zůstávají na 200 znacích.

## 3. Vertikální řez (etapa 2) – hotovo

| ID | Asset | Co umí |
|---|---|---|
| B01 | `osada.house` | délka 5–24, hloubka 4–14, výška, atika, tloušťka zdi, šířka pole; okna v polích (sklo / okenice / mříž / otevřené); dveře na zvolené stěně, ukotvené, zamykatelné, konflikty; uzavřený / průchozí; sokl, římsa, krycí deska, zapuštěná okna s parapety |
| B08 | `osada.hall` | délka 12–60, šířka 8–26, okap, sklon; konstrukční pole s pilastry, betonový sokl, plech/cihla, horní okna; vrata na zvolené stěně (ukotvená, zamykatelná, otevřená/zavřená), průjezd, boční dveře; vazníky uvnitř |
| R01/R03 | `osada.road` | trasa uzlů (Catmull-Rom), šířka 2,5–12, povrch, krajnice, nepravidelnost okraje, sledování terénu |
| F01/F04 | `osada.fence` | trasa uzlů, typ pletivo/zeď, výška, tloušťka, rozteč, svah kopírovat/stupňovat, uzavřený okruh |
| T05 | `osada.boulder` | velikost 1–3, plochost, zapuštění, hranatost; kolize = konvexní obal |
| G02/G03 | stávající vlajky a spawny | ve scéně bod A Náves a spawny obou týmů |

Testovací scéna: **Mapa → „Skladová osada · řez“** (`src/world/maps/osadaSlice.ts`, 128 × 128 m, svah na jihozápadě).

Ověřeno:
- `tests/osada.test.ts` (22 testů): determinismus ze seedu, konečná čísla, prodloužení domu 8 → 14 m přidá okna bez změny jejich velikosti, zamčené dveře drží vzdálenost, konflikt při zkrácení (parametr zachován), okna nekolidují s dveřmi a rohy, **průchod průchozím domem** a **průjezd halou** skutečnou simulací hráče, uzavřený dům a zavřená vrata neprojdou, jeden sloupek na uzel (i v okruhu), rovnoměrná pole, pletivo propustí střely a zastaví hráče, zeď blokuje obojí, stupňovaná zeď ve svahu bez mezery, ostrá zatáčka hlášena, uložení/načtení JSON dá stejná ID, seedy a geometrii.
- `scripts/osada-slice.mjs` (Playwright v reálném editoru): otevřít scénu, vložit B01, undo/redo vložení, změna délky 8 → 14 polem ve vlastnostech + undo/redo (jeden krok), uložení do úložiště prohlížeče a načtení beze změny dat, Testovat → hra běží, návrat do editoru se zachovanou editací, bez chyb stránky.
- Celá sada testů projektu: 1059 testů prošlo (`npx vitest run`), typová kontrola čistá.

Katalog: oblíbené položky (☆ na dlaždici, filtr „★ Oblíbené“, uloženo v prohlížeči).

Známé limity řezu:
- Balvan je oblá hmota bez výrazných faset; silueta T05/T06 se dopracuje v etapě 6.
- Hliněná cesta na písčitém terénu má malý kontrast (barevně správná, ale málo čitelná) – řeší se s materiálovými přechody v etapě 3.
- Náhledy v katalogu v headless prohlížeči (SwiftShader) zůstávají prázdné; v běžném prohlížeči se generují.
- Výkon zatím neměřen na cílovém notebooku (i5-1335U) – žádné tvrzení o FPS.

## 3b. Silnice (etapa 3) – hotovo

| Funkce | Kde | Ověření |
|---|---|---|
| uzly se stabilními ID, režim hladký / lomený (oblouky s poloměrem) / přímý | `osada/roadGraph.ts` `buildCurve`, `ensureIds` | testy, kontrola samopřekryvu |
| úseky povrchu {úsek, t}: panel (povrch, od–do v m, přechod, smazat, přidat), dvě značky v pohledu tažené po ose (0,5 m přichycení, Alt volně, popis délky u kurzoru), jedno tažení = jeden krok historie | `ui.ts` `roadPanel`, `editor.ts` (rangeMark) | `scripts/osada-roads.mjs` |
| přechody: automaticky na obou koncích, zkrácení u krátkého úseku s informací, žádné NaN / obrácené intervaly | `resolveSurfaces` | testy §12 |
| míchání povrchů v jednom shaderu (3 pravidla) | `render/materials.ts` `blendMaterial`, `geometry.ts` (`aBlend`) | snímky, bez chyb shaderu |
| vložení / smazání / posun uzlu přemapuje úseky a ID | `roadEditPoints` (hook `editPoints` v editoru) | testy |
| rozdělit v uzlu, spojit konce (i obráceně kreslené), větvit z uzlu, zrušit spoje | `osada/roadOps.ts`, panel „Uzly a spoje“ | testy + e2e |
| T: konec cesty u jiné cesty → uzel v hlavní cestě + spoj; posun uzlu hlavní cesty posune napojený konec | `snapEndToRoad`, `roadModel` | testy + e2e |
| X: Kontrola hlásí křížení bez křižovatky, oprava ji vytvoří; různé výšky se nespojují | `findCrossings`, `makeCrossing`, `app.ts` Kontrola | testy + e2e |
| varování generátorů (zamčené dveře, zkrácené přechody, neplatné úseky, ostré zatáčky, ztracené spoje) v Kontrole | `app.ts` | e2e |

Testy: `tests/osadaRoads.test.ts` (22 testů: souvislý povrch po posunu uzlu a změně šířky, prostřední asfalt → hlína, krátký úsek, normalizace intervalů, pravidla přechodů, přemapování po vložení/smazání uzlu, rozdělení + spojení, T s rohy na okraji hlavní cesty, posun uzlu hlavní cesty, X, výšky, větvení, validace formátu, uložení/načtení, 100× editace). E2E: `node scripts/osada-roads.mjs <url> [složka]` v reálném editoru – vše OK, bez chyb stránky a shaderu. Celkem 1081 testů projektu prošlo.

Známé limity etapy 3: cesta zatím jen sleduje terén (terénní vrstva chybí); šířka jen globální; plocha křižovatky se řeší po dvojicích (hlavní + vedlejší), uzel se 3+ cestami funguje, ale každá vedlejší se ořízne jen o hlavní; odtažení napojeného uzlu vedlejší cesty spoj zruší (záměrně, ať uzel neskáče zpět); krajnice hlavní cesty vede pod ústím vedlejší (o 12 mm níž, není vidět).

## 4. Plán dalších etap

| Etapa | Obsah | Stav |
|---|---|---|
| 3 Silnice | viz §3b – hotové jádro; zbývá: nedestruktivní terénní vrstva cesty, lokální šířka úseku, náhled délkového přepočtu, plocha křižovatky 3+ cest v jednom uzlu | z větší části hotovo |
| 4 Ploty | navazování z koncového sloupku, T větve a spojení uzlů (FenceGraph), lokální změna typu/výšky s přechodovým sloupkem, branka/brána vložená klikem na segment s odmítnutím, když se nevejde; F02, F03, F05–F12 | neprovedeno |
| 5 Budovy | půdorysy L/U (B03, B04, B09), úžlabí střech, ručně přidaná okna jako `overrides` (migrace schématu), terasy, schody, B02 patro, interiér s místnostmi | neprovedeno |
| 6 Katalog 84 | zbylé typy, galerie všech 84, terénní tahy T02/T03, scatter s vylučovacími zónami G08, referenční obrázek G07 | neprovedeno |
| 7 Mapa | blockout Skladové osady 230 × 190 m dle reference, přístupy, spawny, výhledy | neprovedeno |
| 8 Předání | měření výkonu, runtime export, návod ovládání | neprovedeno |

**Přesný další krok:** dokončit etapu 3 – terénní vrstva cesty (nedestruktivní: efektivní terén = základ + vrstvy cest, použít v klientu, fyzice i na serveru; smazání cesty obnoví podklad), lokální šířka na úseku (`widthRanges` stejným mechanismem jako povrchy); poté etapa 4 (ploty: FenceGraph, navazování, T větve, brány).
