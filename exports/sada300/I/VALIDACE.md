# Sada 300 · I – validační report

Automaticky z `scripts/export-set.ts`. Trasa = simulovaný hráč (stejné kolize jako server) projde trasu modelu (ulice → vchod → místnosti → patra → střecha; u modulů průchod otvorem, výklenkem, po schodech). Kryt/průstřel = paprsky střel: okna a otvory musí propustit, zdi, pilíře a atiky krýt. Budovy s více nadzemními podlažími jsou ve výchozím stavu uzavřené (styl BF2: bez interiéru, kolize = plné objemy); u starších (A05–A20) jde interiér zapnout parametrem „Přístupný interiér“ – trasa se testuje s ním. GLB/JSON jsou ve výchozí (uzavřené) podobě.

| # | Model | Typ | Cíl (m) | Skutečnost (m) | Trojúhelníky LOD0 | Kolizní kvádry | Materiály | Žebříky | Trasa | Kryt/průstřel |
|---|---|---|---|---|---|---|---|---|---|---|
| I211 | Lampa s jedním ramenem | přístupná | 0.4 × 2 × 7.2 | 0.36 × 2.07 × 7.18 | 264 / 12000 | 2 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| I212 | Lampa se dvěma rameny | přístupná | 0.4 × 3.6 × 8.2 | 0.36 × 3.84 × 8.18 | 408 / 12000 | 2 | 2 | 0 | ✔ 1/1 | – |
| I213 | Dřevěný elektrický sloup | přístupná | 1.8 × 0.3 × 8.2 | 1.80 × 0.29 × 8.00 | 636 / 12000 | 3 | 3 | 0 | ✔ 1/1 | – |
| I214 | Betonový elektrický sloup | přístupná | 2.2 × 0.7 × 9 | 2.20 × 0.70 × 9.00 | 244 / 12000 | 5 | 3 | 0 | ✔ 1/1 | – |
| I215 | Malá směrová tabule | přístupná | 1.2 × 0.1 × 2.5 | 1.22 × 0.10 × 2.53 | 104 / 12000 | 1 | 2 | 0 | ✔ 1/1 | – |
| I216 | Velká směrová tabule | přístupná | 3 × 0.5 × 3.7 | 3.06 × 0.50 × 3.73 | 164 / 12000 | 5 | 4 | 0 | ✔ 1/1 | – |
| I217 | Kruhová značka | přístupná | 0.6 × 0.1 × 2.25 | 0.62 × 0.10 × 2.26 | 176 / 12000 | 1 | 2 | 0 | ✔ 1/1 | – |
| I218 | Trojúhelníková značka | přístupná | 0.7 × 0.1 × 2.3 | 0.70 × 0.10 × 2.31 | 96 / 12000 | 1 | 2 | 0 | ✔ 1/1 | – |
| I219 | Obdélníková značka | přístupná | 0.6 × 0.1 × 2.4 | 0.62 × 0.10 × 2.43 | 104 / 12000 | 1 | 2 | 0 | ✔ 1/1 | – |
| I220 | Dřevěná lavička | přístupná | 1.8 × 0.5 × 0.85 | 1.80 × 0.48 × 0.85 | 108 / 12000 | 3 | 2 | 0 | ✔ 1/1 | – |
| I221 | Kovová lavička | přístupná | 1.8 × 0.5 × 0.85 | 1.80 × 0.50 × 0.85 | 156 / 12000 | 1 | 1 | 0 | ✔ 1/1 | ✔ 1/1 |
| I222 | Malý odpadkový koš | přístupná | 0.5 × 0.6 × 0.82 | 0.47 × 0.47 × 0.82 | 160 / 12000 | 2 | 3 | 0 | ✔ 1/1 | – |
| I223 | Kovová popelnice | přístupná | 0.6 × 0.6 × 1 | 0.69 × 0.66 × 1.10 | 156 / 12000 | 1 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| I224 | Velký odpadový kontejner | přístupná | 2.1 × 1.3 × 1.3 | 2.10 × 1.48 × 1.97 | 232 / 12000 | 1 | 4 | 0 | ✔ 1/1 | ✔ 1/1 |
| I225 | Telefonní budka | přístupná | 1.24 × 1.24 × 2.4 | 1.24 × 1.24 × 2.40 | 156 / 12000 | 12 | 5 | 0 | ✔ 1/1 | ✔ 1/1 |
| I226 | Autobusová zastávka | přístupná | 4.1 × 1.9 × 2.6 | 4.10 × 1.90 × 2.65 | 132 / 12000 | 8 | 6 | 0 | ✔ 2/2 | ✔ 1/1 |
| I227 | Hydrant | přístupná | 0.45 × 0.32 × 0.82 | 0.48 × 0.30 × 0.82 | 240 / 12000 | 2 | 1 | 0 | ✔ 1/1 | – |
| I228 | Ochranný sloupek | přístupná | 0.24 × 0.24 × 0.9 | 0.24 × 0.23 × 0.91 | 200 / 12000 | 2 | 2 | 0 | ✔ 1/1 | – |
| I229 | Kulatý květináč | přístupná | 0.86 × 0.86 × 0.7 | 0.85 × 0.86 × 0.70 | 236 / 12000 | 1 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| I230 | Obdélníkový květináč | přístupná | 1.88 × 0.68 × 0.7 | 1.88 × 0.68 × 0.70 | 116 / 12000 | 1 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| I231 | Klimatizace A (pilot) | přístupná | 0.88 × 0.5 × 0.7 | 1.03 × 0.47 × 0.67 | 276 / 12000 | 1 | 4 | 0 | ✔ 1/1 | – |
| I232 | Klimatizace B | přístupná | 1.2 × 0.5 × 0.6 | 1.35 × 0.48 × 0.60 | 332 / 12000 | 1 | 4 | 0 | ✔ 1/1 | – |
| I233 | Rovná markýza | přístupná | 3 × 1.5 × 0.35 | 3.02 × 1.52 × 0.30 | 136 / 12000 | 1 | 2 | 0 | ✔ 1/1 | – |
| I234 | Šikmá markýza | přístupná | 4 × 2 × 1 | 4.02 × 2.03 × 0.95 | 136 / 12000 | 1 | 2 | 0 | ✔ 1/1 | – |
| I235 | Utržená markýza | přístupná | 4 × 2 × 1 | 4.00 × 2.04 × 1.15 | 148 / 12000 | 1 | 2 | 0 | ✔ 1/1 | – |
| I236 | Dřevěné okenice | přístupná | 2.2 × 0.5 × 1.3 | 1.88 × 0.56 × 1.32 | 216 / 12000 | 2 | 3 | 0 | ✔ 1/1 | – |
| I237 | Kovové okenice | přístupná | 2.2 × 0.5 × 1.3 | 1.88 × 0.56 × 1.32 | 120 / 12000 | 2 | 2 | 0 | ✔ 1/1 | – |
| I238 | Satelitní parabola | přístupná | 0.9 × 0.95 × 0.9 | 0.90 × 0.92 × 0.87 | 224 / 12000 | 1 | 3 | 0 | ✔ 1/1 | – |
| I239 | Prázdná obchodní cedule | přístupná | 2.5 × 0.15 × 0.7 | 2.50 × 0.14 × 0.70 | 48 / 12000 | 1 | 3 | 0 | ✔ 1/1 | – |
| I240 | Kabely a rozvodná krabice | přístupná | 1.8 × 0.2 × 2.7 | 1.80 × 0.20 × 2.70 | 72 / 12000 | 1 | 3 | 0 | ✔ 1/1 | – |
| I241 | Střešní nádrž A (pilot) | přístupná | 1.6 × 1.35 × 2.12 | 1.34 × 1.29 × 2.12 | 384 / 12000 | 5 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| I242 | Střešní nádrž B | přístupná | 2.2 × 1.9 × 1.5 | 2.13 × 1.90 × 1.50 | 460 / 12000 | 2 | 4 | 0 | ✔ 1/1 | ✔ 1/1 |
| I243 | Televizní anténa | přístupná | 0.7 × 1.2 × 2 | 0.70 × 1.20 × 2.00 | 176 / 12000 | 1 | 1 | 0 | ✔ 1/1 | – |
| I244 | Solární panel | přístupná | 1.04 × 1.6 × 1.2 | 1.04 × 1.54 × 1.19 | 96 / 12000 | 1 | 2 | 0 | ✔ 1/1 | – |
| I245 | Sušák s prádlem | přístupná | 3 × 0.8 × 1.9 | 3.05 × 1.50 × 1.90 | 284 / 12000 | 3 | 6 | 0 | ✔ 1/1 | ✔ 1/1 |

**Neotestováno přímo ve hře** (multiplayer, reálné ovládání): vše výše je ze simulace a renderů editoru.
