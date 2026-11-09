# Sada 300 · B – validační report

Automaticky z `scripts/export-set.ts`. Trasa = simulovaný hráč (stejné kolize jako server) projde trasu modelu (ulice → vchod → místnosti → patra → střecha; u modulů průchod otvorem, výklenkem, po schodech). Kryt/průstřel = paprsky střel: okna a otvory musí propustit, zdi, pilíře a atiky krýt. Budovy s více nadzemními podlažími jsou ve výchozím stavu uzavřené (styl BF2: bez interiéru, kolize = plné objemy); u starších (A05–A20) jde interiér zapnout parametrem „Přístupný interiér“ – trasa se testuje s ním. GLB/JSON jsou ve výchozí (uzavřené) podobě.

| # | Model | Typ | Cíl (m) | Skutečnost (m) | Trojúhelníky LOD0 | Kolizní kvádry | Materiály | Žebříky | Trasa | Kryt/průstřel |
|---|---|---|---|---|---|---|---|---|---|---|
| B31 | Fasáda 4 m s oknem | přístupná | 4 × 0.3 × 3.2 | 4.00 × 0.41 × 3.20 | 156 / 12000 | 4 | 4 | 0 | ✔ 1/1 | ✔ 3/3 |
| B32 | Fasáda 4 m s dveřmi | přístupná | 4 × 0.3 × 3.2 | 4.00 × 0.38 × 3.20 | 144 / 12000 | 3 | 4 | 0 | ✔ 2/2 | ✔ 2/2 |
| B33 | Fasáda 4 m s výlohou | přístupná | 4 × 0.3 × 3.2 | 4.00 × 0.41 × 3.20 | 264 / 12000 | 6 | 5 | 0 | ✔ 2/2 | ✔ 3/3 |
| B34 | Slepá fasáda 4 m | přístupná | 4 × 0.3 × 3.2 | 4.00 × 0.38 × 3.20 | 36 / 12000 | 1 | 3 | 0 | ✔ 1/1 | ✔ 2/2 |
| B35 | Fasáda 8 m s okny | přístupná | 8 × 0.3 × 3.2 | 8.00 × 0.41 × 3.20 | 396 / 12000 | 10 | 4 | 0 | ✔ 1/1 | ✔ 5/5 |
| B36 | Fasáda 8 m s dveřmi | přístupná | 8 × 0.3 × 3.2 | 8.00 × 0.41 × 3.20 | 372 / 12000 | 9 | 4 | 0 | ✔ 2/2 | ✔ 3/3 |
| B37 | Fasáda 8 m s výlohami | přístupná | 8 × 0.3 × 3.2 | 8.00 × 0.44 × 3.20 | 396 / 12000 | 11 | 6 | 0 | ✔ 2/2 | ✔ 4/4 |
| B38 | Slepá fasáda 8 m | přístupná | 8 × 0.3 × 3.2 | 8.00 × 0.42 × 3.20 | 48 / 12000 | 2 | 3 | 0 | ✔ 1/1 | ✔ 2/2 |
| B39 | Fasáda s výklenkem A (pilot) | přístupná | 4.3 × 1.975 × 3.58 | 4.00 × 1.90 × 3.50 | 192 / 12000 | 10 | 6 | 0 | ✔ 3/3 | ✔ 2/2 |
| B40 | Fasáda s výklenkem B (pilot) | přístupná | 5.1 × 2.475 × 3.58 | 5.04 × 2.42 × 3.50 | 204 / 12000 | 10 | 6 | 0 | ✔ 3/3 | ✔ 2/2 |
| B41 | Výklenek se širokým ostěním | přístupná | 5 × 1.9 × 3.2 | 5.04 × 2.02 × 3.20 | 240 / 12000 | 10 | 6 | 0 | ✔ 3/3 | ✔ 2/2 |
| B42 | Poškozený fasádní výklenek | přístupná | 5 × 1.9 × 3.2 | 5.24 × 3.17 × 3.20 | 492 / 12000 | 12 | 8 | 0 | ✔ 3/3 | ✔ 2/2 |
| B43 | Vnější roh | přístupná | 2 × 2 × 3.2 | 2.08 × 2.08 × 3.20 | 72 / 12000 | 2 | 3 | 0 | ✔ 2/2 | ✔ 2/2 |
| B44 | Vnější roh se zesíleným nárožím | přístupná | 2.15 × 2.15 × 3.3 | 2.23 × 2.23 × 3.38 | 120 / 12000 | 3 | 4 | 0 | ✔ 2/2 | ✔ 1/1 |
| B45 | Vnitřní roh | přístupná | 2 × 2 × 3.2 | 2.08 × 2.08 × 3.20 | 48 / 12000 | 2 | 2 | 0 | ✔ 2/2 | ✔ 1/1 |
| B46 | Vnitřní roh s oknem | přístupná | 3 × 2 × 3.2 | 3.00 × 2.00 × 3.20 | 120 / 12000 | 5 | 3 | 0 | ✔ 2/2 | ✔ 2/2 |
| B47 | Štítová stěna | přístupná | 6 × 0.3 × 4.5 | 6.13 × 0.40 × 4.60 | 76 / 12000 | 3 | 4 | 0 | ✔ 1/1 | ✔ 2/2 |
| B48 | Stěna s požární zdí | přístupná | 6 × 0.3 × 4.4 | 6.08 × 0.40 × 4.48 | 48 / 12000 | 1 | 3 | 0 | ✔ 1/1 | ✔ 2/2 |
| B49 | Střecha 4 × 4 m | přístupná | 4 × 4 × 1.2 | 4.04 × 4.08 × 1.26 | 96 / 12000 | 4 | 4 | 0 | ✔ 3/3 | ✔ 1/1 |
| B50 | Střecha 4 × 8 m | přístupná | 4 × 8 × 1.2 | 4.04 × 8.49 × 1.26 | 96 / 12000 | 3 | 6 | 0 | ✔ 2/2 | ✔ 2/2 |
| B51 | Střecha s poškozenou atikou | přístupná | 4 × 4 × 1.2 | 4.04 × 4.08 × 1.26 | 300 / 12000 | 10 | 5 | 0 | ✔ 3/3 | ✔ 2/2 |
| B52 | Malá střešní nástavba | přístupná | 2.5 × 3 × 2.7 | 2.70 × 3.20 × 2.71 | 132 / 12000 | 7 | 4 | 0 | ✔ 2/2 | ✔ 1/1 |
| B53 | Širší střešní nástavba | přístupná | 4 × 3.5 × 2.8 | 4.21 × 3.70 × 2.81 | 228 / 12000 | 10 | 5 | 0 | ✔ 2/2 | ✔ 2/2 |
| B54 | Přímé venkovní schodiště | přístupná | 1.4 × 6.6 × 4.2 | 1.40 × 6.90 × 4.27 | 500 / 12000 | 4 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| B55 | Zalomené venkovní schodiště | přístupná | 3 × 4.5 × 4.2 | 2.75 × 4.92 × 4.22 | 840 / 12000 | 14 | 3 | 0 | ✔ 3/3 | ✔ 1/1 |
| B56 | Schodiště do dvou podlaží | přístupná | 2.5 × 7.8 × 7.4 | 2.52 × 7.80 × 7.42 | 1092 / 12000 | 13 | 3 | 0 | ✔ 5/5 | – |
| B57 | Balkon se zděným zábradlím | přístupná | 3 × 1.4 × 1.2 | 3.06 × 1.43 × 1.24 | 96 / 12000 | 4 | 4 | 0 | ✔ 2/2 | ✔ 1/1 |
| B58 | Balkon s kovovým zábradlím | přístupná | 2.5 × 1.3 × 1.2 | 2.50 × 1.30 × 1.19 | 192 / 12000 | 4 | 2 | 0 | ✔ 2/2 | ✔ 1/1 |
| B59 | Podloubí se třemi oblouky | přístupná | 5 × 2 × 3.6 | 5.08 × 2.10 × 3.60 | 480 / 12000 | 15 | 4 | 0 | ✔ 3/3 | ✔ 2/2 |
| B60 | Podloubí s rovnými překlady | přístupná | 4 × 2.5 × 3.4 | 4.08 × 2.56 × 3.40 | 96 / 12000 | 5 | 5 | 0 | ✔ 4/4 | ✔ 2/2 |

**Neotestováno přímo ve hře** (multiplayer, reálné ovládání): vše výše je ze simulace a renderů editoru.
