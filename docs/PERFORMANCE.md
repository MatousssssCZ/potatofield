# Výkonový report

## Server – změřeno (zátěžový test `npm run loadtest -- --bots 16 --seconds 60`)

Stroj: cloudové VM, Intel Xeon @ 2,80 GHz, 4 jádra, Node 22, Linux. Server i 16 botů ve stejném procesu.
Mapa: Referenční ulice, Conquest „Dvě základny“. Boti se pohybují, míří na nejbližšího nepřítele,
střílejí dávky, přebíjejí a respawnují. Automatizovaní klienti nejsou lidský playtest.

| Měření | Hodnota |
|---|---|
| Tick průměr / p95 / max | 2,28 / 3,76 / 11,5 ms (rozpočet 16,7 ms při 60 Hz) |
| Fronta vstupů na klienta | max 3 ticky (po opravě; dříve 30 = 0,5 s zpoždění) |
| Odchozí data serveru | ~1,8 MiB/s celkem, ~113 KiB/s na klienta **před** kompresí permessage-deflate |
| Příchozí zprávy | ~1000/s (60 vstupů/s na klienta) |
| Hra | 1314 výstřelů, 16 zásahů, zabrání bodů, bleed ticketů – zápas skutečně běžel |

Na drátě (po kompresi permessage-deflate, měřeno z TCP soketu klienta): **~17,6 KiB/s na hráče** při 16 hráčích
(nekomprimovaný JSON 118 KiB/s). Surová data: `docs/loadtest-report.json`. Tickrate se nesnižoval. Známé rezervy: plný vlastní stav
v každém snapshotu a dopady střel posílané všem – další optimalizace (delta, zájmová oblast) před
větším počtem hráčů. **Test 64 hráčů neproběhl.**

## Klient – neověřeno na cílovém zařízení

Ve vývojovém prostředí běží jen softwarový renderer (SwiftShader) – jeho FPS nic nevypovídá.
Na **i5-1335U / 16 GB / iGPU** měření **neproběhlo**. Doporučený postup: `?q=low&dev`, 1280×720,
60 s po zahřátí na pevné trase v referenční ulici; zapsat OS, prohlížeč, GPU renderer, DPR, napájení,
medián FPS, p95 snímku, draw calls a trojúhelníky (vše v dev panelu F3).

Změřené vlastnosti scény (počty, ne FPS):
| Položka | Hodnota |
|---|---|
| M4A1 + ruce (lokální sestava) | 8 716 trojúhelníků (zbraň 3 484), ~10 draw calls, 4 neprůhledné materiály + optika |
| Rozpočet zbraní (zadání autora) | vlastní pohled 3 000–3 500 · u ostatních hráčů 1 000–1 300 · vzdálená varianta 200–300 trojúhelníků |
| Zbraň v první osobě (bez rukou) | 3 418–3 498 u všech 12 zbraní (`scripts/weapon-report.ts`); zbraň + obě ruce 8,4–8,7 tis. |
| Zbraň u ostatních hráčů LOD0 / LOD1 / obrys | 1 040–1 298 / 264–300 / 36–60; přepnutí 25 m a 120 m s hysterezí 2 m |
| 63 vzdálených postav (test `worldmodel.test.ts`) | ~76 tis. viditelných trojúhelníků; ~12 draw calls na postavu (tělo bez instancingu) – další optimalizace |
| Referenční ulice z očí (Standard) | ~230–250 draw calls, ~110 tis. trojúhelníků |
| Střelnice (Standard) | ~230 draw calls, ~40 tis. trojúhelníků |

### Náklady jednoho snímku – referenční ulice z testovacího spawnu (`scripts/client-probe.mjs`, 2026-11-05)

| Kvalita | Draw calls (bez stínů) | Trojúhelníky | Paměť textur (odhad, s mipmapami) | Stínová mapa | Rozlišení renderu | AO |
|---|---|---|---|---|---|---|
| Nízká | 320 (207) | 110 tis. | **45 MB** | 1024² | 960×540 | ne |
| Standardní | 368 (207) | 136 tis. | **159 MB** | 2048² | 1280×720 | ne |
| Vysoká | 409 (217) | 145 tis. | **613 MB** | 4096² | 1280×720 (DPR až 2) | ano |

**Po optimalizaci (2026-11-05):**

| Kvalita | Draw calls – snímek s překreslením stínů / běžný snímek | Paměť textur | Pozn. |
|---|---|---|---|
| Nízká | 175 / 118 | **26 MB** (dříve 45) | 960×540 |
| Standardní | 207 / 118 | **83 MB** (dříve 159) | výchozí pro integrovanou grafiku |
| Vysoká | 228 / 128 | **310 MB** (dříve 613) | jen pro samostatnou kartu, DPR max 1,5 |

Co se změnilo:
- **Výchozí kvalita podle grafiky** (WEBGL_debug_renderer_info): integrovaná (Intel Iris Xe, AMD APU, Apple M) → Standardní,
  samostatná karta → Vysoká, softwarový render / mobil → Nízká; dokud hráč kvalitu sám nezvolí. Dřív byla výchozí Vysoká.
- **Normály a ORM v polovičním rozlišení** (barva v plném) – paměť textur na polovinu.
- **Sloučení statického světa ve hře** podle materiálu v buňkách 40 m (ořez mimo zorné pole zůstává): na ulici 137 meshů → 44.
- **Stíny ve hře 20× za s** (a při přesunu stínové kamery po 2 m) místo každého snímku; editor beze změny.
- **Únik paměti**: každé spuštění testu ponechalo 2 textury kostí rukou – opraveno (20 přepnutí bez růstu).

Původní zjištění (seřazeno podle dopadu na i5-1335U s iGPU):
1. **Paměť textur** – 123 procedurálních textur (albedo + normála + ORM pro každý materiál v plném rozlišení profilu).
   Vysoká kvalita = 613 MB ve sdílené paměti iGPU; zároveň je **Vysoká výchozí nastavení**.
2. **Draw calls** – 334 meshů / 126 materiálů bez slučování; stínový průchod přidává dalších ~160 volání každý snímek.
3. **Vzdálení hráči** – ~12 draw calls na postavu (+ stejně ve stínu): 63 postav ≈ 1 500 volání.
4. Stíny se překreslují každý snímek, i když se svět nehýbe.
5. JavaScript hry (simulace, HUD) je v profilu zanedbatelný; síť po kompresi v pořádku.

Draw calls ulice převyšují pracovní cíl 200 – další krok optimalizace je slučování statických
objektů po materiálech mimo editor (instancing opakovaných dílů oken).

### Herní UI (2026-11-05)
- Hlavní menu: 3D scéna se pod ním nekreslí (0 draw calls, jen DOM).
- HUD: DOM aktualizovaný 20×/s; minimapa = jeden `drawImage` předkresleného podkladu + značky. Silueta zbraně se kreslí jednou na zbraň.
- Taktický podklad mapy: jednorázově při vstupu do hry (≤ 2048 × 2048 px, max 6 px/m), ~16 MB paměti plátna u velké mapy.
- Neměřeno na cílovém zařízení (prostředí bez GPU).
