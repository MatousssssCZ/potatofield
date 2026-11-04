# Implementační plán

Zdroj zadání: *Potatofield – editor mapy* (autorita pro editor, formát, stavebnici, prostředí, Conquest)
a *Potatofield – pohyb, pohled a zbraň* (autorita pro controller, kameru, zbraň, projektily, síť).
Jeden projekt, jeden controller, jeden mapový formát.

Legenda: `[x]` hotovo a ověřeno testem/během, `[~]` částečně, `[ ]` zbývá.

## Krok 0 – společný základ
- [x] Struktura `shared / world / client / tests / maps / docs`, Vite + TS + Three.js, lockfile
- [x] Sdílená konfigurace pohybu, kamery a PF-Rifle se stavem `proposed`
- [x] Mapové schéma (`MapDocument`) a validace (verze, typy, konečná čísla, meze, odkazy, duplicitní ID)
- [x] Registr generátorů s `assetId`, `generatorVersion`, schématem parametrů; placeholder pro chybějící asset
- [x] Načtení jedné mapy (střelnice) a dev panel
- [x] README, DECISIONS, ASSET_CREDITS, popis formátu
- [x] Čistý build bez účtu a klíčů (`npm install && npm run build`)

## Krok 1 – technická scéna a hráč
- [x] Pointer Lock, přemapovatelné vstupy podle `code`, čištění při blur/visibility/ztrátě zámku
- [x] Pevný simulační krok 60 Hz, interpolovaný render, omezené dohánění po zásecích
- [x] Kinematický sweep-and-slide controller (Rapier KCC), schody 0,30 m ano / 0,45 m ne, svah 45°
- [x] Normalizovaná diagonála, vzad 3,2 m/s, akcelerace/brzdění, air control bez zisku rychlosti
- [x] Výdrž (8 s sprintu, skok 20, prodlevy, práh 15), skok 0,65 m, interval 0,45 s, nový stisk
- [x] Postoje stoj/dřep/leh s testem prostoru, společný průběh výšky pro collider, oči i hitbox
- [x] Ležící tělo jako vodorovný objem 1,8 m; otáčení do zdi blokováno; blokace lehu po dopadu
- [x] Kamera: FOV 90° H@16:9 se zachováním vertikálního, pitch ±89°, bob, kick při dopadu
- [x] Střelnice dle zadání (dráha, terče, schody, svahy, průchody, zdi, tenká zeď)
- [x] Procedurální PBR materiály (Web Workery), obloha s mraky, slunce se stíny, IBL, mlha, AO (Vysoká)
- [~] Placeholder pušky (3D, bez rukou a střelby) – finální v kroku 6
- [ ] Výkonové měření na i5-1335U (čeká na zařízení; měření v tomto prostředí neproběhlo)

## Krok 2 – editor a přepnutí
- [ ] Rozložení (katalog / viewport / inspektor / nástroje / stav), sbalitelné panely, 1366×768
- [ ] Volná kamera RMB+WASD, výběr LMB/Ctrl/rámeček, gizma W/E/R, F, Delete, Ctrl+D
- [ ] Mřížka 0,25–2 m, snap rotace, číselné zadání, lokální/světové osy, skupinový pivot
- [ ] Testovací marker, „Testovat“/F5, runtime kopie dokumentu, Esc → menu → zpět do editoru
- [ ] Test: 20 přepnutí bez nárůstu entit/listenerů

## Krok 3 – historie a persistence
- [ ] Undo/redo (jedno tažení = jedna položka), duplikace se správnými vazbami
- [ ] IndexedDB, autosave s debounce, poslední dobrá verze, export/import JSON, kvóta → nabídka exportu

## Krok 4 – parametrické objekty
- [ ] Plot/zeď (10 m → 5 polí, 11 m → 6 polí), napojování koncových bodů
- [ ] Budovy: obytná, obchodní, průmyslová, hotel (moduly ~3 m, patra ~3 m, atika)
- [ ] Bunkr, budka, malý domek (průchozí dveře ~1,0×2,1 m)
- [ ] Schody, žebřík (E, W/S, Space, bezpečný výstup), most, silnice/chodník

## Krok 5 – terén a markery
- [ ] Štětce zvýšit/snížit/vyhladit/srovnat, undo tahu, synchronizace kolizí
- [ ] Vlajky, spawny, zóny, vizualizace objemů, scénáře, kontrola mapy

## Krok 6 – 3D zbraň a dotažená ulice
- [ ] PF-Rifle s rukama, attachment body, ADS přes mířidla, animace, reload, blokace u zdi
- [ ] Referenční ulice 60–80 m, předvolby prostředí, výkonový report

## Krok 7 – lokální Conquest
## Krok 8 – dva síťoví hráči
## Krok 9 – zátěž 16 hráčů a předvolby prostředí
