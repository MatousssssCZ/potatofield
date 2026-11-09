# Sada 300 – modely pro editor Potatofield

Zadání: 300 modelů v sekcích A–K, dodávané po dávkách 10 ke schválení.

## Jak jsou modely udělané

Modely jsou **procedurální objekty editoru** (kód `src/world/assets/set/`), ne ručně modelované
sítě. Ze stejného popisu vzniká vzhled i kolize na klientu a na serveru, takže chodí, střílí
a leze se po nich přesně tak, jak se vykreslují. V editoru jsou v kategorii
„Sada 300 · A Obytné budovy“ (atd.) s názvem `A01 …`.

Pro každou dávku navíc vzniká podle zadání:

- `X##_nazev.glb`: síť LOD0 (metry, Y nahoru, přední strana −Z, bez textur, materiály
  pojmenované sdílenými názvy, UV v metrech),
- `X##_nazev.json`: rozměry, obálka, trojúhelníky, materiály, kolize (kvádry a rampy schodů,
  pořadí rotací Rz·Ry·Rx), žebříky, trasa průchodu,
- `manifest.json` a `VALIDACE.md`: automatický report (rozměry, limity, výsledek průchodu),
- `renders/X##.jpg`: list se 4 pohledy (zepředu, zezadu, interiér, shora) z editoru.

Vygeneruje se příkazem `npx tsx scripts/export-set.ts A`. Rendery skriptem
`node scripts/set/setshots.mjs exports/sada300/A/renders setA.` (Playwright, běžící `npm run dev`).

## Validace

- **Průchod:** u každého modelu projde simulovaný hráč (stejné kolize a pohyb jako server)
  zadanou trasu: ulice → vchod → všechny místnosti → schody / žebřík → patra → pochozí střecha.
  Totéž hlídá test `tests/set300.test.ts`, takže žádná pozdější úprava průchod nerozbije.
- **Míry:** dveře 1,2 × 2,25 m, parapety 1,0 m, atiky 1,0 m (u druhého křídla A04 0,6 m),
  stupně ≤ 0,185 m / 0,3 m, kolize schodů jako rampa, šířka ramen ≥ 1,1 m.

## Odchylky od zadání (ke schválení)

- **Počet kolizních kvádrů:** zadání říká max. 24 u budov. Se skutečnými otvory oken (kudy
  projde střela i pohled) vychází 34–92 kvádrů na budovu, protože každé okno rozdělí zeď na
  4 kvádry. Statické kvádry jsou pro fyziku levné (na mapě s 50 budovami ~4000 kvádrů).
  Pokud chceš limit 24 dodržet striktně, musely by okna mít „plnou“ kolizi a střílet by se
  jimi nedalo.
- **LOD:** procedurální budovy nemají LOD1/LOD2. Hra statické objekty slučuje podle materiálu,
  takže počet vykreslovaných částí je malý. LOD0 je vždy hluboko pod limitem 12 000.
- **A05 a A06 (pilotní P):** GLB piloty prošly kontrolou průchodu (výklenek, schody na plnou
  šířku 1,15 m, zadní žebřík na střechu: v pořádku). Měly ale jediné okno a přízemí bez oken.
  Okna do GLB vyříznout nejde, proto jsou A05/A06 věrné procedurální verze se stejnými
  rozměry z JSON a doplněnými okny. Původní GLB zůstávají beze změny v kategorii
  „Modely GLB (ChatGPT)“.

**Neotestováno přímo ve hře** (multiplayer, skuteční hráči): vše výše pochází ze simulace
a renderů editoru.
