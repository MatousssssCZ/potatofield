# Sada 300 · A – validační report

Automaticky z `scripts/export-set.ts`. Trasa = simulovaný hráč (stejné kolize jako server) projde ulice → vchod → místnosti → patra → střecha.

| # | Model | Cíl (m) | Skutečnost (m) | Trojúhelníky LOD0 | Kolizní kvádry | Materiály | Žebříky | Trasa |
|---|---|---|---|---|---|---|---|---|
| A01 | Přízemní dům s venkovními schody | 7 × 6 × 3.2 | 8.43 × 7.40 × 5.00 | 1628 / 12000 | 34 ⚠ | 13 | 0 | ✔ 10/10 |
| A02 | Přízemní dům se zapuštěným vstupem | 8 × 6 × 3.2 | 8.22 × 6.93 × 4.26 | 1440 / 12000 | 44 ⚠ | 12 | 1 | ✔ 13/13 |
| A03 | Přízemní dům s bočním schodištěm | 6 × 8 × 3.2 | 7.66 × 8.61 × 6.00 | 1924 / 12000 | 39 ⚠ | 13 | 0 | ✔ 11/11 |
| A04 | Přízemní dům s půdorysem L | 9 × 7 × 3.2 | 9.61 × 7.54 × 4.26 | 1716 / 12000 | 54 ⚠ | 12 | 1 | ✔ 12/12 |
| A05 | Dvoupodlažní dům s hlubokým výklenkem (pilot, upravený) | 8.08 × 8.405 × 7.6 | 8.54 × 8.61 × 7.90 | 3192 / 12000 | 83 ⚠ | 14 | 1 | ✔ 11/11 |
| A06 | Dvoupodlažní dům bez výklenku (pilot, upravený) | 7.28 × 8.405 × 7.6 | 7.74 × 9.01 × 7.90 | 3204 / 12000 | 82 ⚠ | 13 | 1 | ✔ 12/12 |
| A07 | Dvoupodlažní dům s bočním zapuštěným vstupem | 8 × 7 × 6.4 | 8.22 × 8.53 × 8.10 | 3072 / 12000 | 84 ⚠ | 14 | 1 | ✔ 15/15 |
| A08 | Dvoupodlažní dům s podloubím | 10 × 8 × 6.4 | 10.54 × 8.54 × 8.30 | 3408 / 12000 | 92 ⚠ | 14 | 1 | ✔ 9/9 |
| A09 | Dvoupodlažní dům s ustoupeným patrem | 9 × 8 × 6.4 | 9.54 × 8.61 × 7.40 | 2952 / 12000 | 76 ⚠ | 12 | 1 | ✔ 12/12 |
| A10 | Dům s malým uzavřeným dvorem | 11 × 10 × 3.2 | 11.22 × 10.51 × 4.26 | 1872 / 12000 | 53 ⚠ | 14 | 1 | ✔ 9/9 |
| A11 | Dům s protáhlým dvorem | 8 × 15 × 3.2 | 8.47 × 15.61 × 4.26 | 2100 / 12000 | 62 ⚠ | 16 | 1 | ✔ 13/13 |
| A12 | Dům ve tvaru L se dvorem | 12 × 12 × 6.4 | 12.54 × 12.61 × 7.46 | 4152 / 12000 | 122 ⚠ | 16 | 1 | ✔ 20/20 |
| A13 | Dům s centrálním dvorem | 14 × 12 × 3.2 | 14.54 × 12.61 × 4.26 | 2640 / 12000 | 93 ⚠ | 13 | 1 | ✔ 18/18 |
| A14 | Třípodlažní činžák s výklenkem | 10 × 9 × 9.6 | 10.86 × 10.21 × 12.66 | 5400 / 12000 | 180 ⚠ | 14 | 0 | ✔ 25/25 |
| A15 | Třípodlažní činžák s bočním vstupem | 9 × 11 × 9.6 | 10.21 × 12.70 × 12.66 | 5472 / 12000 | 180 ⚠ | 14 | 0 | ✔ 34/34 |
| A16 | Třípodlažní činžák s úzkými balkony | 12 × 8 × 9.6 | 12.86 × 9.04 × 12.66 | 6804 / 12000 | 214 ⚠ | 13 | 0 | ✔ 24/24 |
| A17 | Činžák s ustoupeným posledním podlažím | 11 × 9 × 9.6 | 11.54 × 9.61 × 11.30 | 4980 / 12000 | 154 ⚠ | 13 | 1 | ✔ 17/17 |
| A18 | Pětipodlažní činžák s centrálním průjezdem | 14 × 11 × 16 | 14.86 × 11.22 × 19.06 | 11532 / 12000 | 407 ⚠ | 13 | 0 | ✔ 34/34 |
| A19 | Pětipodlažní činžák s bočním průjezdem | 15 × 10 × 16 | 15.86 × 13.11 × 19.06 | 11844 / 12000 | 431 ⚠ | 13 | 0 | ✔ 41/41 |
| A20 | Rohový dům se zapuštěným rohovým vstupem | 10 × 10 × 6.4 | 11.60 × 12.44 × 8.30 | 4112 / 12000 | 117 ⚠ | 14 | 1 | ✔ 21/21 |

**Neotestováno přímo ve hře** (multiplayer, reálné ovládání): vše výše je ze simulace a renderů editoru.
