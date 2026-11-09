# Sada 300 · K – validační report

Automaticky z `scripts/export-set.ts`. Trasa = simulovaný hráč (stejné kolize jako server) projde trasu modelu (ulice → vchod → místnosti → patra → střecha; u modulů průchod otvorem, výklenkem, po schodech). Kryt/průstřel = paprsky střel: okna a otvory musí propustit, zdi, pilíře a atiky krýt. Budovy s více nadzemními podlažími jsou ve výchozím stavu uzavřené (styl BF2: bez interiéru, kolize = plné objemy); u starších (A05–A20) jde interiér zapnout parametrem „Přístupný interiér“ – trasa se testuje s ním. GLB/JSON jsou ve výchozí (uzavřené) podobě.

| # | Model | Typ | Cíl (m) | Skutečnost (m) | Trojúhelníky LOD0 | Kolizní kvádry | Materiály | Žebříky | Trasa | Kryt/průstřel |
|---|---|---|---|---|---|---|---|---|---|---|
| K276 | Menší datlová palma (pilot) | přístupná | 4.76 × 4.26 × 6.9 | 7.97 × 7.92 × 8.16 | 2152 / 12000 | 5 | 4 | 0 | ✔ 1/1 | ✔ 2/2 |
| K277 | Vyšší nakloněná palma (pilot) | přístupná | 4.76 × 4.26 × 9.9 | 8.94 × 8.71 × 11.37 | 2248 / 12000 | 5 | 4 | 0 | ✔ 1/1 | ✔ 1/1 |
| K278 | Vysoká datlová palma | přístupná | 5.5 × 5.5 × 13 | 10.03 × 9.41 × 14.54 | 2408 / 12000 | 5 | 4 | 0 | ✔ 1/1 | – |
| K279 | Palma s prohnutým kmenem | přístupná | 6 × 5 × 9 | 9.91 × 9.38 × 10.43 | 1564 / 12000 | 5 | 4 | 0 | ✔ 1/1 | – |
| K280 | Pahýl palmy | přístupná | 3.6 × 2 × 3.6 | 3.62 × 2.14 × 3.74 | 352 / 12000 | 3 | 3 | 0 | ✔ 2/2 | ✔ 1/1 |
| K281 | Malý olivovník | přístupná | 3.6 × 3.6 × 3.5 | 2.63 × 3.15 × 3.97 | 2432 / 12000 | 2 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| K282 | Velký olivovník | přístupná | 7 × 7 × 6 | 4.94 × 5.60 × 6.64 | 2472 / 12000 | 2 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| K283 | Starý olivovník | přístupná | 5.5 × 5.5 × 4.8 | 5.31 × 4.81 × 5.35 | 1872 / 12000 | 2 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| K284 | Menší akácie | přístupná | 4.5 × 4.5 × 4 | 5.02 × 5.20 × 4.64 | 3760 / 12000 | 2 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| K285 | Strom s deštníkovitou korunou | přístupná | 10 × 10 × 8 | 10.15 × 11.26 × 9.08 | 5312 / 12000 | 2 | 3 | 0 | ✔ 1/1 | – |
| K286 | Suchý strom | přístupná | 5 × 5 × 5 | 3.80 × 3.82 × 4.90 | 728 / 12000 | 2 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| K287 | Nízký olivově zelený keř (pilot) | přístupná | 1.14 × 1.2 × 0.8 | 1.37 × 1.35 × 1.02 | 1036 / 12000 | 1 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| K288 | Rozložitý suchý keř (pilot) | přístupná | 1.04 × 1.66 × 1.18 | 1.40 × 1.64 × 1.31 | 360 / 12000 | 1 | 2 | 0 | ✔ 1/1 | – |
| K289 | Hustý zelený keř | přístupná | 1.5 × 1.5 × 1.2 | 1.74 × 1.79 × 1.73 | 1368 / 12000 | 1 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| K290 | Šedozelený pouštní keř | přístupná | 2 × 1.5 × 0.8 | 2.99 × 2.27 × 0.92 | 2248 / 12000 | 1 | 3 | 0 | ✔ 1/1 | – |
| K291 | Nízká okrasná palma | přístupná | 2.4 × 2.4 × 1.5 | 2.17 × 2.26 × 1.73 | 488 / 12000 | 1 | 2 | 0 | ✔ 1/1 | – |
| K292 | Agáve | přístupná | 1.5 × 1.5 × 1 | 1.10 × 1.18 × 1.07 | 760 / 12000 | 1 | 2 | 0 | ✔ 1/1 | – |
| K293 | Nízký trs suché trávy | přístupná | 0.6 × 0.6 × 0.3 | 0.69 × 0.56 × 0.45 | 8 / 12000 | 1 | 1 | 0 | ✔ 1/1 | – |
| K294 | Vyšší trs trávy | přístupná | 0.8 × 0.8 × 0.7 | 0.97 × 0.72 × 1.13 | 12 / 12000 | 1 | 1 | 0 | ✔ 1/1 | – |
| K295 | Malý balvan | přístupná | 1 × 0.8 × 0.55 | 1.08 × 0.76 × 0.51 | 332 / 12000 | 2 | 1 | 0 | ✔ 1/1 | ✔ 1/1 |
| K296 | Střední balvan | přístupná | 2.5 × 2 × 1.5 | 2.64 × 2.21 × 1.55 | 652 / 12000 | 3 | 1 | 0 | ✔ 1/1 | ✔ 1/1 |
| K297 | Velký balvan | přístupná | 5 × 3.5 × 2.8 | 4.97 × 3.18 × 2.85 | 1280 / 12000 | 4 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| K298 | Rovná skalní stěna | přístupná | 8 × 2 × 5 | 8.53 × 2.59 × 5.22 | 2928 / 12000 | 13 | 2 | 0 | ✔ 1/1 | ✔ 2/2 |
| K299 | Členitá skalní stěna | přístupná | 8 × 2.9 × 6 | 8.52 × 3.32 × 6.12 | 3260 / 12000 | 15 | 2 | 0 | ✔ 1/1 | ✔ 2/2 |
| K300 | Palma v květináči | přístupná | 2 × 2 × 2.5 | 2.19 × 2.29 × 2.44 | 616 / 12000 | 2 | 4 | 0 | ✔ 1/1 | ✔ 2/2 |

**Neotestováno přímo ve hře** (multiplayer, reálné ovládání): vše výše je ze simulace a renderů editoru.
