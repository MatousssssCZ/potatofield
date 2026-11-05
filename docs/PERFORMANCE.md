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

Surová data: `docs/loadtest-report.json`. Tickrate se nesnižoval. Známé rezervy: plný vlastní stav
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

Draw calls ulice převyšují pracovní cíl 200 – další krok optimalizace je slučování statických
objektů po materiálech mimo editor (instancing opakovaných dílů oken).
