# Sada 300 · E – validační report

Automaticky z `scripts/export-set.ts`. Trasa = simulovaný hráč (stejné kolize jako server) projde trasu modelu (ulice → vchod → místnosti → patra → střecha; u modulů průchod otvorem, výklenkem, po schodech). Kryt/průstřel = paprsky střel: okna a otvory musí propustit, zdi, pilíře a atiky krýt. Budovy s více nadzemními podlažími jsou ve výchozím stavu uzavřené (styl BF2: bez interiéru, kolize = plné objemy); u starších (A05–A20) jde interiér zapnout parametrem „Přístupný interiér“ – trasa se testuje s ním. GLB/JSON jsou ve výchozí (uzavřené) podobě.

| # | Model | Typ | Cíl (m) | Skutečnost (m) | Trojúhelníky LOD0 | Kolizní kvádry | Materiály | Žebříky | Trasa | Kryt/průstřel |
|---|---|---|---|---|---|---|---|---|---|---|
| E106 | Malý plechový sklad | přístupná | 8 × 10 × 5 | 8.56 × 10.70 × 5.08 | 528 / 12000 | 20 | 5 | 0 | ✔ 3/3 | ✔ 2/2 |
| E107 | Velký sklad | přístupná | 14 × 20 × 7 | 14.56 × 20.70 × 7.08 | 1056 / 12000 | 39 ⚠ | 4 | 0 | ✔ 5/5 | ✔ 2/2 |
| E108 | Poškozený sklad | přístupná | 8 × 10 × 5 | 9.23 × 10.70 × 5.08 | 660 / 12000 | 24 | 6 | 0 | ✔ 3/3 | ✔ 2/2 |
| E109 | Malý obloukový hangár | přístupná | 12 × 18 × 7 | 12.14 × 18.00 × 7.07 | 636 / 12000 | 23 | 3 | 0 | ✔ 3/3 | ✔ 2/2 |
| E110 | Velký obloukový hangár | přístupná | 20 × 30 × 10 | 20.14 × 30.00 × 10.07 | 1440 / 12000 | 60 ⚠ | 6 | 0 | ✔ 6/6 | ✔ 2/2 |
| E111 | Válcové silo | přístupná | 4 × 4 × 11.7 | 4.30 × 4.30 × 11.62 | 2120 / 12000 | 15 | 4 | 1 | ✔ 3/3 | ✔ 1/1 |
| E112 | Vodojem na ocelových nohách | přístupná | 6.8 × 6.8 × 14.6 | 6.90 × 6.85 × 14.60 | 1756 / 12000 | 23 | 4 | 1 | ✔ 3/3 | ✔ 2/2 |
| E113 | Nízká průmyslová nádrž | přístupná | 5 × 5 × 4.3 | 6.50 × 5.40 × 5.21 | 1016 / 12000 | 10 | 4 | 1 | ✔ 2/2 | ✔ 1/1 |
| E114 | Svislé palivové nádrže | přístupná | 9 × 4.5 × 5.6 | 9.00 × 4.50 × 5.60 | 1184 / 12000 | 10 | 5 | 0 | ✔ 2/2 | ✔ 2/2 |
| E115 | Vodorovné palivové nádrže | přístupná | 5.2 × 6.2 × 3.2 | 5.24 × 6.20 × 3.22 | 1504 / 12000 | 12 | 4 | 0 | ✔ 1/1 | ✔ 2/2 |
| E116 | Nízký potrubní most | přístupná | 8 × 2.6 × 3.9 | 8.00 × 2.60 × 3.84 | 240 / 12000 | 13 | 3 | 0 | ✔ 3/3 | ✔ 1/1 |
| E117 | Vysoký potrubní most | přístupná | 12 × 3.8 × 7.4 | 12.05 × 4.63 × 7.42 | 1140 / 12000 | 24 | 3 | 1 | ✔ 4/4 | ✔ 2/2 |
| E118 | Portálový jeřáb | přístupná | 13.2 × 5.6 × 10 | 18.00 × 5.60 × 10.00 | 408 / 12000 | 9 | 4 | 0 | ✔ 3/3 | ✔ 1/1 |
| E119 | Kontrolní stanoviště s budkou | přístupná | 8 × 5 × 5.1 | 7.90 × 5.00 × 5.10 | 240 / 12000 | 16 | 7 | 0 | ✔ 3/3 | ✔ 2/2 |
| E120 | Stanoviště s pytli a přístřeškem | přístupná | 5 × 4 × 2.5 | 5.21 × 4.03 × 2.57 | 1788 / 12000 | 10 | 4 | 0 | ✔ 2/2 | ✔ 2/2 |
| E121 | Poškozené kontrolní stanoviště | přístupná | 8 × 5 × 2.7 | 8.11 × 5.00 × 2.65 | 336 / 12000 | 17 | 9 | 0 | ✔ 3/3 | ✔ 2/2 |
| E122 | Dřevěná strážní věž | přístupná | 3.6 × 3.6 × 7.3 | 3.60 × 3.59 × 7.42 | 564 / 12000 | 14 | 5 | 1 | ✔ 2/2 | ✔ 2/2 |
| E123 | Betonová strážní věž | přístupná | 3.5 × 3.5 × 8 | 3.80 × 3.80 × 8.00 | 516 / 12000 | 20 | 4 | 1 | ✔ 4/4 | ✔ 2/2 |
| E124 | Poškozená strážní věž | přístupná | 3.6 × 3.6 × 7.3 | 4.46 × 4.60 × 7.48 | 588 / 12000 | 14 | 5 | 1 | ✔ 2/2 | ✔ 2/2 |
| E125 | Malý bunkr | přístupná | 5 × 5.5 × 2.8 | 5.50 × 6.01 × 2.80 | 468 / 12000 | 13 | 3 | 0 | ✔ 3/3 | ✔ 3/3 |
| E126 | Široký bunkr | přístupná | 8 × 6.7 × 3 | 8.20 × 6.80 × 3.00 | 216 / 12000 | 18 | 2 | 0 | ✔ 5/5 | ✔ 2/2 |
| E127 | Poškozený bunkr | přístupná | 5 × 5.4 × 2.8 | 5.48 × 5.63 × 2.80 | 528 / 12000 | 13 | 4 | 0 | ✔ 4/4 | ✔ 2/2 |
| E128 | Nízká HESCO stěna | přístupná | 4 × 1 × 1.1 | 4.00 × 1.02 × 1.10 | 96 / 12000 | 1 | 2 | 0 | ✔ 1/1 | ✔ 2/2 |
| E129 | Vysoká HESCO stěna | přístupná | 4 × 1 × 2.2 | 4.00 × 1.02 × 2.23 | 1376 / 12000 | 1 | 3 | 0 | ✔ 1/1 | ✔ 2/2 |
| E130 | Rohová HESCO stěna | přístupná | 3 × 3 × 2.2 | 3.01 × 3.01 × 2.23 | 1720 / 12000 | 2 | 3 | 0 | ✔ 2/2 | ✔ 1/1 |
| E131 | HESCO stěna s průchodem | přístupná | 5.5 × 1 × 2.2 | 5.50 × 1.02 × 2.23 | 1376 / 12000 | 2 | 3 | 0 | ✔ 2/2 | ✔ 2/2 |
| E132 | Malý vojenský stan | přístupná | 4 × 5 × 3 | 4.41 × 5.26 × 3.00 | 400 / 12000 | 5 | 2 | 0 | ✔ 2/2 | ✔ 1/1 |
| E133 | Velký vojenský stan | přístupná | 6 × 10 × 3.5 | 6.41 × 10.26 × 3.50 | 1100 / 12000 | 8 | 2 | 0 | ✔ 2/2 | ✔ 1/1 |
| E134 | Nízký anténní stožár | přístupná | 8 × 8 × 9 | 7.53 × 6.60 × 9.00 | 964 / 12000 | 2 | 4 | 0 | ✔ 1/1 | – |
| E135 | Vysoký anténní stožár | přístupná | 14 × 14 × 17.5 | 12.72 × 11.10 × 17.50 | 1528 / 12000 | 2 | 5 | 0 | ✔ 1/1 | ✔ 1/1 |

**Neotestováno přímo ve hře** (multiplayer, reálné ovládání): vše výše je ze simulace a renderů editoru.
