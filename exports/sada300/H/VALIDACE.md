# Sada 300 · H – validační report

Automaticky z `scripts/export-set.ts`. Trasa = simulovaný hráč (stejné kolize jako server) projde trasu modelu (ulice → vchod → místnosti → patra → střecha; u modulů průchod otvorem, výklenkem, po schodech). Kryt/průstřel = paprsky střel: okna a otvory musí propustit, zdi, pilíře a atiky krýt. Budovy s více nadzemními podlažími jsou ve výchozím stavu uzavřené (styl BF2: bez interiéru, kolize = plné objemy); u starších (A05–A20) jde interiér zapnout parametrem „Přístupný interiér“ – trasa se testuje s ním. GLB/JSON jsou ve výchozí (uzavřené) podobě.

| # | Model | Typ | Cíl (m) | Skutečnost (m) | Trojúhelníky LOD0 | Kolizní kvádry | Materiály | Žebříky | Trasa | Kryt/průstřel |
|---|---|---|---|---|---|---|---|---|---|---|
| H191 | Ohořelý sedan | přístupná | 4.5 × 1.8 × 1.4 | 1.89 × 4.62 × 1.45 | 600 / 12000 | 8 | 3 | 0 | ✔ 1/1 | ✔ 2/2 |
| H192 | Opuštěný sedan | přístupná | 4.5 × 1.8 × 1.4 | 3.21 × 4.62 × 1.45 | 780 / 12000 | 8 | 8 | 0 | ✔ 1/1 | ✔ 2/2 |
| H193 | Převrácený sedan | přístupná | 4.5 × 1.8 × 1.4 | 1.84 × 4.62 × 1.34 | 768 / 12000 | 8 | 8 | 0 | ✔ 1/1 | ✔ 1/1 |
| H194 | Ohořelé malé auto | přístupná | 3.5 × 1.62 × 1.45 | 1.71 × 3.62 × 1.40 | 600 / 12000 | 8 | 3 | 0 | ✔ 1/1 | ✔ 2/2 |
| H195 | Havarované malé auto | přístupná | 2.9 × 1.62 × 1.45 | 1.77 × 3.15 × 1.48 | 764 / 12000 | 8 | 8 | 0 | ✔ 1/1 | ✔ 2/2 |
| H196 | Ohořelý pickup (pilot) | přístupná | 2.36 × 4.73 × 1.985 | 1.93 × 4.66 × 1.95 | 440 / 12000 | 10 | 4 | 0 | ✔ 1/1 | ✔ 2/2 |
| H197 | Pickup bez korby | přístupná | 1.9 × 4.6 × 1.95 | 1.93 × 4.66 × 1.95 | 696 / 12000 | 7 | 6 | 0 | ✔ 1/1 | ✔ 1/1 |
| H198 | Ohořelá dodávka | přístupná | 3 × 5.1 × 2.3 | 3.89 × 5.18 × 2.43 | 400 / 12000 | 13 | 3 | 0 | ✔ 2/2 | ✔ 2/2 |
| H199 | Převrácená dodávka | přístupná | 2.3 × 5.1 × 2 | 2.36 × 5.18 × 3.89 | 400 / 12000 | 13 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| H200 | Průchozí autobus | přístupná | 2.5 × 10 × 3 | 3.07 × 10.00 × 2.97 | 1164 / 12000 | 38 ⚠ | 5 | 0 | ✔ 5/5 | ✔ 2/2 |
| H201 | Nákladní auto s plachtou | přístupná | 2.4 × 7 × 3.1 | 2.46 × 7.10 × 3.10 | 1228 / 12000 | 13 | 7 | 0 | ✔ 2/2 | ✔ 2/2 |
| H202 | Nákladní auto s poškozenou plachtou | přístupná | 3.3 × 7 × 3.1 | 4.52 × 7.10 × 3.10 | 1300 / 12000 | 14 | 8 | 0 | ✔ 1/1 | ✔ 1/1 |
| H203 | Silniční cisterna | přístupná | 2.4 × 8 × 3 | 2.47 × 8.10 × 3.21 | 1744 / 12000 | 8 | 8 | 0 | ✔ 1/1 | ✔ 1/1 |
| H204 | Tank s odtrženou věží | přístupná | 8 × 6.8 × 1.4 | 6.74 × 6.83 × 2.39 | 1468 / 12000 | 11 | 4 | 0 | ✔ 1/1 | ✔ 1/1 |
| H205 | Tank s poškozenými pásy | přístupná | 4.5 × 6.8 × 2.3 | 5.59 × 8.07 × 2.33 | 1232 / 12000 | 8 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| H206 | Ohořelý obrněný transportér | přístupná | 2.9 × 8.2 × 2.3 | 2.94 × 8.97 × 2.34 | 688 / 12000 | 6 | 2 | 0 | ✔ 2/2 | ✔ 1/1 |
| H207 | Převrácený transportér | přístupná | 2.5 × 8.2 × 3 | 2.51 × 8.95 × 2.92 | 580 / 12000 | 6 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| H208 | Vrak vrtulníku | přístupná | 6 × 10.5 × 3 | 6.29 × 13.43 × 3.00 | 500 / 12000 | 5 | 5 | 0 | ✔ 1/1 | ✔ 1/1 |
| H209 | Vrak motorky | přístupná | 1 × 2 × 0.4 | 1.04 × 2.03 × 0.59 | 308 / 12000 | 3 | 5 | 0 | ✔ 1/1 | – |
| H210 | Poškozené jízdní kolo | přístupná | 1 × 1.7 × 0.2 | 1.30 × 1.81 × 0.40 | 392 / 12000 | 1 | 5 | 0 | ✔ 1/1 | – |

**Neotestováno přímo ve hře** (multiplayer, reálné ovládání): vše výše je ze simulace a renderů editoru.
