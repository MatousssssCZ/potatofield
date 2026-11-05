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
| M4A1 + ruce (lokální sestava) | 14 282 trojúhelníků, ~9 draw calls, 4 neprůhledné materiály + optika |
| Zbraň / zbraň + obě ruce (`scripts/weapon-report.ts`) | M4A1 9 492 / 14 724 · M16A2 10 108 / 15 060 · AK-101 7 108 / 12 340 · AKM 4 552 / 9 504 · QBZ-95 4 984 / 10 216 · Type 81 4 996 / 9 948 · M249 6 144 / 11 376 · PKM 5 360 / 10 592 · QBB-95 5 056 / 10 288 |
| Referenční ulice z očí (Standard) | ~230–250 draw calls, ~110 tis. trojúhelníků |
| Střelnice (Standard) | ~230 draw calls, ~40 tis. trojúhelníků |

Draw calls ulice převyšují pracovní cíl 200 – další krok optimalizace je slučování statických
objektů po materiálech mimo editor (instancing opakovaných dílů oken).
