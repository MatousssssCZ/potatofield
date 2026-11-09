# Sada 300 · D – validační report

Automaticky z `scripts/export-set.ts`. Trasa = simulovaný hráč (stejné kolize jako server) projde trasu modelu (ulice → vchod → místnosti → patra → střecha; u modulů průchod otvorem, výklenkem, po schodech). Kryt/průstřel = paprsky střel: okna a otvory musí propustit, zdi, pilíře a atiky krýt. Budovy s více nadzemními podlažími jsou ve výchozím stavu uzavřené (styl BF2: bez interiéru, kolize = plné objemy); u starších (A05–A20) jde interiér zapnout parametrem „Přístupný interiér“ – trasa se testuje s ním. GLB/JSON jsou ve výchozí (uzavřené) podobě.

| # | Model | Typ | Cíl (m) | Skutečnost (m) | Trojúhelníky LOD0 | Kolizní kvádry | Materiály | Žebříky | Trasa | Kryt/průstřel |
|---|---|---|---|---|---|---|---|---|---|---|
| D86 | Malý tržní stánek | přístupná | 2.5 × 2 × 2.6 | 2.72 × 2.31 × 2.71 | 180 / 12000 | 6 | 7 | 0 | ✔ 2/2 | ✔ 2/2 |
| D87 | Široký tržní stánek | přístupná | 4 × 2.5 × 2.8 | 4.22 × 2.87 × 2.94 | 360 / 12000 | 9 | 7 | 0 | ✔ 4/4 | ✔ 2/2 |
| D88 | Rohový tržní stánek | přístupná | 4 × 4 × 2.7 | 4.22 × 4.41 × 2.79 | 384 / 12000 | 10 | 8 | 0 | ✔ 4/4 | ✔ 2/2 |
| D89 | Poškozený tržní stánek | přístupná | 2.5 × 2 × 2.6 | 2.87 × 3.25 × 2.72 | 192 / 12000 | 6 | 7 | 0 | ✔ 2/2 | ✔ 2/2 |
| D90 | Prodejní kiosek | přístupná | 3 × 3 × 2.8 | 3.50 × 3.50 × 2.79 | 348 / 12000 | 13 | 7 | 0 | ✔ 2/2 | ✔ 2/2 |
| D91 | Otevřená prodejní budka | přístupná | 3 × 2.5 × 2.6 | 3.10 × 3.35 × 2.72 | 192 / 12000 | 5 | 8 | 0 | ✔ 2/2 | ✔ 2/2 |
| D92 | Malá kavárna s posezením | přístupná | 6 × 5 × 3.4 | 6.21 × 8.23 × 4.06 | 1092 / 12000 | 25 ⚠ | 7 | 0 | ✔ 5/5 | ✔ 2/2 |
| D93 | Rohová kavárna | přístupná | 8 × 7 × 3.4 | 8.22 × 7.16 × 4.06 | 1288 / 12000 | 37 ⚠ | 8 | 0 | ✔ 8/8 | ✔ 2/2 |
| D94 | Malá dílna | přístupná | 6 × 8 × 4 | 6.21 × 8.20 × 4.00 | 384 / 12000 | 17 | 7 | 0 | ✔ 4/4 | ✔ 2/2 |
| D95 | Autodílna se dvěma vjezdy | přístupná | 12 × 9 × 4.5 | 12.20 × 9.31 × 4.50 | 720 / 12000 | 28 ⚠ | 9 | 0 | ✔ 9/9 | ✔ 2/2 |
| D96 | Přístřešek čerpací stanice | přístupná | 12 × 8 × 5 | 12.10 × 8.10 × 5.00 | 228 / 12000 | 9 | 4 | 0 | ✔ 2/2 | ✔ 1/1 |
| D97 | Čerpací stojany | přístupná | 4 × 1.2 × 2.1 | 4.06 × 1.26 × 2.08 | 400 / 12000 | 5 | 9 | 0 | ✔ 3/3 | ✔ 2/2 |
| D98 | Obslužná budova čerpací stanice | přístupná | 8 × 6 × 3.7 | 8.60 × 7.73 × 3.76 | 744 / 12000 | 29 ⚠ | 8 | 0 | ✔ 7/7 | ✔ 2/2 |
| D99 | Městská věž | přístupná | 4 × 4 × 14 | 4.22 × 4.22 × 14.00 | 2124 / 12000 | 61 ⚠ | 6 | 3 | ✔ 10/10 | ✔ 2/2 |
| D100 | Kupole | přístupná | 6 × 6 × 3.5 | 6.15 × 6.15 × 3.51 | 956 / 12000 | 4 | 3 | 0 | ✔ 2/2 | ✔ 1/1 |
| D101 | Školní budova | uzavřená (interiér volitelně) | 22 × 10 × 7.2 | 22.22 × 12.13 × 7.26 | 4020 / 12000 | 7 | 8 | 0 | ✔ 18/18 | – |
| D102 | Úřední budova | uzavřená (interiér volitelně) | 18 × 12 × 7.4 | 18.22 × 13.51 × 7.46 | 3632 / 12000 | 10 | 9 | 1 | ✔ 14/14 | – |
| D103 | Malá otevřená tržnice | přístupná | 10 × 8 × 3.3 | 10.40 × 8.44 × 3.28 | 684 / 12000 | 13 | 9 | 0 | ✔ 5/5 | ✔ 2/2 |
| D104 | Dlouhá krytá tržnice | přístupná | 20 × 8 × 3.5 | 20.40 × 8.44 × 3.48 | 1344 / 12000 | 19 | 9 | 0 | ✔ 8/8 | ✔ 2/2 |
| D105 | Poškozená tržnice | přístupná | 20 × 8 × 3.5 | 20.75 × 8.44 × 3.48 | 1320 / 12000 | 20 | 12 | 0 | ✔ 3/3 | ✔ 2/2 |

**Neotestováno přímo ve hře** (multiplayer, reálné ovládání): vše výše je ze simulace a renderů editoru.
