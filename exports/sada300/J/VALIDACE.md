# Sada 300 · J – validační report

Automaticky z `scripts/export-set.ts`. Trasa = simulovaný hráč (stejné kolize jako server) projde trasu modelu (ulice → vchod → místnosti → patra → střecha; u modulů průchod otvorem, výklenkem, po schodech). Kryt/průstřel = paprsky střel: okna a otvory musí propustit, zdi, pilíře a atiky krýt. Budovy s více nadzemními podlažími jsou ve výchozím stavu uzavřené (styl BF2: bez interiéru, kolize = plné objemy); u starších (A05–A20) jde interiér zapnout parametrem „Přístupný interiér“ – trasa se testuje s ním. GLB/JSON jsou ve výchozí (uzavřené) podobě.

| # | Model | Typ | Cíl (m) | Skutečnost (m) | Trojúhelníky LOD0 | Kolizní kvádry | Materiály | Žebříky | Trasa | Kryt/průstřel |
|---|---|---|---|---|---|---|---|---|---|---|
| J246 | Malá dřevěná bedna (pilot) | přístupná | 0.68 × 0.605 × 0.6 | 0.67 × 0.57 × 0.63 | 108 / 12000 | 1 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| J247 | Velká bedna s diagonální výztuhou (pilot) | přístupná | 1.23 × 0.905 × 0.9 | 1.25 × 0.85 × 0.93 | 180 / 12000 | 1 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| J248 | Bedna s kovovými pásy (pilot) | přístupná | 0.93 × 0.605 × 0.65 | 0.92 × 0.58 × 0.69 | 180 / 12000 | 1 | 3 | 0 | ✔ 1/1 | – |
| J249 | Otevřená vojenská bedna | přístupná | 1 × 1 × 1.2 | 1.00 × 0.74 × 1.17 | 120 / 12000 | 7 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| J250 | Otevřená prázdná bedna | přístupná | 1.1 × 0.6 × 0.6 | 1.02 × 0.60 × 0.64 | 72 / 12000 | 5 | 1 | 0 | ✔ 1/1 | – |
| J251 | Stojící kovový sud | přístupná | 0.63 × 0.63 × 0.92 | 0.62 × 0.62 × 0.93 | 236 / 12000 | 1 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| J252 | Plastový sud | přístupná | 0.6 × 0.6 × 0.94 | 0.60 × 0.60 × 0.94 | 264 / 12000 | 1 | 2 | 0 | ✔ 1/1 | – |
| J253 | Ležící kovový sud | přístupná | 0.9 × 0.6 × 0.6 | 0.90 × 1.06 × 0.61 | 248 / 12000 | 1 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| J254 | Prostřelený sud | přístupná | 0.63 × 0.63 × 0.92 | 0.66 × 0.63 × 0.93 | 328 / 12000 | 1 | 4 | 0 | ✔ 1/1 | – |
| J255 | Dřevěná paleta | přístupná | 1.2 × 0.8 × 0.15 | 1.20 × 0.80 × 0.15 | 240 / 12000 | 1 | 2 | 0 | ✔ 2/2 | – |
| J256 | Stoh palet | přístupná | 1.25 × 0.85 × 0.75 | 1.30 × 0.90 × 0.75 | 1200 / 12000 | 1 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| J257 | Samostatná pneumatika | přístupná | 0.7 × 0.7 × 0.22 | 0.71 × 0.71 × 0.22 | 144 / 12000 | 1 | 1 | 0 | ✔ 1/1 | – |
| J258 | Stoh pneumatik | přístupná | 0.78 × 0.75 × 0.92 | 0.79 × 0.77 × 0.90 | 576 / 12000 | 1 | 1 | 0 | ✔ 1/1 | ✔ 1/1 |
| J259 | Kanystr | přístupná | 0.35 × 0.17 × 0.5 | 0.35 × 0.18 × 0.47 | 124 / 12000 | 1 | 4 | 0 | ✔ 1/1 | – |
| J260 | Plynová láhev | přístupná | 0.3 × 0.3 × 1.2 | 0.30 × 0.30 × 1.20 | 280 / 12000 | 1 | 3 | 0 | ✔ 1/1 | – |
| J261 | Pytel s moukou / cementem | přístupná | 0.62 × 0.4 × 0.2 | 0.62 × 0.39 × 0.20 | 116 / 12000 | 1 | 1 | 0 | ✔ 1/1 | – |
| J262 | Dřevěný stůl | přístupná | 1.4 × 0.8 × 0.75 | 1.40 × 0.80 × 0.75 | 84 / 12000 | 5 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| J263 | Dřevěná židle | přístupná | 0.42 × 0.4 × 0.9 | 0.42 × 0.40 × 0.90 | 120 / 12000 | 2 | 2 | 0 | ✔ 1/1 | – |
| J264 | Plastová židle | přístupná | 0.48 × 0.48 × 0.9 | 0.49 × 0.53 × 0.89 | 108 / 12000 | 1 | 1 | 0 | ✔ 1/1 | – |
| J265 | Kovový regál | přístupná | 1.5 × 0.5 × 2 | 1.50 × 0.50 × 2.00 | 156 / 12000 | 7 | 4 | 0 | ✔ 1/1 | ✔ 1/1 |
| J266 | Dřevěná skříň | přístupná | 1.75 × 0.95 × 1.9 | 1.32 × 1.17 × 1.90 | 132 / 12000 | 7 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| J267 | Jednoduchá postel | přístupná | 0.9 × 2 × 0.8 | 0.88 × 2.00 × 0.80 | 268 / 12000 | 1 | 3 | 0 | ✔ 1/1 | – |
| J268 | Matrace na zemi | přístupná | 0.9 × 1.9 × 0.15 | 0.91 × 1.88 × 0.15 | 92 / 12000 | 1 | 1 | 0 | ✔ 2/2 | – |
| J269 | Opotřebovaný gauč | přístupná | 2 × 0.85 × 0.9 | 2.00 × 0.84 × 0.90 | 368 / 12000 | 4 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| J270 | Koberec | přístupná | 2 × 3 × 0.1 | 2.00 × 3.00 × 0.15 | 36 / 12000 | 1 | 1 | 0 | ✔ 1/1 | – |
| J271 | Stará lednice | přístupná | 0.65 × 0.68 × 1.65 | 0.65 × 0.69 × 1.65 | 88 / 12000 | 1 | 4 | 0 | ✔ 1/1 | ✔ 1/1 |
| J272 | Starý sporák | přístupná | 0.6 × 0.63 × 0.88 | 0.60 × 0.64 × 0.88 | 380 / 12000 | 1 | 6 | 0 | ✔ 1/1 | – |
| J273 | Stará televize | přístupná | 0.6 × 0.5 × 0.45 | 0.60 × 0.53 × 0.45 | 156 / 12000 | 1 | 4 | 0 | ✔ 1/1 | – |
| J274 | Stolní rádio | přístupná | 0.35 × 0.15 × 0.22 | 0.35 × 0.17 × 0.22 | 116 / 12000 | 1 | 4 | 0 | ✔ 1/1 | – |
| J275 | Interiérová suť a papíry | přístupná | 2 × 2 × 0.15 | 2.11 × 2.15 × 0.12 | 332 / 12000 | 1 | 4 | 0 | ✔ 1/1 | – |

**Neotestováno přímo ve hře** (multiplayer, reálné ovládání): vše výše je ze simulace a renderů editoru.
