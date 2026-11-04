# Pracovní rozhodnutí a odchylky

Všechny číselné hodnoty jsou návrhy Potatofieldu (`proposed`), ne změřené konstanty BF2.

## Stack
- **TypeScript + Vite + Three.js 0.186**, UI v čistém HTML/CSS (bez frameworku – UI neřídí snímky).
- **Rapier 0.21 (`@dimforge/rapier3d-compat`, Apache-2.0)** pro kolize, sweep postavy, raycasty a výškové
  pole. Jedna fyzika pro editor, klienta i Node server (WASM je v balíčku inline, běží i v Node).
- **Vitest** pro testy, **tsx** pro skripty. Verze uzamčeny `package-lock.json` (vše starší 2 týdnů).
- Žádné ECS, mikroslužby ani databáze.

## Kolize a controller
- Kinematický controller Rapieru (shape-cast sweep-and-slide, autostep, limit sklonu, snap-to-ground).
- **Zjištěné vlastnosti Rapieru a jejich řešení** (ověřeno testy):
  - Velmi velké kvádry (stovky m) jsou numericky nestabilní – postava se do nich propadá.
    → Kolizní kvádry se automaticky dělí na kusy s polovičním rozměrem ≤ 12 m (`MAX_COLLIDER_HALF`).
    Velké rovné plochy mají být terén.
  - Postava musí začínat s mezerou „skin“ (2 cm) nad zemí; collider je proto posunutý o `skinWidth`
    a `pos` hráče odpovídá skutečné podlaze.
  - Svislá složka požadovaného pohybu na zemi ubírá vodorovnou dráhu (diagonála až o 1,4 %).
    → Na zemi se posílá nulová svislá složka a kontakt drží snap-to-ground.
  - Výškové pole má příznak `FIX_INTERNAL_EDGES` (bez „hrbolků“ na hranách trojúhelníků). S ním
    Rapier nehlásí kontakt se zemí, proto controller používá **vlastní sondu země** (krátký sweep těla
    dolů, pochozí jen plocha ≤ 45°). Pravidlo je stejné pro klienta i server.
  - Autostep: nastaveno na `stepHeight + skinWidth`; test: 0,30 m projde, 0,45 m ne.
- Ořezání rychlosti o zeď jen u kontaktů výš než schod (jinak by autostep nedostal šanci).
- Skok: přesná integrace konstantního zrychlení → vrchol nezávisí na délce kroku (0,65 m ±0,03).

## Postoje
- Jedna veličina **výška těla** (`height`) s jedním časovým průběhem řídí collider, výšku očí
  i budoucí hitbox – žádné zvláštní časování kamery.
- Přechod: stoj↔dřep rychlostí (1,8−1,2)/0,18 s; do lehu celý rozsah stoj→leh za 0,35 s.
- Leh = **vodorovná kapsle** délky 1,8 m natočená podle těla (ne malá koule). Tělo se otáčí za
  pohledem max. 225°/s a jen když se otočený objem vejde – nohy neprojdou zdí.
- Oči v lehu jsou 0,55 m před středem těla (na hlavě), ne nad středem.
- Space ve dřepu/lehu jen požádá o stoj; tentýž stisk neskáče. Ctrl v lehu přejde do dřepu.

## Kamera a vstup
- FOV se zadává jako horizontální při 16:9 (výchozí 90°); při jiném poměru stran se drží vertikální.
- Citlivost: 0,022° na count × citlivost (výchozí 2,5). Žádné vyhlazování ani akcelerace.
- Pohled se v renderu zobrazuje okamžitě (nespotřebované delty myši), simulace je dostane v příštím ticku.
- Keyboard Lock na celé obrazovce chrání před Ctrl+W (dřep + vpřed). Bez celé obrazovky to prohlížeč
  zakázat neumí; proto je volba „Celá obrazovka“ výchozí zapnutá a hra se při odchodu ptá.

## Grafika
- **Vše procedurální a vlastní**: textury generuje `texgen.ts` ve Web Workerech (barva, normála, AO/drsnost/kov).
  Žádné stažené obrázky → licenčně čisté, nulová velikost assetů.
- Měřítko textur v metrech je zapečené do UV při generování geometrie → změna rozměru opakuje textury.
- Proti viditelnému opakování: velkoplošný šum ve shaderu (makro variace), terén míchá 2 měřítka
  a písek/hlínu podle šumu a sklonu, prach u paty objektů podle výšky nad podstavou.
- Osvětlení: slunce se stíny sledujícími hráče (přichycení na texely = bez mihotání), hemisférické světlo,
  IBL z **kontrolovaného gradientu** (shader oblohy má příliš vysoký dynamický rozsah a přehlušil by
  slunce i stíny – ověřeno screenshotem), ACES tone mapping, exponenciální mlha.
- Ambientní zastínění **N8AO** (ISC) jen v profilu Vysoká; Nízká/Standardní ho nemají (výkon iGPU).
- Profily kvality mění render scale, DPR, stíny, rozlišení textur a AO. **Nemění** kolize, herní mlhu ani kryty.
- Výchozí profil je **Vysoká** (autor má výkonné PC); měření na i5-1335U se dělá na Nízké podle zadání.

## Dočasné / placeholdery
- Puška ve FP je 3D placeholder z kvádrů bez rukou a střelby (krok 6 dodá PF-Rifle s rukama a ADS).
- Figuríny na střelnici zatím nemají hitboxy (krok 7 – projektily).

## Prostředí, kde vznikal kód
- Screenshoty v `docs/screenshots/` jsou ze skutečné aplikace, ale renderované **softwarově (SwiftShader)**
  v headless Chromiu. FPS v nich je proto bezvýznamné; výkon na skutečné GPU zatím **nebyl měřen**.
