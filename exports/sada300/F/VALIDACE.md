# Sada 300 · F – validační report

Automaticky z `scripts/export-set.ts`. Trasa = simulovaný hráč (stejné kolize jako server) projde trasu modelu (ulice → vchod → místnosti → patra → střecha; u modulů průchod otvorem, výklenkem, po schodech). Kryt/průstřel = paprsky střel: okna a otvory musí propustit, zdi, pilíře a atiky krýt. Budovy s více nadzemními podlažími jsou ve výchozím stavu uzavřené (styl BF2: bez interiéru, kolize = plné objemy); u starších (A05–A20) jde interiér zapnout parametrem „Přístupný interiér“ – trasa se testuje s ním. GLB/JSON jsou ve výchozí (uzavřené) podobě.

| # | Model | Typ | Cíl (m) | Skutečnost (m) | Trojúhelníky LOD0 | Kolizní kvádry | Materiály | Žebříky | Trasa | Kryt/průstřel |
|---|---|---|---|---|---|---|---|---|---|---|
| F136 | Rovná dvorní zeď (pilot) | přístupná | 4.15 × 0.55 × 2.3 | 4.53 × 0.53 × 2.30 | 72 / 12000 | 3 | 3 | 0 | ✔ 1/1 | ✔ 2/2 |
| F137 | Rohová dvorní zeď (pilot) | přístupná | 4.2 × 4.05 × 2.3 | 4.53 × 4.53 × 2.30 | 120 / 12000 | 5 | 3 | 0 | ✔ 5/5 | ✔ 1/1 |
| F138 | Zeď s otevřenou bránou (pilot) | přístupná | 4.1 × 1.8 × 3.08 | 4.08 × 1.87 × 3.08 | 204 / 12000 | 5 | 4 | 0 | ✔ 2/2 | ✔ 2/2 |
| F139 | Nízká dvorní zeď | přístupná | 4.4 × 0.48 × 1.4 | 4.47 × 0.48 × 1.40 | 72 / 12000 | 3 | 3 | 0 | ✔ 1/1 | ✔ 2/2 |
| F140 | Dvorní zeď se širokou bránou | přístupná | 6 × 2.2 × 2.7 | 6.00 × 2.14 × 2.70 | 240 / 12000 | 6 | 5 | 0 | ✔ 2/2 | ✔ 2/2 |
| F141 | Zeď s průchozím proražením | přístupná | 4 × 0.4 × 2.3 | 4.04 × 1.72 × 2.26 | 312 / 12000 | 11 | 4 | 0 | ✔ 2/2 | ✔ 2/2 |
| F142 | Sesutá dvorní zeď | přístupná | 4.6 × 1.4 × 2.1 | 5.10 × 1.99 × 2.30 | 408 / 12000 | 12 | 4 | 0 | ✔ 1/1 | ✔ 2/2 |
| F143 | Zeď s poškozeným vrškem | přístupná | 4 × 0.38 × 2.06 | 4.00 × 0.38 × 2.06 | 156 / 12000 | 7 | 3 | 0 | ✔ 1/1 | ✔ 2/2 |
| F144 | Rovná kamenná zídka | přístupná | 4 × 0.6 × 1 | 4.26 × 0.68 × 1.07 | 384 / 12000 | 1 | 2 | 0 | ✔ 1/1 | ✔ 2/2 |
| F145 | Rohová kamenná zídka | přístupná | 3 × 3 × 1 | 3.24 × 3.14 × 1.07 | 552 / 12000 | 2 | 2 | 0 | ✔ 2/2 | ✔ 1/1 |
| F146 | Zbořená kamenná zídka | přístupná | 4 × 0.6 × 1 | 4.26 × 2.19 × 1.04 | 1664 / 12000 | 9 | 2 | 0 | ✔ 2/2 | ✔ 2/2 |
| F147 | Betonová T-stěna | přístupná | 2 × 1.2 × 3 | 2.00 × 1.20 × 3.11 | 152 / 12000 | 2 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| F148 | Poškozená T-stěna | přístupná | 2 × 1.2 × 3 | 2.40 × 2.04 × 2.96 | 304 / 12000 | 4 | 4 | 0 | ✔ 1/1 | ✔ 2/2 |
| F149 | Rovný pletivový plot | přístupná | 4 × 0.45 × 2.5 | 4.06 × 0.38 × 2.50 | 340 / 12000 | 5 | 3 | 0 | ✔ 1/1 | ✔ 2/2 |
| F150 | Rohový pletivový plot | přístupná | 3 × 3 × 2.5 | 3.37 × 3.38 × 2.60 | 644 / 12000 | 10 | 3 | 0 | ✔ 2/2 | ✔ 1/1 |
| F151 | Pletivová brána | přístupná | 5 × 1.8 × 2.6 | 5.06 × 1.91 × 2.60 | 800 / 12000 | 12 | 3 | 0 | ✔ 2/2 | ✔ 2/2 |
| F152 | Plechový plot | přístupná | 4 × 0.2 × 2.1 | 4.08 × 0.14 × 2.10 | 232 / 12000 | 8 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| F153 | Poškozený plechový plot | přístupná | 4 × 1.6 × 2.1 | 4.08 × 2.42 × 2.10 | 244 / 12000 | 7 | 3 | 0 | ✔ 2/2 | ✔ 2/2 |
| F154 | Dřevěný plot | přístupná | 4 × 0.17 × 1.55 | 4.10 × 0.17 × 1.55 | 348 / 12000 | 4 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| F155 | Poškozený dřevěný plot | přístupná | 4 × 1.3 × 1.55 | 4.10 × 1.79 × 1.55 | 360 / 12000 | 7 | 2 | 0 | ✔ 2/2 | ✔ 3/3 |
| F156 | Rovné kovové zábradlí | přístupná | 2 × 0.06 × 1.03 | 2.06 × 0.06 × 1.02 | 124 / 12000 | 1 | 1 | 0 | ✔ 1/1 | ✔ 1/1 |
| F157 | Rohové kovové zábradlí | přístupná | 2 × 2 × 1.03 | 2.06 × 2.06 × 1.02 | 224 / 12000 | 2 | 1 | 0 | ✔ 2/2 | ✔ 1/1 |
| F158 | Průmyslová posuvná brána | přístupná | 10.6 × 1 × 2.56 | 10.30 × 0.60 × 2.56 | 260 / 12000 | 5 | 7 | 0 | ✔ 2/2 | ✔ 2/2 |
| F159 | Posuvná pletivová brána | přístupná | 12.6 × 1 × 2.56 | 12.30 × 0.60 × 2.56 | 260 / 12000 | 5 | 6 | 0 | ✔ 2/2 | ✔ 1/1 |
| F160 | Poškozená posuvná brána | přístupná | 10.6 × 1.6 × 2.56 | 10.30 × 1.48 × 2.56 | 156 / 12000 | 6 | 6 | 0 | ✔ 2/2 | ✔ 1/1 |

**Neotestováno přímo ve hře** (multiplayer, reálné ovládání): vše výše je ze simulace a renderů editoru.
