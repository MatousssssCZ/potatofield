# Sada 300 · C – validační report

Automaticky z `scripts/export-set.ts`. Trasa = simulovaný hráč (stejné kolize jako server) projde trasu modelu (ulice → vchod → místnosti → patra → střecha; u modulů průchod otvorem, výklenkem, po schodech). Kryt/průstřel = paprsky střel: okna a otvory musí propustit, zdi, pilíře a atiky krýt. Budovy s více nadzemními podlažími jsou ve výchozím stavu uzavřené (styl BF2: bez interiéru, kolize = plné objemy); u starších (A05–A20) jde interiér zapnout parametrem „Přístupný interiér“ – trasa se testuje s ním. GLB/JSON jsou ve výchozí (uzavřené) podobě.

| # | Model | Typ | Cíl (m) | Skutečnost (m) | Trojúhelníky LOD0 | Kolizní kvádry | Materiály | Žebříky | Trasa | Kryt/průstřel |
|---|---|---|---|---|---|---|---|---|---|---|
| C61 | Klenutý vstup A (pilot) | přístupná | 4.3 × 1.83 × 3.58 | 4.00 × 1.80 × 3.50 | 348 / 12000 | 11 | 4 | 0 | ✔ 3/3 | ✔ 2/2 |
| C62 | Klenutý vstup B (pilot) | přístupná | 5.1 × 2.23 × 3.58 | 5.08 × 2.22 × 3.50 | 360 / 12000 | 11 | 4 | 0 | ✔ 3/3 | ✔ 2/2 |
| C63 | Klenutý vstup s kamenným ostěním | přístupná | 5 × 2 × 4 | 5.00 × 2.10 × 4.00 | 480 / 12000 | 11 | 3 | 0 | ✔ 3/3 | ✔ 2/2 |
| C64 | Poškozený klenutý vstup | přístupná | 5 × 2 × 4 | 5.58 × 3.81 × 4.00 | 564 / 12000 | 14 | 6 | 0 | ✔ 3/3 | ✔ 2/2 |
| C65 | Pravoúhlý vstup se schodkem | přístupná | 4 × 1.8 × 3.2 | 4.00 × 1.88 × 3.20 | 204 / 12000 | 10 | 4 | 0 | ✔ 3/3 | ✔ 2/2 |
| C66 | Široký pravoúhlý vstup | přístupná | 5 × 2.1 × 3.2 | 5.08 × 2.22 × 3.20 | 204 / 12000 | 10 | 5 | 0 | ✔ 3/3 | ✔ 3/3 |
| C67 | Asymetrický pravoúhlý vstup | přístupná | 4 × 2.3 × 3.2 | 4.00 × 2.30 × 3.20 | 192 / 12000 | 10 | 5 | 0 | ✔ 3/3 | ✔ 3/3 |
| C68 | Poškozený pravoúhlý vstup | přístupná | 4 × 1.8 × 3.2 | 4.15 × 3.07 × 3.24 | 360 / 12000 | 14 | 6 | 0 | ✔ 3/3 | ✔ 2/2 |
| C69 | Brána s dřevěnými vraty | přístupná | 7 × 0.6 × 3.4 | 7.06 × 0.59 × 3.48 | 168 / 12000 | 6 | 4 | 0 | ✔ 2/2 | ✔ 2/2 |
| C70 | Brána s kovovými vraty | přístupná | 8 × 2.2 × 3.2 | 8.06 × 2.19 × 3.20 | 204 / 12000 | 6 | 4 | 0 | ✔ 2/2 | ✔ 2/2 |
| C71 | Klenutá dvorní brána | přístupná | 8 × 2 × 4 | 8.00 × 2.32 × 4.12 | 420 / 12000 | 9 | 4 | 0 | ✔ 2/2 | ✔ 2/2 |
| C72 | Poškozená dvorní brána | přístupná | 8 × 2 × 4 | 8.01 × 3.47 × 4.12 | 336 / 12000 | 8 | 7 | 0 | ✔ 2/2 | ✔ 2/2 |
| C73 | Přímý průjezd domem | přístupná | 3.8 × 6 × 3.6 | 3.80 × 6.16 × 3.60 | 192 / 12000 | 7 | 5 | 0 | ✔ 3/3 | ✔ 2/2 |
| C74 | Klenutý průjezd | přístupná | 3.8 × 6 × 3.6 | 3.80 × 6.16 × 3.60 | 276 / 12000 | 9 | 4 | 0 | ✔ 3/3 | ✔ 1/1 |
| C75 | Poškozený průjezd | přístupná | 7.1 × 6 × 3.6 | 7.10 × 6.16 × 3.60 | 688 / 12000 | 17 | 8 | 0 | ✔ 6/6 | ✔ 1/1 |
| C76 | Obchod s částečně staženou roletou | přístupná | 4.6 × 4.5 × 3.2 | 4.70 × 4.87 × 3.41 | 240 / 12000 | 13 | 9 | 0 | ✔ 5/5 | ✔ 2/2 |
| C77 | Široký obchodní průlez | přístupná | 6 × 4.5 × 3.2 | 6.10 × 4.87 × 3.41 | 240 / 12000 | 13 | 9 | 0 | ✔ 4/4 | ✔ 2/2 |
| C78 | Poškozená obchodní roleta | přístupná | 4.6 × 4.5 × 3.2 | 4.70 × 5.05 × 3.41 | 276 / 12000 | 15 | 9 | 0 | ✔ 4/4 | ✔ 2/2 |
| C79 | Přímý vstup do sklepa | přístupná | 3 × 7.3 × 2.8 | 7.30 × 11.35 × 1.06 | 516 / 12000 | 18 | 5 | 0 | ✔ 4/4 | ✔ 1/1 |
| C80 | Zalomený vstup do sklepa | přístupná | 6.6 × 5.6 × 2.8 | 11.40 × 7.95 × 1.06 | 588 / 12000 | 23 | 5 | 0 | ✔ 6/6 | – |
| C81 | Krytý sklepní vstup | přístupná | 3 × 7.3 × 2.8 | 7.30 × 11.35 × 2.62 | 528 / 12000 | 19 | 5 | 0 | ✔ 4/4 | – |
| C82 | Malá krytá veranda | přístupná | 3 × 2.9 × 3.3 | 3.30 × 2.90 × 3.27 | 224 / 12000 | 6 | 5 | 0 | ✔ 2/2 | – |
| C83 | Široká veranda | přístupná | 5 × 3.4 × 3.3 | 5.30 × 3.40 × 3.27 | 400 / 12000 | 12 | 5 | 0 | ✔ 3/3 | ✔ 1/1 |
| C84 | Proražená omítnutá zeď | přístupná | 4 × 0.3 × 3 | 4.00 × 1.92 × 3.00 | 444 / 12000 | 16 | 3 | 0 | ✔ 2/2 | ✔ 2/2 |
| C85 | Proražená cihlová zeď | přístupná | 4 × 0.3 × 3 | 4.00 × 1.01 × 3.00 | 456 / 12000 | 12 | 1 | 0 | ✔ 2/2 | ✔ 2/2 |

**Neotestováno přímo ve hře** (multiplayer, reálné ovládání): vše výše je ze simulace a renderů editoru.
