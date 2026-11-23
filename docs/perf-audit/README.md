# Výkonnostní audit Potatofieldu – první průchod (23. 11. 2026)

Postup měření a příkazy k zopakování jsou v [MEASURING.md](MEASURING.md). Surová data jsou v [data/](data/). Měřeno na commitu `d8fb6b0` a k tomu oddělená diagnostika, viz „Změny v repozitáři“ na konci.

## Shrnutí

1. **Server na Renderu free nestačí ani na 8 hráčů s rezervou.**
   - Při souboji 8 botů vzal server v průměru 9,8 % jednoho jádra, při 16 botech 19,9 %. Render free dává 0,1 CPU.
   - Při 16 hráčích tedy hosting server přibrzďuje a snímky chodí v dávkách. To je hlavní příčina lagu na nasazeném serveru.
   - Nejvíc času stojí simulace pohybu hráčů v Rapieru (35 % času serveru), potom sestavení a odeslání snímků (20 %), kontrola viditelnosti nepřátel (17 %) a zápis do socketů (9 %).
2. **Kontrola viditelnosti nepřátel škáluje kvadraticky a dělá záseky ticku.**
   - Běží celá najednou v jednom ticku z šesti.
   - 32 rozptýlených botů: ~18 ms za běh. Tick přetekl rozpočet 16,7 ms v 17 % ticků, p99 ticku byl 35 ms.
   - 64 rozptýlených botů: ~75 ms za běh, p99 ticku 110 ms.
3. **Přenos dat roste s kvadrátem počtu hráčů.**
   - Každý vzdálený hráč stojí 124 B JSON 30× za sekundu každému klientovi.
   - 16 hráčů: 71 KiB/s na klienta, 1,1 MiB/s ze serveru.
   - 64 hráčů: 211 KiB/s na klienta, 13,5 MiB/s ze serveru.
4. **Únik paměti GPU.**
   - Mizející vzdálení vojáci nechávají v GPU textury kostí. Vojáci mizí i tehdy, když je server skryje za zdí.
   - Za 5 minut souboje 16 hráčů vzrostl počet textur z 244 na 403, lineárně, asi 35 za minutu. Počet objektů scény se přitom nezměnil.
5. **Na klientovi bere nejvíc CPU logiky animace vzdálených vojáků** (A/B −1,25 ms ze 4,2 ms snímku při 16 hráčích).
   - Dalších ~0,6 ms bere průchod celou scénou každý snímek kvůli odrazům.
   - Dalších ~0,45 ms JS plus přepočty stylů a layoutu stojí HUD, který každých 50 ms staví DOM znovu.
   - Bez vykreslování přetekla logika při 32 hráčích v p99 rozpočet snímku (17,1 ms na 2,3GHz Xeonu).
6. **Grafika se na integrované GPU v tomto prostředí změřit nedala** (jen SwiftShader).
   - Spolehlivé jsou počty: 160–250 draw calls na prázdné mapě, z toho ~90 je stínová mapa; v souboji p95 452 a max 492. Trojúhelníků 120–163 tis., v souboji až 232 tis.
   - První výstřel, granát, obrazovka nasazení ani tabulka skóre **nepřekládají žádný nový shader**, takže předehřátí funguje.

## Rozsah a omezení

| | |
|---|---|
| Stroj | cloudové VM: Intel Xeon @ 2,30 GHz, 4 jádra, 16 GB RAM, Linux 6.18, Node 22.23 |
| Prohlížeč | Chromium headless 153 (Playwright) s ANGLE → **SwiftShader** (softwarová grafika) |
| Build | produkční `vite build` (Vite 7.3, three 0.186, Rapier 0.21 compat, postprocessing 6.39, n8ao 2.0) přes `vite preview` |
| Mapa | jediná mapa v repozitáři: Referenční ulice (200 × 200 m), Conquest „Dvě základny“ |
| Grafika | kvalita Standardní (s 4× MSAA, protože SwiftShader se nehlásí jako integrovaná grafika), DPR 1, dynamické rozlišení vypnuté |
| Rozlišení | logika 1280×720 bez vykreslování; render 640×360 s polovičním rozlišením → **320×180** |
| Síť | localhost, bez ztrát a zpoždění |
| Server | 60 Hz tick, 30 Hz snímky, skrývání nepřátel za zdí zapnuto; boti v samostatném procesu |

**Co měřit nešlo**
- Nemám přístup k referenčnímu notebooku (i5-1335U s Iris Xe) ani k žádné skutečné GPU. **Neuvádím žádná FPS ani GPU časy pro skutečnou grafiku.**
- Interval snímků při vykreslování je v SwiftShaderu 150–900 ms. To je cena CPU rasterizace a nevypovídá o hře.
- Postup pro měření na notebooku je v [MEASURING.md](MEASURING.md#co-musí-změřit-člověk-na-referenčním-notebooku-i5-1335u-16-gb-iris-xe).

**Co je spolehlivé**
- CPU časy úseků hlavního vlákna.
  - V režimu bez vykreslování běží snímky 60 Hz, takže časy odpovídají práci za snímek.
  - S vykreslováním při ~4 FPS se do jednoho snímku nahromadí události za ~15 ticků. Úsek `events` se proto porovnává jen za sekundu.
- Počty draw calls, trojúhelníků a průchodů.
- Počty shaderů, textur, geometrií a objektů scény.
- JS heap.
- Serverové časy a přenos.

**Druh zátěže**
- Zátěž tvoří **serveroví boti, ne prohlížeče**. Server s nimi pracuje stejně jako s hráči: vstupy 60 Hz, snímky, viditelnost.
- Klient s 15 boty vykresluje 15 vzdálených vojáků, ale boti nejsou lidé. Míří a pohybují se jinak, takže viditelnost i střelba se liší.
- Scénáře 32 a 64 hráčů jsou **zátěžové testy**, ne důkaz podporované kapacity. Server je nastavený na 2 × 8.

**Opakování**
- 3 opakování mají server s 8 a 16 boty a klient (logika) v klidu a při souboji 16.
- Ostatní scénáře mají 1 běh. Výsledky jednoho běhu, které leží v rozptylu, označuji jako neprůkazné.

**Režie diagnostiky**
- Vypnutá diagnostika stojí jednu kontrolu příznaku na úsek, 13 úseků za snímek.
- Zapnutá přidává ~30× `performance.now()` za snímek, odhadem pod 0,01 ms. Tento odhad **jsem nezměřil**.
- Na serveru přidává 6–7 `performance.now()` za tick; profil fází se počítá jen s `profile: true`.

## Výchozí měření

### Server (`data/server.json`, 60 s po 15 s zahřátí)

| Scénář | CPU jádra | Tick průměr / p95 / p99 / max (ms) | Ticků > 16,7 ms | Smyčka událostí p99 | Odchozí na klienta |
|---|---|---|---|---|---|
| 8 souboj (3×) | **9,8 %** (8,9–10,6) | 1,12 / 2,2 / 3,1 / 6–18 | 0, 0, 1 | 6,4–6,8 ms | 47–51 KiB/s |
| 16 souboj (3×) | **19,9 %** (17,0–22,0) | 2,48 / 5,8 / 7,7 / 13–16 | 0 | 8,8–11,4 ms | 65–71 KiB/s |
| 16 rozptýlení | 22,2 % | 2,85 / 7,9 / 11,3 / 21,8 | 1 | 13,2 ms | 61 KiB/s |
| 32 souboj | 38,8 % | 5,31 / 14,5 / 19,9 / 32,1 | 106 (3 %) | 20,7 ms | 137 KiB/s |
| 32 rozptýlení | 55,5 % | 8,38 / 25,1 / 35,5 / 94,5 | 600 (17 %) | 34,8 ms | 89 KiB/s |
| 64 souboj | 80,4 % | 12,3 / 44,0 / 56,2 / 85,4 | 627 | 62,6 ms | 199 KiB/s |
| 64 rozptýlení | 103 % (nestíhá) | 18,4 / 82,4 / 110 / 155 | 539 | 172 ms | 138 KiB/s |
| 64 souboj, **bez skrývání nepřátel** (A/B) | 51,3 % | 7,37 / 14,7 / 18,9 / 35,2 | 72 | – | 275 KiB/s |

**Fáze ticku** (průměr na tick, ms)

| Scénář | simulace | snímky (sestavení + JSON + odeslání) | viditelnost | události | vstupy |
|---|---|---|---|---|---|
| 8 souboj | 0,66 | 0,32 | 0,09 | 0,04 | 0,005 |
| 16 souboj | 1,35 | 0,64 | 0,39 | 0,09 | 0,009 |
| 32 rozptýlení | 4,13 | 1,21 | 3,02 | 0,00 | 0,011 |
| 64 rozptýlení | 3,09 | 2,68 | **12,6** | 0,00 | 0,021 |

- Viditelnost běží jen každý 6. tick, takže jeden její běh trvá šestinásobek průměru: při 16 rozptýlených ~5 ms, při 32 ~18 ms, při 64 ~75 ms.
- Zpracování příchozích zpráv mimo tick stojí 3,6–4,1 ms/s při 8 hráčích, 5,9 ms/s při 16 a 13,8 ms/s při 64.
- Paměť procesu (RSS) byla 185–210 MB při 8–16 hráčích a ~310–366 MB při 64. V 60s oknech nerostla nad rozptyl.

**CPU profil serveru, 16 botů v souboji** (`node --cpu-prof`, 30 s; podíl ze zaneprázdněného času, 19,3 % jádra)
- `MatchSim.step` 41 %. Z toho `PlayerController.step` (Rapier character controller, sondy země, `fits`) tvoří **35 %**.
- `sendSnapshot` 20 %, v tom `diffFields` 3 %.
- `castRay` 17 % celkem, převážně z `updateVisibility` (16,5 %).
- `send`, `ws` a `writev` 15 %.
- GC 3,5 %.
- WASM Rapieru a jeho JS obal tvoří dohromady ~51 % zaneprázdněného času.

**Přenos podle typu zprávy** (`data/server-bandwidth.json`)

| | snímky (`snap`) | události (`events`) | celkem ze serveru | na klienta |
|---|---|---|---|---|
| 16 souboj | 965 KiB/s | 125 KiB/s | 1,07 MiB/s | 71 KiB/s |
| 64 souboj | 12,6 MiB/s | 1,73 MiB/s | 14,3 MiB/s | 211 KiB/s |

Jeden vzdálený hráč v JSON n-tici má 124 B, posílá se 30× za sekundu každému klientovi, který ho vidí.

### Klient – herní logika bez vykreslování (`data/client-logic.json`, 30 s, 1280×720, `ab=norender`)

| Scénář | CPU snímku průměr / p95 / p99 (ms) | vojáci | odrazy (`env`) | události | HUD | simulace | kamera |
|---|---|---|---|---|---|---|---|
| prázdná mapa (3×) | 1,19 / 2,6 / 3,3 | 0,13 | 0,13 | – | 0,36 | 0,14 | 0,22 |
| 8 souboj | 3,14 / 5,9 / 9,1 | 0,82 | 0,47 | 0,36 | 0,43 | 0,23 | 0,32 |
| 16 souboj (3×) | **4,19** / 8,5 / 13,2 | **1,44** | **0,60** | 0,63 | 0,45 | 0,22 | 0,29 |
| 16 rozptýlení | 2,89 / 5,4 / 7,2 | 1,11 | 0,48 | – | 0,42 | 0,19 | 0,29 |
| 32 souboj | 5,45 / 11,0 / **17,1** | 1,85 | 1,00 | 0,98 | 0,42 | 0,21 | 0,27 |
| 32 rozptýlení | 2,95 / 5,7 / 7,7 | 1,04 | 0,68 | – | 0,38 | 0,16 | 0,26 |

- Objektů ve scéně: 844 na prázdné mapě, ~2 700 při 16 hráčích, ~3 800 při 32 hráčích.
- Alokace JS (odhad podle růstu heapu mezi vzorky po 1 s, spodní mez): ~1,8 MB/s na prázdné mapě, ~5,8 MB/s při souboji 16. Heap 100–150 MB s pravidelným uvolňováním.

**A/B při souboji 16** (`data/client-logic-ab.json`, vždy 1 běh; srovnání s rozsahem 3 opakování 3,78–4,41 ms)

| Přepínač | CPU snímku průměr | Změna úseku | Hodnocení |
|---|---|---|---|
| `noanim` (vojáci bez animace) | 2,49 ms | vojáci 1,44 → **0,19 ms** | **průkazné** |
| `nohud` | 3,52 ms | HUD 0,45 → 0. Layout za 30 s: **326 → 15 ms**, přepočty stylů: 240 → 98 ms (2084 → 1270×) | JS v rozptylu; layout a styly průkazné |
| `noeffects` | 3,03 ms | události 0,63 → 0,39, odrazy 0,60 → 0,37 | jeden běh pod rozsahem, **slabé** |

Hodnoty layoutu a stylů pro srovnání pocházejí z běhu `noanim`, kde HUD běží normálně. Animace vojáků na DOM nesahají.

### Klient – vykreslování (SwiftShader, 320×180; `data/client-render.json`, `data/client-gpu-ab.json`)

| Stanoviště | Draw calls | Trojúhelníky | Draw calls bez stínů | CPU odeslání renderu p50 |
|---|---|---|---|---|
| základna A, pohled celou ulicí | 231 | 158 tis. | 142 | 4,6 ms |
| ulice ke křižovatce | 242 | 156 tis. | 138 | 4,9 ms |
| křižovatka k −x | 166 | 140 tis. | 63 | 3,5 ms |
| křižovatka k +x | 159 | 120 tis. | 56 | 3,2 ms |
| základna B zpět ulicí | 249 | 155 tis. | 152 | 3,9 ms |
| u fasády přes ulici | 190 | 145 tis. | 87 | 3,8 ms |
| souboj 16 (p50 / p95 / max) | 248 / 452 / 492 | 188 / 210 / 232 tis. | – | 6,0 ms |

- 2 volání `renderer.render` na snímek: scéna se stínovou mapou a výstupní průchod s barevným laděním.
- Stínová mapa se překresluje 20× za s a při posunu kamery.
- **Poměry práce GPU v SwiftShaderu** (součet časovače GPU přes 6 stanovišť, jen relativně):
  - Standardní = 100 %;
  - bez stínů 82 %;
  - bez trávy 100 % (na ulici skoro žádná tráva není, takže neprůkazné);
  - Nízká 31 %;
  - Vysoká 69 %. Vysoká vyšla levněji než Standardní pravděpodobně kvůli 4× MSAA ve Standardní (N8AO kreslí scénu bez MSAA). **Na skutečné GPU to neplatí automaticky.**
- **První použití** (`first`): 0 nově přeložených shaderů při prvním výstřelu, druhé dávce, výbuchu granátu, otevření a zavření obrazovky nasazení a podržení tabulky skóre. Programů je celkem 102–103.
- **Načtení:**
  - 5,3 s do hlavního menu, z toho generování procedurálních textur ve workerech;
  - 9,3 s od připojení po možnost hrát, z toho předehřátí shaderů a modelů 2,4 s.
  - Obojí měřeno v SwiftShaderu na localhostu; na notebooku neměřeno.

### Životní cyklus a dlouhý běh (`data/client-render.json` `lifecycle`, `data/client-long.json`)

| Krok | Objekty scény | Geometrie | **Textury** | Shadery | Posluchače hry |
|---|---|---|---|---|---|
| po prvním spawnu | 718 | 160 | 154 | 103 | 10 |
| po 10× smrti a respawnu | 1049* | 175 | **177** | 102 | 10 |
| po 5× odpojení a připojení | 743 | 165 | **192** | 101 | 10 |
| po konci kola a novém kole | 782 | 167 | **197** | 101 | 10 |

\* Čtyři rozptýlení boti chodí do záběru a ven, takže objekty scény se mezi kroky přímo srovnat nedají.

Dlouhý běh, 5 minut souboje 16:
- textury 244 → 403, lineárně, asi 35 za minutu;
- geometrie stálé (178–181), objekty scény stálé (2,5–2,8 tis.);
- posluchače JS stálé (1 348);
- JS heap kolísá 30–48 MB a neroste;
- DOM uzly kolísají 5–9 tis.;
- draw calls 198–274.

## Nálezy podle očekávaného praktického přínosu

Stav důkazu:
- **Naměřeno** = problém i dopad jsou změřené;
- **Doloženo kódem** = mechanismus je jistý, dopad nebyl změřen;
- **Hypotéza** = potřebuje ověření.

### N1. Server nestačí na hosting 0,1 CPU – kapacita serveru

- **Kde:** celý `GameServer.tick` (`server/gameServer.ts`) a nasazení v `render.yaml` (free plán).
- **Kdy:** vždy na Renderu free, výrazně od 8 hráčů výš.
- **Příčina:** CPU roste zhruba lineárně s počtem hráčů (simulace, snímky) a k tomu kvadraticky (viditelnost, přenos). Při 8 hráčích je to 9,8 % jádra, při 16 hráčích 19,9 %. CFS kvóta 0,1 CPU proces po vyčerpání zastaví a pustí dál až v dalším období, takže snímky chodí v dávkách.
- **Stav:** **Naměřeno** na Xeonu 2,3 GHz. CPU na Renderu může být jinak rychlé. Na Renderu to potvrzuje dřívější pozorování lagu ve 2 hráčích.
- **Oprava:**
  - a) Pro 8–16 hráčů placená instance s ≥ 0,5 CPU. To je nejrychlejší a jistý krok, ale stojí peníze, což je v rozporu s nulovým rozpočtem. Rozhodnutí je na tobě.
  - b) Snížit cenu ticku podle N2, N3, N6 a N9.
  - Samotná simulace při 16 hráčích je ale 1,35 ms na tick, tedy 8 % jádra. **16 hráčů se do 0,1 CPU nevejde ani po všech úsporách, pokud se nezlevní i simulace pohybu.**
- **Kompromis:** žádný herní, jen cena hostingu.
- **Náročnost:** nízká (konfigurace). Riziko regrese žádné.
- **Ověření:**
  - na Renderu logovat `tick avg/p95/max`, server to už dělá každých 10 s;
  - v metrikách Renderu sledovat CPU throttling;
  - lokálně `scripts/perf/server-matrix.sh`.

### N2. Kontrola viditelnosti: kvadratická, celá v jednom ticku – herní logika serveru / záseky

- **Kde:** `GameServer.updateVisibility` (`server/gameServer.ts`), volaná `if (this.snapCount % 3 === 0)` v `tick()`.
- **Kdy:** nepřátelé jsou daleko od sebe a za překážkami, tedy rozptýlení. Tehdy se nenajde rychlá volná přímka a pro každou dvojici proběhnou všechny paprsky.
- **Příčina:**
  - Na každou dvojici klient × nepřítel jde až 2 polohy očí × 6 bodů cíle = 12 paprsků Rapieru. To dává O(N²) paprsků najednou v jednom ticku.
  - `PhysicsWorld.castRay` pokaždé alokuje `Ray` a výsledek s normálou (WASM obal), i když viditelnost potřebuje jen ano/ne.
- **Stav:** **Naměřeno.**
  - Jeden běh trvá: 16 rozptýlených ~5 ms, 32 ~18 ms, 64 ~75 ms.
  - A/B s vypnutým skrýváním (64 souboj): průměrný tick 12,3 → 7,4 ms, p99 56 → 19 ms.
- **Oprava**, v tomto pořadí (každý krok zvlášť):
  1. Rozložit práci do ticků: každý tick zpracovat 1/6 klientů. Průměr zůstane stejný, ale zmizí 75ms špička. Interval kontroly pro daného klienta zůstane 100 ms.
  2. Levný paprsek jen na ano/ne: `world.castRay` bez normály, sdílený objekt `Ray`, bez mapování povrchu.
  3. Pořadí bodů podle posledního úspěchu: kdo byl vidět, bývá vidět stejným bodem.
  4. Pro dvojice daleko za hranicí dohledu (mlha, mapa) použít jen hrubý test.
- **Kompromis:** žádný, pokud zůstane platit pravidlo, že viditelný nepřítel se nikdy neskryje. Bod 4 musí respektovat dohled puškohledu.
- **Náročnost:** 1 a 2 nízká, 3 a 4 střední. Riziko pro ochranu proti wallhacku je střední, proto je potřeba test.
- **Ověření:**
  - jednotkový test: pro pevné polohy dává nová implementace stejnou množinu viditelných jako stará, s tolerancí jednoho intervalu 100 ms;
  - `server.ts --bots 32 --mode spread`: p99 ticku pod 16,7 ms, fáze `visibility` beze špiček;
  - stávající testy sítě a skrývání (`tests/net.test.ts`, `tests/netFair.test.ts`).

### N3. Velikost snímků: každý vzdálený hráč celý v JSON 30× za sekundu – síť

- **Kde:**
  - `encodeRemote` (`src/shared/net/protocol.ts`): n-tice 26 polí včetně jména, týmu, čety a zbraně v každém snímku;
  - `sendSnapshot` (`server/gameServer.ts`).
- **Kdy:** vždy. Roste s (počet viditelných hráčů) × (počet klientů).
- **Příčina:** JSON s desetinnými čísly, statická pole posílaná pořád, žádné omezení frekvence podle vzdálenosti.
- **Stav:** **Naměřeno.**
  - Snímky tvoří 88–90 % odchozích dat.
  - 16 hráčů: 71 KiB/s na klienta; 64 hráčů: 211 KiB/s na klienta, celkem 14,3 MiB/s.
  - `sendSnapshot` bere 20 % CPU serveru a `send`/`writev` 15 %.
- **Oprava:**
  1. Statická pole (jméno, tým, četa, zbraň) posílat jen při změně a jednou za 2 s celé, stejně jako `SLOW_SNAP_FIELDS`.
  2. Binární kvantovaný formát vzdáleného hráče: poloha s rozlišením 1 cm v int16/int32 relativně ke středu mapy, úhly v int16, příznaky v bitech. Odhadem 24–32 B místo 124 B. Odhad počítám z velikostí polí, **neměřil jsem ho**.
  3. Volitelně vzdálení hráči za ~80 m s nižší frekvencí. Pozor na plynulost vzdálených hráčů, kterou jsi řešil: interpolace už má adaptivní zpoždění, ale musí se to ověřit.
- **Kompromis:**
  - 1 a 2 žádný, při dostatečném rozlišení;
  - 3 přidá zpoždění u vzdálených cílů. Kvůli férovosti musí kompenzace pingu počítat s horším obrazem střelce, proto 3 až po měření.
- **Náročnost:** 1 nízká, 2 střední (protokol v8, dekodér, testy), 3 střední. Riziko: přesnost interpolace a kompatibilita verzí.
- **Ověření:**
  - `server-bandwidth.json` před a po;
  - `scripts/net-smooth.ts` (plynulost vzdálených hráčů), aby se nezhoršila;
  - test round-trip kodéru.

### N4. Únik textur kostí u mizejících vojáků a zbraní – životní cyklus / paměť GPU

- **Kde:**
  - `Mannequin.dispose()` (`src/client/render/soldier/mannequin.ts`) volá jen `mixer.stopAllAction()` a `removeFromParent()`. Kostry dvou SkinnedMesh (65 kostí) a jejich textury kostí se neuvolní.
  - `FPArms` (`src/client/render/weapons/fpArms.ts`) nemá `dispose` vůbec, a to klonuje skinned ruce pro každou zbraň.
  - Volají se z `SoldierPool.update`, když voják zmizí ze snímku, a z úklidu `warmup`.
- **Kdy:** vždy, když vzdálený voják vypadne ze snímku. To nastává často, protože server skrývá nepřátele za zdí, a také při odpojení. Dále při přestavbě zbraně v první osobě (respawn, reconnect).
- **Příčina:** Three.js uvolní GPU texturu až po `skeleton.dispose()`; samotné odebrání ze scény ji nechá v paměti.
- **Stav:**
  - **Naměřeno:** +35 textur za minutu souboje 16, při stálém počtu objektů.
  - **Doloženo kódem:** zdroj byl dohledán nástrojem `scripts/perf/texleak.ts`, kostry 20×20 a 8×8.
  - Velikost jedné je ~6,4 kB, za hodinu tedy ~13 MB GPU paměti a stejně položek v `renderer.properties`. Jde o **odhad**.
- **Oprava:**
  - v `Mannequin.dispose` projít `this.meshes` a zavolat `m.skeleton.dispose()`;
  - doplnit `FPArms.dispose()` (kostry, případně klonované materiály) a volat ji z `FPWeapon.dispose` a `FPItem.dispose`.
- **Kompromis:** žádný.
- **Náročnost:** nízká. Riziko nízké: sdílené geometrie a materiály se nesmí uvolnit, jen kostry.
- **Ověření:**
  - `scripts/perf/client.ts --scenario long --long 300`: textury stálé;
  - `lifecycle`: po 10 respawnech beze změny počtu textur;
  - nový test, že `dispose()` uvolní kostru.

### N5. Animace vzdálených vojáků – postavy / CPU klienta

- **Kde:**
  - `SoldierPool.update` → `SoldierAnimator.update` (`src/client/render/soldier/animator.ts`);
  - `Mannequin.update` (`src/client/render/soldier/mannequin.ts`).
- **Kdy:** úměrně počtu vojáků v záběru, i do 8 vojáků vždy plnou frekvencí (`FULL_RATE_UNDER`).
- **Příčina:**
  - Každý voják má dvě kostry: procedurální a Mannequin s 65 kostmi a mixerem s prolínáním klipů.
  - Přenos pózy volá na každou mapovanou kost `getWorldQuaternion` dvakrát (`groupQ`). To pokaždé přepočítá matice celého řetězce rodičů a navíc `ub.updateMatrixWorld(true)` přepočítá celý podstrom. Cena je zhruba kosti × hloubka.
  - Za snímek se alokují `new Map`, `quaternion.clone()`, `new THREE.Quaternion` a v animátoru `new Vector3/Quaternion/Euler`.
- **Stav:** **Naměřeno.** A/B `noanim` při souboji 16: vojáci 1,44 → 0,19 ms na snímek (Xeon 2,3 GHz, typicky 1–5 vojáků v záběru).
- **Oprava:**
  - jeden průchod kostrou od kořene se světovými kvaterniony rodičů v mezipaměti (bez `getWorldQuaternion` a `updateMatrixWorld(true)` na kost);
  - předalokované dočasné objekty;
  - matice světa jednou na konci.
  - **Frekvenci animací blízkých vojáků nesnižovat**: plynulost byla tvůj požadavek.
- **Kompromis:** žádný, pokud póza vyjde shodně.
- **Náročnost:** střední. Riziko regrese střední: „lítající ruce a nohy“ z minula.
- **Ověření:**
  - test shody póz: pro záznam vstupů 10 s se kvaterniony všech kostí staré a nové verze shodují do 1e-5;
  - `tests/soldier.test.ts`;
  - snímky `scripts/anim-shots.mjs`;
  - A/B úsek `soldiers` při `fight16`.

### N6. Simulace pohybu hráčů na serveru – herní logika serveru

- **Kde:** `PlayerController.step` (`src/shared/sim/player.ts`):
  - `computeColliderMovement`;
  - `probeGround` (`castShape`);
  - `fits()` (`intersectionsWithShape`) při změnách postoje a otáčení těla v lehu.
- **Kdy:** vždy, lineárně s počtem živých hráčů.
- **Příčina:** WASM volání Rapieru a obal (`__wrap`, `__destroy`) za každý dotaz. Za tick padne několik dotazů na hráče.
- **Stav:** **Naměřeno.**
  - 35 % CPU serveru při 16 hráčích.
  - Na tick: ~0,08–0,09 ms na hráče (8 hráčů 0,66 ms, 16 hráčů 1,35 ms).
  - Rozpad uvnitř controlleru **neměřen**, je to hypotéza.
- **Oprava:**
  - nejdřív změřit rozpad (kolik `fits`, `probeGround`, KCC na tick);
  - `probeGround` volat jen když KCC zemi nehlásí (už je přes `||`, ověřit četnost);
  - sdílet tvary a dotazové objekty místo `new Capsule` a `new Ray`;
  - `fits()` při stoji bez změny postoje nevolat.
- **Kompromis:** žádný, sim je sdílená s klientem a musí zůstat deterministická stejně.
- **Náročnost:** střední. Riziko: predikce klienta a server se musí shodovat.
- **Ověření:** stávající testy pohybu (`tests/movement.test.ts`, `tests/stanceRecoil.test.ts`) a A/B fáze `sim` v `server.ts`.

### N7. Průchod celou scénou každý snímek kvůli odrazům – zbytečná práce

- **Kde:** `EnvironmentRig.update` → `assignReflections()` (`src/client/render/environment.ts`). Volá `scene.traverse` každý snímek.
- **Kdy:** vždy ve hře. Cena roste s počtem objektů scény: kosti vojáků, částice, stopy.
- **Příčina:** každý materiál se upravuje jen jednou (`reflSeen`), ale průchod scénou běží pořád, i když nic nového nepřibylo.
- **Stav:** **Naměřeno.**
  - Úsek `env`: 0,13 ms (844 objektů) → 0,60 ms (2 700, 16 hráčů) → 1,00 ms (3 800, 32 hráčů).
  - Zbytek `env` (obloha, stínová kamera) tvoří ~0,1 ms.
- **Oprava:** volat jen při změně scény, tedy po vytvoření vojáka, efektu nebo zbraně. Nebo materiály upravit už při vytvoření, kde je zná `MaterialLibrary` nebo `SoldierPool`. Případně průchod omezit na 1× za 0,5 s.
- **Kompromis:** žádný. Riziko: materiál vytvořený mimo hlídaná místa by krátce byl bez odrazu nebo bez úpravy interiéru. Při 0,5s variantě by jedno překreslení vypadalo jinak.
- **Náročnost:** nízká. Riziko nízké.
- **Ověření:**
  - test: po vytvoření vojáka, efektu a zbraně mají všechny `MeshStandardMaterial` ve scéně `userData.indoorPatched`;
  - úsek `env` při `fight16` ~0,1 ms;
  - porovnání snímků obrazovky.

### N8. HUD staví DOM znovu každých 50 ms – UI

- **Kde:** `Hud.update` (`src/client/ui/hud.ts`). `replaceChildren` pro životy (2 × 20 segmentů), náboje (až 30 segmentů), skóre, pruh bodů a střed obrazovky. Totéž v `renderSquad`.
- **Kdy:** vždy ve hře, 20× za sekundu, i když se nic nezměnilo.
- **Příčina:** stovky nových uzlů za sekundu znamenají přepočet stylů, layout a GC.
- **Stav:** **Naměřeno.**
  - JS 0,45 ms na snímek v průměru; v snímku s aktualizací 1,5–1,9 ms (p95).
  - Layout 326 ms za 30 s s HUD a 15 ms bez něj. Styly 240 → 98 ms za 30 s.
  - Na Xeonu je to ~15 ms prohlížečové práce za sekundu.
- **Oprava:** postavit jednou a pak měnit jen text, `width` segmentu a třídy, a to jen při změně hodnoty. Stejný vzor už používá obrazovka nasazení, kde se čas přepisuje jen textem.
- **Kompromis:** žádný.
- **Náročnost:** nízká až střední. Riziko nízké: vizuální kontrola `scripts/ui-shots.mjs`.
- **Ověření:** A/B `nohud` má po opravě vyjít bez rozdílu; metriky layoutu a stylů v `client.ts`; snímky UI.

### N9. Události střelby a dopadů všem klientům, zvlášť pro každého – síť a server

- **Kde:**
  - `distributeEvents` (`server/gameServer.ts`): `events.filter` pro každého klienta a samostatná zpráva každý tick s událostí;
  - klient `Game.processEvents`: každý dopad na mapě dostane 5 sprajtů, úlomky, stopu a zvuk; každý cizí výstřel paprsek (`occluded`) a zvuk.
- **Kdy:** úměrně (výstřely) × (klienti).
- **Stav:**
  - **Naměřeno:** 8 KiB/s na klienta při 16 hráčích, 28 KiB/s při 64. Zpráv za sekundu ze serveru: 843 při 16 hráčích, 4 813 při 64; každá je samostatný `writev`.
  - **Slabě naměřeno:** A/B `noeffects` na klientovi −0,2 až −0,3 ms v úsecích událostí a odrazů.
- **Oprava:**
  1. Události ticku se snímkem posílat v jedné zprávě. Ticky se snímkem jsou každý druhý, takže zpráv bude polovina. Zpoždění události do 16 ms je potřeba zvážit proti pocitu ze zásahu, proto jen u cizích výstřelů a dopadů; vlastní zásahy a hitmarkery hned.
  2. Kompaktní zápis výstřelu: origin a směr na 3 desetinná místa.
  3. Na klientovi omezit vizuální efekty dopadů podle vzdálenosti nebo záběru. Zvuk nechat.
- **Kompromis:** u bodu 1 až 16 ms zpoždění cizích efektů. Na férovost nemá vliv, protože o zásahu rozhoduje server.
- **Náročnost:** střední. Riziko nízké.
- **Ověření:** `server-bandwidth.json` (počet zpráv a bajty) a `fight16` úsek `events`.

### N10. Vykreslovací volání efektů a stop – vykreslování

- **Kde:** `Effects` (`src/client/render/effects.ts`):
  - každá stopa po kulce je samostatný `Mesh`, až `maxDecals` = 192 na Standardní, 384 na Vysoké;
  - každý obláček je `Sprite` s vlastní kopií materiálu (`puffMat.clone()`);
  - každá stopa střely vytváří a ruší `BufferGeometry` (upload do GPU za výstřel);
  - úlomky a nábojnice jsou samostatné `Mesh`.
- **Kdy:** v souboji. Draw calls při souboji 16: p50 248, p95 452, max 492; na prázdné mapě 160–250.
- **Stav:**
  - **Naměřeno:** počty draw calls.
  - **Hypotéza:** dopad na čas GPU a CPU odeslání na skutečném zařízení. CPU odeslání renderu v SwiftShaderu bylo 3–5 ms při ~240 voláních.
- **Oprava:**
  - stopy jako jeden `InstancedMesh`;
  - obláčky jako jeden `Points` nebo instancovaný systém;
  - stopy střel jako jeden předalokovaný `LineSegments` buffer.
- **Kompromis:** žádný vizuální; řazení průhledných obláčků bude jen jedno pro celý systém.
- **Náročnost:** střední. Riziko nízké.
- **Ověření:** `fight16` draw calls p95 pod ~300; snímky dopadů; úsek `render`.

### N11. Stínová mapa: ~90 draw calls, překreslení 20× za s – vykreslování

- **Kde:** `EnvironmentRig.update` (`shadowRate = 20`, plus překreslení při posunu přichycené kamery).
- **Kdy:** ve hře. Při 60 FPS má stínový průchod každý třetí snímek, takže doby snímků jsou nerovnoměrné.
- **Stav:**
  - **Naměřeno:** stínový průchod přidává 56–104 draw calls a ~55 tis. trojúhelníků; v SwiftShaderu −18 % práce GPU.
  - **Hypotéza:** dopad na p95 snímku na Iris Xe. Na notebooku změřit s `ab=noshadow` a podle korelace `shadowFrames` s intervalem.
- **Oprava** (až po změření na notebooku):
  - statické stíny budov už jsou zapečené v terénu (`applyBakedLight`); stínovou mapu omezit na dynamické vrhače (vojáci, zbraně) a blízké objekty;
  - případně rozložit stínový průchod do dvou snímků.
- **Kompromis:** stín statických objektů na jiných objektech, například markýza na zdi, by musel být zapečený nebo zmizí. To je viditelná změna.
- **Náročnost:** střední až vysoká. Riziko vizuální regrese.
- **Ověření:** na notebooku 3 × 60 s s `ab=noshadow` a bez něj; snímky stínů.

### N12. Seznam vzdálených hráčů alokuje celý stav každý snímek – paměť

- **Kde:** `NetDriver.buildRemotes` (`src/client/runtime/netDriver.ts`). `createPlayerState` + `createWeaponState` + nový objekt pro každého vzdáleného hráče a snímek. Dále `new Map(a.others…)`.
- **Kdy:** úměrně (vzdálení hráči) × FPS.
- **Stav:** **Doloženo kódem.** Celková alokace při souboji 16 je ~5,8 MB/s proti 1,8 MB/s na prázdné mapě, ale podíl tohoto místa **neměřen**. Záseky GC v datech výrazné nejsou.
- **Oprava:** objekty pohledu na hráče podle `id` znovu používat a jen přepisovat pole.
- **Kompromis:** žádný. Riziko: odběratelé nesmí držet starou referenci; projít použití.
- **Náročnost:** nízká.
- **Ověření:** alokační profil Chrome (Allocation sampling) při `fight16`; `tests/net.test.ts`.

### N13. Bez zpětného tlaku při odesílání – síť a server

- **Kde:** `GameServer.send`. `ws.send` se volá bez kontroly `ws.bufferedAmount`.
- **Kdy:** pomalý nebo zaseklý klient (mobilní síť, přetížený počítač).
- **Příčina:** buffer odchozích dat v serveru roste bez omezení. Snímky se zpožďují místo zahazování.
- **Stav:** **Doloženo kódem**, neměřeno. Měření by potřebovalo klienta s omezenou rychlostí linky.
- **Oprava:** když `bufferedAmount` > ~256 kB, snímek tomu klientovi vynechat. Pozor: rozdíl vlastního stavu se počítá vůči naposledy odeslanému, proto vynechat ještě před `diffFields`. Události hitů a smrti neposílat do zahozena.
- **Kompromis:** pomalý klient dostane méně snímků, ostatní nic nepoznají.
- **Náročnost:** nízká. Riziko nízké.
- **Ověření:** test s falešným `ws`, který má velký `bufferedAmount`: snímek se neodešle a další plný snímek dorovná stav.

### N14. Stahování: Rapier WASM vložený v JS (5,15 MB, gzip 1,87 MB) – asset pipeline / načtení

- **Kde:** `@dimforge/rapier3d-compat`, chunk `mannequin-*.js` v buildu.
- **Kdy:** první načtení.
- **Příčina:** varianta `compat` má WASM jako base64 v JS. Je o ~33 % větší, musí se dekódovat a nekompiluje se streamovaně.
- **Stav:** **Doloženo** výstupem buildu. Čas načtení na notebooku **neměřen** (v SwiftShaderu 5,3 s do menu, převážně generování textur).
- **Oprava:** balíček `@dimforge/rapier3d` s WASM jako samostatným souborem (Vite to umí), nebo aspoň oddělený chunk mimo cestu modelu vojáka.
- **Kompromis:** žádný. Riziko: server používá stejný balíček; ověřit načtení v Node.
- **Náročnost:** střední.
- **Ověření:** velikost `dist`; Lighthouse nebo Network panel (čas do menu) na notebooku.

### N15. Menší nálezy (nízký přínos, nízká náročnost)

- **`teamUi.update`** zapisuje každý snímek `minimap.style.display = 'none'` a filtruje `requests`. Doloženo kódem, dopad zanedbatelný (`ui` 0,04–0,09 ms).
- **Jmenovky** přepisují `className` a `transform` každý snímek u všech viditelných (`tags` 0,07–0,11 ms). Zapisovat jen při změně.
- **Server: `SLOW_SNAP_FIELDS` a `diffFields`** dělají `JSON.stringify` stejných týmových dat pro každého klienta zvlášť (`diffFields` 3 % CPU serveru). Spočítat jednou na tým a snímek.
- **Server: `c.msgTimes.filter`** alokuje pole při každé příchozí zprávě (60/s na klienta). Stačí kruhový čítač.
- **Klient: stopy střel** se vytvářejí jako nová geometrie (viz N10).

## Zbytečně prováděná práce

| Druh | Místo | Doklad |
|---|---|---|
| Práce bez využitého výsledku | `assignReflections` prochází celou scénu každý snímek, i když nic nového nepřibylo (N7) | naměřeno: 0,5–0,9 ms na snímek při 16–32 hráčích |
| Práce bez využitého výsledku | HUD ruší a staví stejné DOM uzly 20× za s (N8) | naměřeno: layout 326 → 15 ms za 30 s |
| Práce bez využitého výsledku | `teamUi`: `minimap.style.display = 'none'` každý snímek | doloženo kódem |
| Potřebná práce příliš často nebo najednou | kontrola viditelnosti celá v jednom ticku (N2) | naměřeno: až 75 ms za běh |
| Potřebná práce příliš často nebo najednou | jméno, tým, četa a zbraň vzdáleného hráče v každém snímku 30× za s (N3) | naměřeno: 124 B na hráče |
| Potřebná práce příliš často nebo najednou | týmová pole snímku serializovaná pro každého klienta zvlášť (N15) | profil: `diffFields` 3 % |
| Potřebná práce příliš často nebo najednou | alokace celého stavu vzdáleného hráče každý snímek (N12) | doloženo kódem |
| Potřebná práce příliš často nebo najednou | události v samostatné zprávě každý tick (N9) | naměřeno: 843–4 813 zpráv za s |
| Volitelný efekt s nejasným přínosem | tráva na Standardní (9 000 trsů, 45 m) | na referenční ulici A/B bez rozdílu (skoro žádná tráva); na travnaté mapě neověřeno |
| Volitelný efekt s nejasným přínosem | 4× MSAA ve vyrovnávací paměti na Standardní u nerozpoznané grafiky | v SwiftShaderu dražší než Vysoká s AO; na integrované grafice se už vypíná (`forDevice`) |
| Nepotřebný soubor (jen místo, za běhu nic) | v tomto průchodu nenalezen žádný s jistotou | assety v `public/` (114 souborů, ~4,8 MB) se načítají dynamicky přes `glbProps.data.ts` a cesty v kódu; bez úplného ověření dynamických cest nic nemažu |

## Plán oprav po malých, nezávisle ověřitelných krocích

Pořadí podle přínosu a rizika. Každý krok je samostatný commit s měřením před a po stejným skriptem.

| # | Krok | Nález | Ověření |
|---|---|---|---|
| 1 | `Mannequin.dispose` a `FPArms.dispose` uvolní kostry | N4 | `client.ts --scenario long`: textury stálé; nový test |
| 2 | Viditelnost rozložit do ticků (1/6 klientů na tick) | N2 | test shody viditelných; `server.ts --bots 32 --mode spread` p99 |
| 3 | Levný paprsek ano/ne pro viditelnost a zvukovou okluzi (sdílený `Ray`) | N2 | profil `castRay`; stejný test shody |
| 4 | `assignReflections` jen při změně scény | N7 | test `indoorPatched`; úsek `env` |
| 5 | HUD: postavit jednou, měnit jen změněné | N8 | A/B `nohud` ≈ 0; snímky UI |
| 6 | Statická pole vzdáleného hráče jen při změně | N3 | `server-bandwidth.json`; `net-smooth.ts` |
| 7 | Zpětný tlak (`bufferedAmount`) | N13 | test s falešným socketem |
| 8 | Týmová pole snímku serializovat jednou na tým | N15 | profil `sendSnapshot` |
| 9 | Animace vojáků: jeden průchod kostrou, bez alokací | N5 | test shody póz 1e-5; A/B úsek `soldiers` |
| 10 | Binární kvantovaný vzdálený hráč (protokol v8) | N3 | round-trip test; přenos; plynulost |
| 11 | Události spolu se snímkem a kompaktní výstřel | N9 | počet zpráv; úsek `events` |
| 12 | Stopy, obláčky a stopy střel instancované | N10 | draw calls p95 `fight16` |
| 13 | Rozpad a zlevnění `PlayerController.step` | N6 | fáze `sim`; testy pohybu |
| 14 | Měření na i5-1335U (viz MEASURING.md) → teprve pak rozhodnout o stínech (N11) a trávě | N11 | 3 × 60 s s a bez `noshadow` |
| 15 | Rapier WASM jako samostatný soubor | N14 | velikost buildu; čas do menu na notebooku |

Přínosy jednotlivých kroků **nesčítám**. Každý se změří zvlášť a po sloučení znovu celá matice.

## Tři kroky, které mají největší smysl jako první

1. **Uvolňovat kostry vojáků a FP rukou (krok 1).** Je to skutečná chyba, která roste po celou dobu hraní. Oprava je pár řádků bez herního ani vizuálního kompromisu a ověří se dlouhým během.
2. **Rozložit a zlevnit kontrolu viditelnosti (kroky 2–3).** Odstraní největší záseky serveru (až 75 ms) a zlevní server, který je na Renderu úzkým hrdlem. Ochrana proti wallhacku přitom zůstane, pokud ji pokryje test shody.
3. **Zmenšit snímky: statická pole jen při změně (krok 6) a zpětný tlak (krok 7).** Přenos je největší kvadratická položka a `sendSnapshot` se `send` dělají třetinu CPU serveru. Krok 6 je malý a dá se ověřit bez změny formátu.
   - Současně je potřeba rozhodnout o hostingu (N1). **Bez placené instance nebo hlubších úspor simulace se 16 hráčů do 0,1 CPU nevejde.**

## Změny v repozitáři (oddělené od herní logiky, snadno vratné)

- `src/client/runtime/perf.ts` – diagnostika klienta. Vypnutá, dokud není `?perf`; A/B přepínače přes `&ab=`.
- Háčky `perf.begin/end` v `src/client/app.ts` (smyčka) a `src/client/runtime/game.ts` (`update`).
- Přepínač `noanim` v `src/client/render/soldier.ts` (jen s `?perf&ab=noanim`).
- `server/gameServer.ts` – volba `profile`: fáze ticku, příchozí a odchozí zprávy podle typu, metoda `profile()`.
- `scripts/perf/` – `server.ts`, `bots.ts`, `server-matrix.sh`, `client.ts`, `client-matrix.sh`, `texleak.ts`, `summary.py`.
- `docs/perf-audit/` – tato zpráva, postup měření a surová data.

Herní chování se bez `?perf` nemění. Server bez `profile` přidá jen několik volání `performance.now()` na tick.
