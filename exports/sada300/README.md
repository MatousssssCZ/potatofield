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

## Patrové budovy = uzavřené (styl BF2)

Budovy s více než jedním nadzemním podlažím jsou zvenku plné: okna mají tmavé sklo, dveře jsou
zavřené, interiér se nevytváří a kolize je pár plných kvádrů objemu (A18: 26 místo 403).
Otevřené zůstávají jen prostory, které slouží jako kryt nebo průchod: výklenky vstupů, podloubí,
průjezdy, krytý rohový vstup, u poškozených domů zřícený roh a průraz. Starší modely A05–A20 mají
hotový interiér; jde zapnout parametrem **„Přístupný interiér“** (výchozí vypnuto).
Přízemní budovy zůstávají přístupné; jejich kolize se slučují (stejný tvar, méně kvádrů).

## Dávky

- **A01–A10:** přízemní a dvoupodlažní domy (A05/A06 = upravené piloty).
- **A21–A30:** rohový obchod se dvěma otvory, zkosené nároží (uzavřený), čtyři hliněné domy
  (silné zdi se zaoblenou korunou, trámy, přístavek, vychýlené zdi), vila s podloubím a terasou,
  vila s obvodovou zdí, poškozený dvoupodlažní dům (výstup po suti na odkrytou desku) a poškozený
  činžák (průraz do vybydlené místnosti, zřícený horní roh, utržený balkon).
- **A11–A20:** domy se dvory (protáhlý, L, centrální s krytou chodbou), činžáky se 3 a 5 podlažími
  (dvouramenné schodiště s mezipodestou přes všechna podlaží až do střešní nástavby, balkony,
  ustoupené patro s terasou, průjezdy 3,5 × 3,0 m, vystouplý schodišťový trakt), rohový dům
  s krytým rohovým vstupem a výlohami do dvou ulic.
- **B31–B60 (stavební moduly):** fasády 4 m a 8 m (okno, dveře, výloha, slepá), fasády
  s výklenkem (B39/B40 podle pilotů, široký a poškozený), vnější a vnitřní rohy, štít, požární
  zeď, střešní moduly s atikou (lepí se nahoru), dvě střešní nástavby, tři venkovní schodiště
  (přímé, zalomené, do dvou podlaží), dva balkony (lepí se na zeď) a dvě podloubí.
  Konvence: pivot = střed půdorysu u paty, uliční líc −Z, zdi 0,3 m, výška fasád 3,2 m
  (parametr „Výška stěny“ 2,6–4,6 m). Rendery pro B nejsou – ověřeno testy (průchod + střely).
- **C61–C85 (vstupy a průchody):** klenuté vstupy s valenou klenbou (C61/C62 podle pilotů,
  kamenné ostění, poškozený), pravoúhlé vstupy (se schodem, široký, asymetrický, poškozený),
  čtyři brány (dřevěná, kovová, klenutá, poškozená), tři průjezdy 3 × 3 × 6 m (rovný, klenutý,
  poškozený), tři obchody s roletou (průlez jen vleže), tři sklepní vstupy 1,8 m pod terén,
  dvě verandy a dvě proražené zdi.
- **D86–D105 (obchody a vybavenost):** čtyři tržní stánky (malý, široký, rohový L, poškozený),
  kiosek a otevřená budka, dvě kavárny (s posezením pod markýzou, rohová s krytou terasou), dvě
  dílny, čerpací stanice (přístřešek 12 × 8 m, stojany, obslužná budova se sklem), městská věž
  14 m (žebříky a podesty uvnitř), kupole (lepí se nahoru), škola a úřad (patrové → uzavřené,
  interiér přepínačem; úřad má pochozí střechu po vnějším žebříku) a tři tržnice.
- **E106–E135 (průmysl a vojenské):** plechové sklady (malý, velký s volnou středovou cestou,
  poškozený), obloukové hangáry (skořepina z natočených desek), silo s obvodovou plošinou,
  vodojem s lávkou, nádrže, potrubní mosty (vysoký se servisní lávkou), portálový jeřáb,
  kontrolní stanoviště (vč. poškozeného), strážní věže (dřevěná, betonová, poškozená), bunkry
  (zalomený vstup bez průhledu, poškozený se sutí jako druhým vstupem), HESCO (4 typy),
  stany (plachta zastaví hráče, ne střelu) a anténní stožáry (lana bez kolize).
- **F136–F160 (zdi, ploty, brány):** dvorní zdi podle pilotů (rovná, roh, branka s otevřenými
  křídly), nízká zeď, zeď se širokou bránou, proražená, sesutá a s poškozeným vrškem, kamenné
  zídky (rovná, rohová, zbořená), betonové T-stěny, pletivové ploty s ostnatým vrškem (rovný,
  rohový, brána), plechové a dřevěné ploty (i poškozené s průchodem), kovové zábradlí a tři
  posuvné brány (kolejnice bez kolize).

## Editor: magnet budov

Při tažení budovy, modulu, zdi nebo krytu k jinému stejně natočenému předmětu (i otočenému
o 90° / 180°) se předmět do 0,6 m přilepí líc na líc a srovná hranu nebo střed. U kurzoru
se ukáže „🧲 Magnet: přilepeno k …“, Alt magnet (i mřížku) dočasně vypne. Doplňky (klimatizace,
střešní moduly, balkony) se dál lepí na stěnu / střechu jako dřív.

## Validace

- **Průchod:** u každého modelu projde simulovaný hráč (stejné kolize a pohyb jako server)
  zadanou trasu: ulice → vchod → všechny místnosti → schody / žebřík → patra → pochozí střecha.
  Totéž hlídá test `tests/set300.test.ts`, takže žádná pozdější úprava průchod nerozbije.
- **Kryt a průstřel (od B):** u modelů jsou zadané paprsky střel – okny, výlohami, otvory a
  mezi sloupy musí střela projít, zdmi, pilíři, atikami a plným zábradlím ne. Kovové zábradlí
  balkonů a schodů střely propustí (kolize jen pro pohyb).
- **Míry:** dveře 1,2 × 2,25 m, parapety 1,0 m, atiky 1,0 m (u druhého křídla A04 0,6 m),
  stupně ≤ 0,185 m / 0,3 m, kolize schodů jako rampa, šířka ramen ≥ 1,1 m.

## Odchylky od zadání (ke schválení)

- **Počet kolizních kvádrů:** zadání říká max. 24 u budov. Se skutečnými otvory oken (kudy
  projde střela i pohled) vychází 34–92 kvádrů na budovu, protože každé okno rozdělí zeď na
  4 kvádry. Statické kvádry jsou pro fyziku levné (na mapě s 50 budovami ~4000 kvádrů).
  Pokud chceš limit 24 dodržet striktně, musely by okna mít „plnou“ kolizi a střílet by se
  jimi nedalo.
- **Kolize:** uzavřené patrové budovy 10–62 kvádrů, přízemní 20–93 (skutečné otvory oken a dveří
  rozdělují zdi; limit 24 by vyžadoval plná okna). Verze s interiérem (volitelná) mají víc.
- **LOD:** procedurální budovy nemají LOD1/LOD2. Hra statické objekty slučuje podle materiálu,
  takže počet vykreslovaných částí je malý. LOD0 je vždy hluboko pod limitem 12 000.
- **A05 a A06 (pilotní P):** GLB piloty prošly kontrolou průchodu (výklenek, schody na plnou
  šířku 1,15 m, zadní žebřík na střechu: v pořádku). Měly ale jediné okno a přízemí bez oken.
  Okna do GLB vyříznout nejde, proto jsou A05/A06 věrné procedurální verze se stejnými
  rozměry z JSON a doplněnými okny. Původní GLB zůstávají beze změny v kategorii
  „Modely GLB (ChatGPT)“.

- **B39/B40 (pilotní P):** výklenky podle pilotů mod_facade_recess_a/b (2,0 × 1,5 m a
  2,0 × 2,0 m, nadpraží 2,7 m, dveře 1,2 × 2,4 m, výška 3,5 m). Úprava: B39 má šířku 4,0 m místo
  4,2 m, aby seděla do rastru 4 m s rovnými fasádami. Pivot = střed půdorysu, takže přední líc
  výklenkového modulu leží o 0,75 m (B39) / 1,0 m (B40) před lícem rovné fasády – při skládání
  do řady je potřeba modul posunout (v popisu modelu je uvedeno).
- **B55 zalomené schodiště:** půdorys 2,75 × 4,9 m místo ~3 × 4,5 m – horní podesta 1,0 m
  navíc, aby výstup nevedl rovnou do dveří.

- **Průlezy pod roletou (C76–C78):** nejsou to dveře – v JSON `crawl_passages` (stance prone,
  světlá výška 0,65 / 0,7 / 0,8 m). Test ověřuje, že vleže projde a vestoje ani v dřepu ne.
- **Sklepní vstupy (C79–C81):** terén je výšková mřížka bez děr, proto model nese „snížit terén“
  (JSON `terrain_cut`). Editor ho provede tlačítkem „Dorovnat terén pod předměty“ nebo
  v Kontrole („Snížit terén“). Dlážděné okolí (parametr, výchozí 2,2 m) zakrývá přechod terénu;
  na mapě s mřížkou 2 m musí mít aspoň 4,1 m – Kontrola na to upozorní. Sklep za dveřmi má
  strop 0,65 m nad terénem (nízký kryt), protože světlá výška 2,2 m se do 1,8 m hloubky nevejde.
- **C61/C62 (pilotní P):** šířka 4,0 m místo 4,2 m (stejně jako B39); oblouk je skutečná valená
  klenba v celé hloubce výklenku (pilot měl rovný strop), patka 2,2 m podle pilotu.

- **Sklo (od D98):** výlohy čerpací stanice mají sklo, které zastaví hráče, ale ne střelu
  (kolize jen pro pohyb).
- **Kolize D:** přístupné budovy s mnoha otvory mají 25–61 kvádrů (věž 61 kvůli střílnám ve
  dvou stupních); uzavřená škola 7 a úřad 10.

- **Kolize E:** velký sklad a velký hangár mají 40–60 kvádrů (regály, sloupy, čelní stěny
  hangáru po elipse); ostatní 1–24.

- **F136–F138 (pilotní P):** osy pilířů posunuté z ±1,8 na ±2,0 m, aby modul měřil 4 m a roh
  i další moduly navazovaly. Pravý pilíř je o 1 cm menší, takže dva moduly se společným
  pilířem neblikají. Parametr „Koncové pilíře“ – vypnout při řazení modulů za sebou.

**Neotestováno přímo ve hře** (multiplayer, skuteční hráči): vše výše pochází ze simulace
a renderů editoru.
