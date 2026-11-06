# Potatofield

Browserová pěchotní FPS inspirovaná Battlefield 2 a integrovaný editor map.
TypeScript + Vite + Three.js, kolize a pohyb přes Rapier (stejný kód pro klienta i budoucí server).

> Stav: kroky 0–9 v pilotním rozsahu – editor map s parametrickou stavebnicí a terénem, M4A1
> s rukama a kolimátorem, lokální Conquest, autoritativní multiplayer s četami, chatem, rádiem
> a spotováním. Co je hotové, rozpracované a neověřené: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Spuštění

Potřeba: Node.js 20+ (ověřeno na 22). Žádný účet, žádné klíče, žádné placené služby.

```bash
npm install
```

```bash
npm run dev
```

Otevřete <http://localhost:5173>. Aplikace startuje v **hlavním menu** (čeština / angličtina):
**Hrát** doporučí kompatibilní server s volným místem (údaje z jeho `GET /info`, žádný falešný
seznam), **Servery** ukáže tabulku uložených adres, **Trénink** spustí offline Conquest na referenční
ulici s pilotními classami. **Editor map** otevře editor; tlačítko **☰ Menu** v jeho liště vede zpět.
V editoru **▶ Testovat** nebo **F5** přepne do hry, F5 vrátí editor se zachovanou kamerou, výběrem
i historií.

| Příkaz | Co dělá |
|---|---|
| `npm run dev` | vývojový server |
| `npm run build` | typová kontrola + produkční build do `dist/` |
| `npm test` | automatické testy (pohyb, mapový formát, generátory) |
| `npm run maps` | export referenčních map do `maps/*.json` |
| `npm run server` | lokální herní server (výchozí `maps/street_reference.json`, port 8787) |
| `npm run loadtest -- --bots 16 --seconds 60` | zátěžový test se 16 boty |
| `npm run texsheet -- out.png` | náhled všech procedurálních textur (vývoj) |
| `node scripts/editor-check.mjs <url> <dir>` | screenshoty editoru + kontrola úniků při 20 přepnutích (vyžaduje Playwright) |
| `node scripts/editor-interact.mjs <url> <dir>` | interakce myší/klávesnicí v editoru |
| `node scripts/persist-check.mjs <url> <dir>` | autosave, obnovení, chybný import, plné úložiště |

Parametry URL: `?q=low|standard|high` vynutí profil kvality, `?dev` zapne dev panel hned po startu,
`?editor` otevře rovnou editor, `?preview=servers` ukáže seznam serverů s **ukázkovými daty**
(označeno pruhem „NÁHLED – smyšlená data“, nikam se nepřipojuje).

Screenshoty UI se skutečným lokálním serverem: `node scripts/ui-shots.mjs 1920 1080 cs` (výstup
`docs/screenshots/ui/`).

## Editor

**Katalog** (levý panel) funguje jako katalog nábytku: dlaždice s náhledovými obrázky (vykreslenými
stejnými materiály jako ve hře), kategorie z rozbalovací nabídky, vyhledávání a sekce **Použito na
mapě** (assety, které mapa už obsahuje, s počtem). Klik vloží asset do středu pohledu.

| Akce | Ovládání |
|---|---|
| Volná kamera | držet **RMB** + W A S D, **Mezerník** nahoru, **Shift** dolů, kolečko při RMB = rychlost |
| Přiblížení | kolečko |
| Výběr | **LMB**; **Ctrl+LMB** přidat/odebrat; tažení LMB = výběr rámečkem; Esc zruší výběr |
| Úpravy (bez režimů) | **táhni objekt** = posun po terénu · **modrý prstenec** = rotace · **oranžové kostky** = rozměry (protilehlá strana drží) |
| Ulice | v katalogu „Ulice (kreslená body)“: klikej body na terén, **Enter**/dvojklik hotovo, **Backspace** zpět, **Esc** zrušit; u vybrané ulice táhni zelené body, ◆ přidá bod, **Shift+klik** bod smaže |
| Přichycení | mřížka 0,25/0,5/1/2 m (výchozí 0,5), rotace 15°/90°/volná; **Alt** dočasně vypne |
| Operace | **F** zaměřit, **Delete** smazat, **Ctrl+D** duplikovat |
| Historie | **Ctrl+Z** zpět, **Ctrl+Shift+Z** nebo **Ctrl+Y** znovu (jedno tažení = jedna položka) |
| Uložení | automaticky po každé operaci (stav vlevo dole); **Ctrl+S** uloží hned |
| Testovat | **F5** / tlačítko ▶ Testovat |

- **Katalog** (vlevo): klik vloží objekt doprostřed pohledu. Záložka **Scéna** = seznam objektů se
  skrytím (👁, jen editor) a zamčením (🔒).
- **Vlastnosti** (vpravo): pozice, natočení, parametry generátoru s jednotkami a mezemi, materiál,
  skrytí v editoru / zamčení / skrytí ve hře. Bez výběru = vlastnosti mapy a prostředí (slunce, mlha).
- **Všechno stojí na zemi**: vložený i přetažený objekt sedí na terénu (ve svahu se výška dorovná).
  **Doplňky** (klimatizace, markýza, cedule, žebřík) se tažením přes budovu **přilepí na stěnu**
  zády ke zdi; **nádrž** se přilepí na střechu.
- **Rozměry** (oranžové kostky) mění parametry generátoru (např. délku plotu), nikdy jen natažení
  meshe; rekvizity (bedna, sud) mají jednotné měřítko v mezích. Rozměry se mění po jednom objektu.
- **Kopírovat terén**: plot, zdi, kamenná zídka a ulice jdou po svahu (volba v parametrech, výchozí
  zapnuto); po úpravě terénu se samy přegenerují.
- **Rozpití textury** (Vlastnosti → posuvník 0–4): rozmaže textury objektu jako v BF2. Tlačítky jde
  použít na celou mapu nebo na všechny objekty stejného typu; bez výběru je posuvník pro celou mapu.
- **Testovací spawn** (modrý marker) se vybírá a posouvá jako objekt. Před testem se ověří proti
  objemu hráče; leží-li v objektu nebo pod terénem, editor nabídne nejbližší volné místo.
- **Mapa ▾**: nová mapa, uložené mapy, šablona střelnice, **import** a **export** JSON souboru.
  Mapy se ukládají do IndexedDB prohlížeče (s poslední dobrou zálohou); prohlížeč je může smazat,
  proto si důležité mapy exportujte. Chybný import nikdy nepřepíše otevřenou mapu.
- **✓ Kontrola**: chyby a upozornění mapy (neplatný spawn, chybějící assety, validace).

## Hraní v prohlížeči (nasazení)

Web běží na GitHub Pages, herní server na Render – obojí zdarma. Postup a omezení:
[docs/DEPLOY.md](docs/DEPLOY.md).

## Multiplayer

```bash
npm run server
```

V hlavním menu **Hrát** nebo **Servery** → adresa `ws://<adresa>:8787`. Připojení ukazuje fáze
(spojení, ověření verze, načtení mapy) a srozumitelné chyby (plný server, jiná verze, nedostupný
server, vypršení času). Mapu posílá server (klient ji jen validuje). Server:
`--map soubor.json --port 8787 --name "Název" --team-size 8 --ff --scenario sc_bases | --free`;
`--no-pilot --factions usmc,pla` zpřístupní celý arzenál. Protokol v3; `GET /info` vrací název,
mapu, hráče, kapacitu, pravidla a verzi.

**Pilot (výchozí):** USMC × MEC, 8 proti 8, classy Assault / Medic / Support / Sniper, 100 HP bez
regenerace. Zásah do 0 HP = **vyřazení** (15 s, lze oživit medikem – podržet E 1 s – na 50 HP, nebo
vzdát pomoc podržením G). Pád z výšky zraňuje (do ~3,5 m bez zranění, od ~12 m vyřazení). Na každém kontrolním
bodu stojí stožár s vlajkou: vlajka vlastníka je nahoře, při neutralizaci klesá, neutrální bod má
bílou vlajku dole, při zabírání stoupá vlajka nového týmu; bez hráčů se rozpracovaný postup pomalu
(20 s) vrací do klidu. Sniper: M24 (USMC, puškohled 10× mil-dot, opakovačka – po každé ráně
cyklus závěru) a SVD (MEC, PSO-1 4×). Při plném míření se obraz přepne do puškohledu; citlivost
myši klesá se zvětšením.

**Nasazení (Enter):** jedna taktická obrazovka jako v BF2 – vlevo classy v řádcích a výbava kitu
(silueta, mířidla, sloty), vpravo mapa (sever nahoru, zoom kolečkem / +−, posun tažením, Celá mapa),
na které se klikem vybírá vlajka, základna nebo velitel čety (terén nikdy); stejný výběr nabízí
rozbalovací „Místo nasazení“ dole. Nasazuje jen tlačítko Nasadit: během odpočtu potvrdí čekání
(„Čekáš na nasazení: …“, Zrušit čekání), server pak nasadí jednou. Ztráta bodu, smrt leadera,
změna výběru, oživení nebo nové kolo čekání zruší s vysvětlením – nikdy tiché přesměrování.

**Výbava v boji:** čísla 1–9 a kolečko přepínají sloty kitu (s tasením, bez obcházení reloadu);
overlay vpravo nad municí ukáže siluety, klávesy a skutečné počty. Nůž (útok zblízka), pistole,
tříštivý granát (výbuch po 3,2 s, kryt chrání), dýmovnice (25 s clona), lékárna, defibrilátor
(jediný způsob oživení) a zásobování (munice a granáty do maxima kitu).

**Velitel:** v pauze (Esc → Velitel, nebo C) se lze ucházet o roli; velitel posílá četám rozkazy
klikem do mapy a používá UAV a sken s obnovou ze serveru. Každý příkaz má stav Odesláno →
Potvrzeno / Odmítnuto podle odpovědi serveru. Shoz zásob chybí (hra nemá systém munice).

| Akce | Klávesa |
|---|---|
| Chat všem / týmu / četě | J / K / L, Enter odeslat, Esc zrušit |
| Rádiové kolo | držet Q, myší vybrat, kliknout = odeslat |
| Rozkaz čety (velitel čety) | T, pak 1 útok / 2 obrana / 3 přesun |
| Čety | Home nebo P (otevře pauzu na záložce Četa) |
| Velitel | C |
| Skóre | Tab (držet; funguje i po smrti) |

## Ovládání ve hře

| Akce | Klávesa |
|---|---|
| Pohyb | W A S D |
| Pohled | myš (Pointer Lock) |
| Sprint | levý Shift (držet, jen vpřed/šikmo vpřed) |
| Skok | Mezerník |
| Dřep | levý Ctrl (držet; v nastavení lze přepínání) |
| Leh | Z (fyzická klávesa vlevo dole – na české klávesnici popsaná **Y**) |
| Střelba / míření / přebití | LMB / RMB (přepínač) / R – přebíjet lze i za sprintu |
| Výbava (sloty) | 1 nůž · 2 pistole · 3 primární · 4 tříštivý granát · 5+ výbava classy (dýmovnice / lékárna, defibrilátor / zásobování); kolečko = další / předchozí |
| Režim střelby | B (jen podle skutečných režimů zbraně) |
| Nasazení (výbava, místo, čekání) | Enter |
| Taktická mapa | M |
| Žebřík | E nastoupit, W/S lézt, Space pustit |
| Pauza (Pokračovat / Nasazení / Nastavení / Ovládání / Odpojit) | Esc |
| Oživit (medik, defibrilátor) / vzdát pomoc (vyřazený) | LMB s defibrilátorem / držet G |
| Léčit (lékárna) / doplnit munici (zásobování) | držet LMB |
| Zpět do editoru | F5 (nebo z menu) |
| Dev panel | F3 nebo klávesa pod Esc |

Klávesy se mapují podle fyzické polohy (`KeyboardEvent.code`), popisky v menu se ukazují podle
aktuálního rozložení; v Nastavení → Ovládání lze akce přemapovat (konflikt kláves se ohlásí).
Nastavení má kategorie Obraz / Zvuk / Ovládání / Rozhraní (velikost a průhlednost HUD, velikost
textu, barvy pro barvoslepé, jazyk, síťová diagnostika) a tlačítka Použít / Zrušit / Výchozí. Hra se standardně spouští na celou obrazovku s Keyboard Lock – jinak by
kombinace Ctrl+W (dřep + vpřed) zavřela kartu prohlížeče. Lze vypnout v Nastavení.

### Dev panel (F3)

FPS a p95 času snímku, draw calls, trojúhelníky, poloha, rychlost, `grounded`, postoj a výška těla,
sprint, výdrž, ADS průběh, sim tick, zahozené simulační kroky a **důvody blokace** akcí
(např. „leh: blokace po dopadu“, „stoj: nad hlavou není místo“).

## Technická střelnice

Mapa `maps/range_technical.json` (generovaná z `src/world/maps/range.ts`):

- dráha 100 m s metrovými čarami po 5 m a cedulemi 10/25/50/75/100 m,
- figuríny na 10/25/50/100 m a jedna bočně se pohybující (35 m),
- schody 15/30/45 cm (30 cm projde, 45 cm ne), svahy 30/45/60° (60° nelze vyjít),
- nízké průchody pro dřep (strop 1,45 m) a leh (0,75 m),
- zdi, rohy, tenká zeď 5 cm, schodiště na plošinu se zídkou, kryty (bedny, sudy, bariéry, pytle).

## Struktura

```
src/shared/     konfigurace (pohyb, kamera, zbraň), mapové schéma + validace, fyzika, simulace hráče
src/world/      deterministické generátory objektů → díly (render + kolize), referenční mapy
src/client/     app (režimy), editor (dokument, historie, nástroje, UI, úložiště), render, runtime, UI
tests/          automatické testy (vitest)
maps/           přenosné mapové soubory
docs/           mapový formát, screenshoty
scripts/        vývojové nástroje (export map, náhled textur, screenshoty)
```

Klíčová myšlenka: každý objekt mapy generátor převede na seznam **dílů** (kvádr, klín, válec, štítek).
Ze stejných dílů vzniká render geometrie i kolize, takže nemohou nesouhlasit, a server je sestaví
bez DOM.

## Testovat v editoru

Bez bodů a scénářů je to volný test od markeru (figuríny na střelnici jdou sestřelit). S body
a scénáři dialog nabídne Conquest (scénář + tým): zabírání, tickety, respawn, výběr spawnu, zóny.

## Prohlížeč zbraní

`/viewer.html` – všech 12 zbraní (Hawk Type 97 jako neověřený návrh) s rukama podle frakce a classy: hip/ADS/boky, světlo, kvalita, FOV, animace přebití, počty trojúhelníků a draw calls (`?w=akm` vybere zbraň). Výchozí zbraň volného testu se volí v Nastavení. Rozpočty trojúhelníků: vlastní pohled 3 000–3 500, ostatní hráči 1 000–1 300, vzdálená varianta 200–300 – `npx tsx scripts/weapon-report.ts` je vypíše, `npx tsx scripts/weapon-budget.ts --write` po změně generátoru přepočítá stupně detailu.

## Dokumenty

- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) – checklist kroků 0–9
- [DECISIONS.md](DECISIONS.md) – pracovní volby a odchylky
- [ASSET_CREDITS.md](ASSET_CREDITS.md) – původ assetů a licence knihoven
- [docs/MAP_FORMAT.md](docs/MAP_FORMAT.md) – verzovaný mapový formát a ochranné meze
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md) – zátěžový test serveru, čekající měření klienta
- [docs/weapons/M4A1.md](docs/weapons/M4A1.md) – referenční karta první zbraně
