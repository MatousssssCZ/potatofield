# Mapový formát (schemaVersion 1)

Typy: `src/shared/map/schema.ts`, validace: `src/shared/map/validate.ts`.
Ukládají se **autorská data** (parametry generátorů, terén, herní markery), nikdy strom Three.js.

Jednotky: metry, sekundy. Osy: Y nahoru. Rotace v souboru v radiánech (UI ukazuje stupně).
Vazby se odkazují přes ID, nikdy přes jména.

## Kořen `MapDocument`

| Pole | Typ | Popis |
|---|---|---|
| `schemaVersion` | int | verze formátu; novější než podporovaná → import odmítnut s vysvětlením |
| `id`, `name`, `author?` | text | ID jen `[A-Za-z0-9_.:-]` |
| `units` | `"meters"` | |
| `terrain` | `TerrainData` | výškové pole |
| `environment` | `EnvironmentProfile` | slunce, mlha, předvolba oblohy – odděleno od geometrie |
| `objects` | `MapObject[]` | instance generátorů |
| `controlPoints`, `spawnPoints`, `zones`, `scenarios` | | herní data (Conquest, krok 5–7) |
| `testSpawn?` | `Transform` | marker pro testovací režim editoru |

## `MapObject`

```json
{ "id": "obj_001", "assetId": "prim.box", "generatorVersion": 1,
  "transform": { "position": [0, 0, 3.5], "rotation": [0, 0, 0], "scale": 1 },
  "params": { "width": 14, "height": 0.12, "depth": 7 },
  "seed": 2654435761, "material": "concrete" }
```

- `generatorVersion` brání tiché změně vzhledu: je-li v souboru vyšší než v aplikaci, objekt se zobrazí
  jako označený placeholder a jeho data zůstanou při uložení nedotčena.
- Neznámý `assetId` → placeholder, data zachována.
- Chybějící parametry doplní výchozí hodnoty generátoru, číselné se ořežou do mezí schématu.
- Trasové parametry: `points` = „x,z;x,z;…“ (lokálně, m). Cesta Skladové osady (`osada.road`) navíc
  ukládá `nodeIds` (stabilní ID uzlů „n1;n2;…“, souběžně s body), `ranges` (JSON seznam úseků povrchu
  `{id, from:{seg,t,d?}, to:{seg,t,d?}, surface, transition}`, `seg` = ID počátečního uzlu úseku,
  `t` = poměr 0–1, `d` = metry od uzlu) a `joins` (JSON `{node, road, at}`: uzel leží v uzlu `at`
  cesty `road` – T/X křižovatka). Starší soubory bez těchto parametrů fungují beze změny (výchozí hodnoty).

## `TerrainData`

`samplesX × samplesZ` výšek (řádky po X: `index = z * samplesX + x`), rozteč `spacing` m, roh `origin [x, z]`.
Render i kolize používají stejnou triangulaci.

## Ochranné meze importu (`MAP_LIMITS`)

| Mez | Hodnota | Důvod |
|---|---|---|
| velikost souboru | 32 MiB | terén 1025² vzorků s rezervou |
| objektů | 20 000 | řádově nad cílovou mapou, chrání paměť |
| vzorků terénu | 1025 × 1025 | |
| rozměr terénu | 2048 m | |
| rozteč terénu | 0,25–8 m | |
| souřadnice | ±5000 m | |
| výška terénu | ±1000 m | |
| bodů / spawnů / zón / scénářů | 32 / 512 / 256 / 16 | |
| délka textu | 200 znaků | názvy se vykreslují jako text, ne HTML |
| `points` | 4000 znaků | ~280 bodů trasy |
| `ranges`, `joins`, `nodeIds` | 20 000 znaků | strukturovaná data tras; `ranges`/`joins` musí být JSON seznam |

Meze jsou pracovní; upraví se podle měření (krok 3). Import nespouští kód ani nefetchuje URL.
