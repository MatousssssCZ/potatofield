# Sada 300 · A – validační report

Automaticky z `scripts/export-set.ts`. Trasa = simulovaný hráč (stejné kolize jako server) projde ulice → vchod → místnosti → patra → střecha.

| # | Model | Cíl (m) | Skutečnost (m) | Trojúhelníky LOD0 | Kolizní kvádry | Materiály | Žebříky | Trasa |
|---|---|---|---|---|---|---|---|---|
| A01 | Přízemní dům s venkovními schody | 7 × 6 × 3.2 | 8.43 × 7.40 × 5.00 | 1700 / 12000 | 34 ⚠ | 13 | 0 | ✔ 10/10 |
| A02 | Přízemní dům se zapuštěným vstupem | 8 × 6 × 3.2 | 8.22 × 6.93 × 4.26 | 1584 / 12000 | 44 ⚠ | 12 | 1 | ✔ 13/13 |
| A03 | Přízemní dům s bočním schodištěm | 6 × 8 × 3.2 | 7.66 × 8.61 × 6.00 | 2020 / 12000 | 39 ⚠ | 13 | 0 | ✔ 11/11 |
| A04 | Přízemní dům s půdorysem L | 9 × 7 × 3.2 | 9.61 × 7.54 × 4.26 | 1884 / 12000 | 54 ⚠ | 12 | 1 | ✔ 12/12 |
| A05 | Dvoupodlažní dům s hlubokým výklenkem (pilot, upravený) | 8.08 × 8.405 × 7.6 | 8.54 × 8.61 × 7.90 | 3708 / 12000 | 83 ⚠ | 14 | 1 | ✔ 11/11 |
| A06 | Dvoupodlažní dům bez výklenku (pilot, upravený) | 7.28 × 8.405 × 7.6 | 7.74 × 9.01 × 7.90 | 3720 / 12000 | 82 ⚠ | 13 | 1 | ✔ 12/12 |
| A07 | Dvoupodlažní dům s bočním zapuštěným vstupem | 8 × 7 × 6.4 | 8.22 × 8.53 × 8.10 | 3540 / 12000 | 84 ⚠ | 14 | 1 | ✔ 15/15 |
| A08 | Dvoupodlažní dům s podloubím | 10 × 8 × 6.4 | 10.54 × 8.54 × 8.30 | 3972 / 12000 | 92 ⚠ | 14 | 1 | ✔ 9/9 |
| A09 | Dvoupodlažní dům s ustoupeným patrem | 9 × 8 × 6.4 | 9.54 × 8.61 × 7.40 | 3420 / 12000 | 76 ⚠ | 12 | 1 | ✔ 12/12 |
| A10 | Dům s malým uzavřeným dvorem | 11 × 10 × 3.2 | 11.22 × 10.51 × 4.26 | 2016 / 12000 | 53 ⚠ | 14 | 1 | ✔ 9/9 |

**Neotestováno přímo ve hře** (multiplayer, reálné ovládání): vše výše je ze simulace a renderů editoru.
