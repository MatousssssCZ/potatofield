# Sada 300 · G – validační report

Automaticky z `scripts/export-set.ts`. Trasa = simulovaný hráč (stejné kolize jako server) projde trasu modelu (ulice → vchod → místnosti → patra → střecha; u modulů průchod otvorem, výklenkem, po schodech). Kryt/průstřel = paprsky střel: okna a otvory musí propustit, zdi, pilíře a atiky krýt. Budovy s více nadzemními podlažími jsou ve výchozím stavu uzavřené (styl BF2: bez interiéru, kolize = plné objemy); u starších (A05–A20) jde interiér zapnout parametrem „Přístupný interiér“ – trasa se testuje s ním. GLB/JSON jsou ve výchozí (uzavřené) podobě.

| # | Model | Typ | Cíl (m) | Skutečnost (m) | Trojúhelníky LOD0 | Kolizní kvádry | Materiály | Žebříky | Trasa | Kryt/průstřel |
|---|---|---|---|---|---|---|---|---|---|---|
| G161 | Rovný kryt z pytlů (pilot) | přístupná | 2.48 × 0.44 × 1.04 | 2.41 × 0.53 × 1.01 | 2484 / 12000 | 1 | 1 | 0 | ✔ 1/1 | ✔ 2/2 |
| G162 | Rohový kryt z pytlů (pilot) | přístupná | 2.48 × 2.23 × 1.04 | 2.42 × 2.21 × 1.01 | 4140 / 12000 | 2 | 1 | 0 | ✔ 2/2 | ✔ 1/1 |
| G163 | Stanoviště U z pytlů (pilot) | přístupná | 2.48 × 2.23 × 1.04 | 2.43 × 2.21 × 1.01 | 6072 / 12000 | 3 | 1 | 0 | ✔ 3/3 | ✔ 2/2 |
| G164 | Obloukový kryt z pytlů | přístupná | 3.5 × 2 × 1.04 | 3.45 × 1.78 × 1.01 | 5796 / 12000 | 7 | 1 | 0 | ✔ 2/2 | ✔ 2/2 |
| G165 | Kulometné hnízdo | přístupná | 4 × 3 × 1.4 | 4.03 × 3.08 × 1.42 | 11052 / 12000 | 7 | 2 | 0 | ✔ 3/3 | ✔ 3/3 |
| G166 | Poškozené pytlové opevnění | přístupná | 3 × 1.5 × 1.04 | 3.20 × 1.46 × 1.01 | 4032 / 12000 | 2 | 2 | 0 | ✔ 1/1 | ✔ 3/3 |
| G167 | Jersey bariéra | přístupná | 3 × 0.6 × 1 | 3.00 × 0.72 × 1.01 | 84 / 12000 | 3 | 2 | 0 | ✔ 1/1 | ✔ 2/2 |
| G168 | Poškozená jersey bariéra | přístupná | 3 × 0.6 × 1 | 3.73 × 1.13 × 1.01 | 432 / 12000 | 6 | 4 | 0 | ✔ 1/1 | ✔ 2/2 |
| G169 | Jersey bariéra s plotem | přístupná | 3 × 0.6 × 2.2 | 3.00 × 0.72 × 2.22 | 256 / 12000 | 4 | 4 | 0 | ✔ 1/1 | ✔ 2/2 |
| G170 | Nízký betonový blok | přístupná | 2 × 0.8 × 1 | 2.08 × 0.87 × 1.04 | 48 / 12000 | 1 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| G171 | Vysoký betonový blok | přístupná | 1.5 × 0.8 × 2 | 1.58 × 0.87 × 2.04 | 48 / 12000 | 1 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| G172 | Betonová kostka | přístupná | 1.2 × 1.2 × 1.2 | 1.79 × 1.77 × 1.33 | 96 / 12000 | 1 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| G173 | Protitankový ježek | přístupná | 2.2 × 2.2 × 1.5 | 2.07 × 2.18 × 1.60 | 84 / 12000 | 6 | 1 | 0 | ✔ 1/1 | ✔ 1/1 |
| G174 | Poškozený ježek | přístupná | 2.2 × 2.2 × 1.5 | 2.07 × 1.77 × 1.79 | 96 / 12000 | 8 | 1 | 0 | ✔ 1/1 | ✔ 1/1 |
| G175 | Malá hromada sutě | přístupná | 2 × 1.5 × 0.8 | 2.16 × 1.73 × 0.83 | 380 / 12000 | 3 | 2 | 0 | ✔ 1/1 | ✔ 1/1 |
| G176 | Velká suť s armaturou | přístupná | 4 × 3 × 1.8 | 3.76 × 2.96 × 2.25 | 632 / 12000 | 4 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| G177 | Zřícený úsek zdi | přístupná | 5 × 2 × 2 | 5.10 × 1.89 × 2.00 | 464 / 12000 | 4 | 4 | 0 | ✔ 1/1 | ✔ 2/2 |
| G178 | Podlouhlá betonová suť | přístupná | 6 × 2 × 1.1 | 6.42 × 1.75 × 1.13 | 1352 / 12000 | 4 | 2 | 0 | ✔ 1/1 | ✔ 2/2 |
| G179 | Barikáda z auta a pneumatik | přístupná | 5.8 × 1.8 × 1.45 | 5.60 × 1.79 × 1.42 | 1096 / 12000 | 4 | 5 | 0 | ✔ 1/1 | ✔ 2/2 |
| G180 | Barikáda ze dvou vraků | přístupná | 10.6 × 3.2 × 1.45 | 10.97 × 3.55 × 1.40 | 536 / 12000 | 4 | 5 | 0 | ✔ 2/2 | ✔ 2/2 |
| G181 | Barikáda ze stolů a dveří | přístupná | 3 × 1.2 × 1.4 | 3.23 × 1.17 × 1.97 | 120 / 12000 | 6 | 2 | 0 | ✔ 1/1 | ✔ 2/2 |
| G182 | Barikáda ze skříní | přístupná | 3 × 1.5 × 2 | 3.00 × 1.10 × 2.00 | 72 / 12000 | 3 | 2 | 0 | ✔ 1/1 | ✔ 2/2 |
| G183 | Krátká betonová roura | přístupná | 2.6 × 2.5 × 2.6 | 2.60 × 2.50 × 2.60 | 228 / 12000 | 9 | 3 | 0 | ✔ 2/2 | ✔ 2/2 |
| G184 | Dlouhá betonová roura | přístupná | 2.6 × 5 × 2.6 | 2.60 × 5.00 × 2.60 | 228 / 12000 | 9 | 3 | 0 | ✔ 3/3 | ✔ 1/1 |
| G185 | Nízký stoh beden | přístupná | 2 × 1.5 × 1 | 1.90 × 1.50 × 1.00 | 48 / 12000 | 4 | 1 | 0 | ✔ 1/1 | ✔ 1/1 |
| G186 | Střední stoh beden | přístupná | 2.5 × 1.8 × 1.5 | 2.50 × 1.85 × 1.50 | 72 / 12000 | 6 | 1 | 0 | ✔ 1/1 | ✔ 1/1 |
| G187 | Vysoký stoh beden | přístupná | 3 × 2 × 2.2 | 3.00 × 2.00 × 2.00 | 96 / 12000 | 8 | 1 | 0 | ✔ 1/1 | ✔ 1/1 |
| G188 | Zeď z pneumatik | přístupná | 4 × 1.3 × 1.2 | 3.93 × 1.30 × 1.20 | 5060 / 12000 | 1 | 3 | 0 | ✔ 1/1 | ✔ 1/1 |
| G189 | Nízký hliněný val | přístupná | 6 × 2.5 × 1.1 | 6.79 × 2.50 × 1.09 | 2268 / 12000 | 3 | 1 | 0 | ✔ 2/2 | ✔ 1/1 |
| G190 | Vysoký hliněný val | přístupná | 8 × 4 × 2.1 | 8.39 × 4.00 × 2.09 | 2596 / 12000 | 4 | 1 | 0 | ✔ 2/2 | ✔ 1/1 |

**Neotestováno přímo ve hře** (multiplayer, reálné ovládání): vše výše je ze simulace a renderů editoru.
