# Sada 300 · A – validační report

Automaticky z `scripts/export-set.ts`. Trasa = simulovaný hráč (stejné kolize jako server) projde trasu modelu (ulice → vchod → místnosti → patra → střecha; u modulů průchod otvorem, výklenkem, po schodech). Kryt/průstřel = paprsky střel: okna a otvory musí propustit, zdi, pilíře a atiky krýt. Budovy s více nadzemními podlažími jsou ve výchozím stavu uzavřené (styl BF2: bez interiéru, kolize = plné objemy); u starších (A05–A20) jde interiér zapnout parametrem „Přístupný interiér“ – trasa se testuje s ním. GLB/JSON jsou ve výchozí (uzavřené) podobě.

| # | Model | Typ | Cíl (m) | Skutečnost (m) | Trojúhelníky LOD0 | Kolizní kvádry | Materiály | Žebříky | Trasa | Kryt/průstřel |
|---|---|---|---|---|---|---|---|---|---|---|
| A01 | Přízemní dům s venkovními schody | přístupná | 7 × 6 × 3.2 | 8.43 × 7.40 × 5.00 | 1628 / 12000 | 34 ⚠ | 13 | 0 | ✔ 10/10 | – |
| A02 | Přízemní dům se zapuštěným vstupem | přístupná | 8 × 6 × 3.2 | 8.22 × 6.93 × 4.26 | 1440 / 12000 | 44 ⚠ | 12 | 1 | ✔ 13/13 | – |
| A03 | Přízemní dům s bočním schodištěm | přístupná | 6 × 8 × 3.2 | 7.66 × 8.61 × 6.00 | 1924 / 12000 | 39 ⚠ | 13 | 0 | ✔ 11/11 | – |
| A04 | Přízemní dům s půdorysem L | přístupná | 9 × 7 × 3.2 | 9.61 × 7.54 × 4.26 | 1716 / 12000 | 54 ⚠ | 12 | 1 | ✔ 12/12 | – |
| A05 | Dvoupodlažní dům s hlubokým výklenkem (pilot, upravený) | uzavřená (interiér volitelně) | 8.08 × 8.405 × 7.6 | 8.54 × 8.61 × 7.90 | 2544 / 12000 | 14 | 12 | 1 | ✔ 11/11 | – |
| A06 | Dvoupodlažní dům bez výklenku (pilot, upravený) | uzavřená (interiér volitelně) | 7.28 × 8.405 × 7.6 | 7.74 × 9.01 × 7.90 | 2592 / 12000 | 10 | 11 | 1 | ✔ 12/12 | – |
| A07 | Dvoupodlažní dům s bočním zapuštěným vstupem | uzavřená (interiér volitelně) | 8 × 7 × 6.4 | 8.22 × 8.53 × 8.10 | 2280 / 12000 | 17 | 12 | 0 | ✔ 15/15 | – |
| A08 | Dvoupodlažní dům s podloubím | uzavřená (interiér volitelně) | 10 × 8 × 6.4 | 10.54 × 8.54 × 8.30 | 2700 / 12000 | 14 | 13 | 0 | ✔ 9/9 | – |
| A09 | Dvoupodlažní dům s ustoupeným patrem | uzavřená (interiér volitelně) | 9 × 8 × 6.4 | 9.54 × 8.61 × 7.40 | 2412 / 12000 | 15 | 11 | 1 | ✔ 12/12 | – |
| A10 | Dům s malým uzavřeným dvorem | přístupná | 11 × 10 × 3.2 | 11.22 × 10.51 × 4.26 | 1872 / 12000 | 53 ⚠ | 14 | 1 | ✔ 9/9 | – |
| A11 | Dům s protáhlým dvorem | přístupná | 8 × 15 × 3.2 | 8.47 × 15.61 × 4.26 | 2100 / 12000 | 62 ⚠ | 16 | 1 | ✔ 13/13 | – |
| A12 | Dům ve tvaru L se dvorem | uzavřená (interiér volitelně) | 12 × 12 × 6.4 | 12.54 × 12.61 × 7.46 | 3696 / 12000 | 31 ⚠ | 17 | 1 | ✔ 20/20 | – |
| A13 | Dům s centrálním dvorem | přístupná | 14 × 12 × 3.2 | 14.54 × 12.61 × 4.26 | 2640 / 12000 | 93 ⚠ | 13 | 1 | ✔ 18/18 | – |
| A14 | Třípodlažní činžák s výklenkem | uzavřená (interiér volitelně) | 10 × 9 × 9.6 | 10.86 × 10.21 × 12.66 | 4176 / 12000 | 44 ⚠ | 12 | 0 | ✔ 25/25 | – |
| A15 | Třípodlažní činžák s bočním vstupem | uzavřená (interiér volitelně) | 9 × 11 × 9.6 | 10.21 × 12.70 × 12.66 | 4164 / 12000 | 39 ⚠ | 12 | 0 | ✔ 34/34 | – |
| A16 | Třípodlažní činžák s úzkými balkony | uzavřená (interiér volitelně) | 12 × 8 × 9.6 | 12.86 × 9.04 × 12.66 | 5568 / 12000 | 42 ⚠ | 11 | 0 | ✔ 24/24 | – |
| A17 | Činžák s ustoupeným posledním podlažím | uzavřená (interiér volitelně) | 11 × 9 × 9.6 | 11.54 × 9.61 × 11.30 | 4104 / 12000 | 18 | 12 | 1 | ✔ 17/17 | – |
| A18 | Pětipodlažní činžák s centrálním průjezdem | uzavřená (interiér volitelně) | 14 × 11 × 16 | 14.86 × 11.22 × 19.06 | 9072 / 12000 | 26 ⚠ | 11 | 0 | ✔ 34/34 | – |
| A19 | Pětipodlažní činžák s bočním průjezdem | uzavřená (interiér volitelně) | 15 × 10 × 16 | 15.86 × 13.11 × 19.06 | 10272 / 12000 | 62 ⚠ | 11 | 0 | ✔ 41/41 | – |
| A20 | Rohový dům se zapuštěným rohovým vstupem | uzavřená (interiér volitelně) | 10 × 10 × 6.4 | 11.60 × 12.44 × 8.30 | 3608 / 12000 | 18 | 13 | 0 | ✔ 21/21 | – |
| A21 | Rohový dům se dvěma výlohami | přístupná | 11 × 9 × 3.2 | 11.68 × 10.77 × 4.26 | 1440 / 12000 | 43 ⚠ | 12 | 1 | ✔ 12/12 | – |
| A22 | Rohový dům se zkoseným nárožím | uzavřená | 10 × 10 × 6.4 | 10.96 × 10.96 × 8.30 | 3624 / 12000 | 26 ⚠ | 10 | 1 | ✔ 5/5 | – |
| A23 | Malý hliněný dům | přístupná | 5 × 5 × 3 | 5.15 × 5.73 × 3.95 | 1364 / 12000 | 20 | 7 | 1 | ✔ 8/8 | – |
| A24 | Hliněný dům se dvěma místnostmi | přístupná | 8 × 5 × 3 | 8.26 × 5.73 × 3.75 | 1996 / 12000 | 36 ⚠ | 7 | 1 | ✔ 7/7 | – |
| A25 | Hliněný dům s přístavkem | přístupná | 9 × 6 × 3 | 9.22 × 6.73 × 4.15 | 2300 / 12000 | 41 ⚠ | 7 | 1 | ✔ 9/9 | – |
| A26 | Hliněný dům s nepravidelným půdorysem | přístupná | 9 × 7 × 3 | 9.55 × 9.62 × 3.95 | 1000 / 12000 | 38 ⚠ | 8 | 1 | ✔ 14/14 | – |
| A27 | Vila s dvorem a terasou | uzavřená (interiér volitelně) | 16 × 14 × 6.4 | 16.54 × 14.60 × 7.36 | 4212 / 12000 | 32 ⚠ | 15 | 0 | ✔ 21/21 | – |
| A28 | Vila s obvodovou zdí | uzavřená (interiér volitelně) | 18 × 16 × 6.4 | 18.09 × 16.14 × 7.46 | 3648 / 12000 | 27 ⚠ | 14 | 1 | ✔ 29/29 | – |
| A29 | Poškozený dvoupodlažní dům | uzavřená | 8 × 7 × 6.4 | 10.13 × 12.07 × 7.46 | 2616 / 12000 | 13 | 9 | 0 | ✔ 3/3 | – |
| A30 | Poškozený třípodlažní činžák | uzavřená | 12 × 8 × 9.6 | 12.54 × 10.58 × 11.50 | 4552 / 12000 | 21 | 15 | 0 | ✔ 2/2 | – |

**Neotestováno přímo ve hře** (multiplayer, reálné ovládání): vše výše je ze simulace a renderů editoru.
