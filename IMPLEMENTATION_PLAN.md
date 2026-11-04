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
- [x] Rozložení (katalog / viewport / vlastnosti / nástroje / stav), sbalitelné panely, ověřeno 1366×768
- [x] Volná kamera RMB+WASD+Q/E, Shift, kolečko; výběr LMB / Ctrl+LMB / rámeček; klik na gizmo nevybírá
- [x] Gizma W/E/R (TransformControls), F, Delete, Ctrl+D, Esc
- [x] Mřížka 0,25–2 m, rotace 15°/90°/volná, Alt vypne snap; číselné zadání s jednotkami a mezemi
- [x] Lokální/světové osy, společný pivot skupiny, hromadný posun/rotace, blokace nejednotného škálování skupiny
- [x] Testovací marker, „Testovat“/F5, validace a runtime kopie dokumentu, kontrola spawnu + nabídka opravy
- [x] Esc → menu → „Zpět do editoru“/F5; obnoví kameru, výběr i historii
- [x] 20 přepnutí: scéna 399 → 399 objektů, listenery 9 → 9, kolize 88 → 88, geometrie stabilní (+1 po zahřátí)
- [x] Psaní do polí nehýbe kamerou, nemaže a nestřílí (ověřeno skutečnými událostmi)
- [x] Skrýt/zamknout objekt (jen editor) vs. skrýt ve hře (render + kolize)

## Krok 3 – historie a persistence
- [x] Undo/redo příkazů; jedno tažení = jedna položka; pořadí objektů se obnoví přesně (test)
- [x] Sekvence vložení → posun → parametr → duplikace → smazání se vrátí i zopakuje do shodného stavu (test)
- [x] Duplikace: nové ID, stejné parametry i seed, vnitřní skupiny přemapované
- [x] IndexedDB, autosave s debounce a stavem, záloha poslední dobré verze, obnovení po zavření (ověřeno)
- [x] Export/import JSON se zachováním ID, parametrů, prostředí, spawnu; chybný import nic nepřepíše (ověřeno)
- [x] Plné úložiště → chyba ve stavovém řádku s výzvou k exportu (ověřeno simulací)
- [ ] Migrace schématu (zatím jen verze 1 – první migrace přijde s první změnou formátu)

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
