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

## Editor
- Jedna scéna, jeden renderer, **jedna kamera** pro editor i test; editor si pamatuje pozici kamery,
  výběr a historii. Test pracuje s runtime kopií dokumentu; kolize jsou sdílené, protože se v testu
  nemění (žádná destrukce).
- Každá změna mapy je příkaz se stavem objektu *před* a *po* (ne diff polí) – jednoduché, robustní,
  undo vrací přesný autorský stav včetně pořadí.
- Při změně objektu se přegeneruje jen on: render i kolize (stará geometrie se uvolní).
- Rotace gizmem jen kolem svislé osy (městská stavebnice; X/Z rotace by rozbily parametrické stavby).
- Během tažení rozměrového handlu je jen lehký náhled (natažení existujícího meshe); po puštění se
  hodnota přepočte na parametry generátoru, přichytí na mřížku a ořízne do mezí, mesh se přegeneruje.
- Dočasné vypnutí přichycení: **Alt** (Ctrl je výběr, Shift rychlost kamery).
- Při prvním spuštění se otevře šablona střelnice, ať je co prohlížet; „Nová mapa“ je v menu Mapa.
  Šablona dostane vlastní ID, takže úpravy nepřepíší referenční soubor.
- Nejbližší volné místo pro spawn: spirála po 0,5 m do 40 m, položení paprskem na povrch, test kapslí hráče.

## Zbraň a pohyb vojáků
- Vizuálně M4A1 (grafické zadání), pravidla střelby zůstávají PF-Rifle z původního zadání (600 RPM, 30/120, …).
- **Přebíjení za sprintu je povolené** (zadání „Pohyb vojáků“, kap. 10) – sprint reload nepřeruší; střelba během reloadu blokována.
- Recoil = zbývající offset zamíření (návrat jen tohoto offsetu); rozptyl = rovnoměrný kužel ze seedu
  serveru a pořadí výstřelu; kosmetické kopnutí jen v renderu.
- Herní ústí ze sdíleného profilu PF_RIG (oči → ústí → bod zamíření); blízká překážka zbraň stáhne a pod 0,55 m blokuje střelbu.
- Kolimátor: tečka v shaderu podle směru pohledu vůči ose optiky (kolimace), viditelná jen průhledem tubusu; ADS přiblížení 1,35× je prezentace kamery.
- Ruce: skinned mesh (1 draw call/ruka), pózy = data; full-body IK se nepoužívá.
- Každá zbraň má vlastní vizuální rig: hip póza se odvozuje z polohy rukojeti (rukojeť všech zbraní leží na stejném místě obrazu), ADS klade `opticEye` do středu pohledu. Herní ústí a blokace hlavně zůstávají ze sdíleného PF_RIG – vzhled zbraně nemění pravidla.
- Mechanická mířidla: skutečný otvor clony (M16A2) / výřez hledí (AK, Type 81), bez HUD tečky. Otvory jsou mírně větší než předloha kvůli čitelnosti při 720p (herní úprava, uvedeno v kartách).
- Dřevo sdílí materiál „polymer“ (roughness 0,74, barva vrcholů) – drží limit 4 neprůhledných materiálů sestavy.
- U QBZ-95 jsou mechanická mířidla sklopená, aby nezasahovala do průhledu kolimátoru.

## Multiplayer
- JSON přes WebSocket (`ws`, MIT), permessage-deflate. Server 60 Hz, snapshot 30 Hz, interpolace 100 ms.
- Fronta vstupů ≤ 3 ticky; přebytek se slučuje (stisky a pohyb myši se zachovají) – zátěžový test odhalil zpoždění 0,5 s.
- Bez lag compensation: zásahy proti aktuální poloze na serveru (vysoký ping je nevýhoda – přiznáno).
- Spot: server ověřuje kužel 1,5°, dosah 200 m a viditelnost paprskem; „podezřelá oblast“ je jen na viditelném povrchu.
- Hitmarker (zásah) dostává jen střelec a oběť; chat/kontakty/čety se distribuují podle týmu a čety.
- Referenční ulice obsahuje testovací Conquest data (5 bodů, 2 scénáře) jen pro síťový pilot.

## Dočasné / placeholdery
- Support a Engineer zbraně (6) nejsou hotové (prohlížeč je označuje „čeká“, v nastavení nejsou).
- World model vojáka je jednoduchá figura bez skeletu (kolena/kyčle pózy ze stavu); 3P rig podle zadání pohybu vojáků zbývá.
- Ruce: póza levé ruky a prstů vyžaduje další ladění.

## Prostředí, kde vznikal kód
- Screenshoty v `docs/screenshots/` jsou ze skutečné aplikace, ale renderované **softwarově (SwiftShader)**
  v headless Chromiu. FPS v nich je proto bezvýznamné; výkon na skutečné GPU zatím **nebyl měřen**.
