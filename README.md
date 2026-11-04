# Potatofield

Browserová pěchotní FPS inspirovaná Battlefield 2 a integrovaný editor map.
TypeScript + Vite + Three.js, kolize a pohyb přes Rapier (stejný kód pro klienta i budoucí server).

> Stav: **krok 0 + krok 1** – společný základ, sdílený controller pěšáka a technická střelnice
> s procedurálními materiály. Editor, parametrická stavebnice, 3D puška s rukama, Conquest
> a multiplayer přijdou v dalších krocích (viz [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)).

## Spuštění

Potřeba: Node.js 20+ (ověřeno na 22). Žádný účet, žádné klíče, žádné placené služby.

```bash
npm install
```

```bash
npm run dev
```

Otevřete <http://localhost:5173>. Klikněte na **Hrát**.

| Příkaz | Co dělá |
|---|---|
| `npm run dev` | vývojový server |
| `npm run build` | typová kontrola + produkční build do `dist/` |
| `npm test` | automatické testy (pohyb, mapový formát, generátory) |
| `npm run maps` | export referenčních map do `maps/*.json` |
| `npm run texsheet -- out.png` | náhled všech procedurálních textur (vývoj) |

Parametry URL: `?q=low|standard|high` vynutí profil kvality, `?dev` zapne dev panel hned po startu.

## Ovládání

| Akce | Klávesa |
|---|---|
| Pohyb | W A S D |
| Pohled | myš (Pointer Lock) |
| Sprint | levý Shift (držet, jen vpřed/šikmo vpřed) |
| Skok | Mezerník |
| Dřep | levý Ctrl (držet; v nastavení lze přepínání) |
| Leh | Z (fyzická klávesa vlevo dole – na české klávesnici popsaná **Y**) |
| Střelba / míření / přebití | LMB / RMB / R – *zbraň je zatím placeholder bez střelby (krok 6–7)* |
| Menu, uvolnění myši | Esc |
| Dev panel | F3 nebo klávesa pod Esc |

Klávesy se mapují podle fyzické polohy (`KeyboardEvent.code`), popisky v menu se ukazují podle
aktuálního rozložení. Hra se standardně spouští na celou obrazovku s Keyboard Lock – jinak by
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
src/client/     render (materiály, prostředí, svět), runtime (vstup, herní smyčka), UI
tests/          automatické testy (vitest)
maps/           přenosné mapové soubory
docs/           mapový formát, screenshoty
scripts/        vývojové nástroje (export map, náhled textur, screenshoty)
```

Klíčová myšlenka: každý objekt mapy generátor převede na seznam **dílů** (kvádr, klín, válec, štítek).
Ze stejných dílů vzniká render geometrie i kolize, takže nemohou nesouhlasit, a server je sestaví
bez DOM.

## Dokumenty

- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) – checklist kroků 0–9
- [DECISIONS.md](DECISIONS.md) – pracovní volby a odchylky
- [ASSET_CREDITS.md](ASSET_CREDITS.md) – původ assetů a licence knihoven
- [docs/MAP_FORMAT.md](docs/MAP_FORMAT.md) – verzovaný mapový formát a ochranné meze
