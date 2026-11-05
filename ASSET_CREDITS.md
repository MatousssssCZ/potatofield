# Assety a licence

## Vlastní obsah projektu

| Asset | Původ | Poznámka |
|---|---|---|
| Všechny textury (omítky, beton, cihla, pískovec, dlažba, asfalt, písek, hlína, dřevo, kov, plátno, barva, terč) | procedurálně generované kódem `src/client/render/texgen.ts` | vlastní dílo projektu, žádný převzatý obrázek |
| Velkoplošný šum (anti-tiling) | `makeMacroNoise()` v `src/client/render/materials.ts` | vlastní |
| Geometrie objektů střelnice (kvádry, rampy, bedny, sudy, bariéry, pytle, cedule, terče) | generátory v `src/world/assets/` | vlastní, deterministické |
| M4A1, ruce, kolimátor, záblesk, nábojnice | `src/client/render/weapons/*` | vlastní programové modely; reference jen jako předloha proporcí |
| Kamufláže rukávů | `makeCamoTexture()` | vlastní vzory (ne kopie BF2) |
| Zvuky (výstřel, dopady, hitmarker) | `src/client/runtime/audio.ts` | syntetizované za běhu (WebAudio), žádné nahrávky |
| Vojáci USMC / MEC (tělo, výstroj rolí, kostra, atlas uniforem, animace) | `src/client/render/soldier/*` | vlastní programový model a procedurální animace; obrazové reference sloužily jen jako popis siluety (nevloženy do textur) |
| Gradient okolního světla, obloha | gradient vlastní; obloha = `Sky` z příkladů Three.js (MIT) | |

Zvuky, modely a textury třetích stran zatím **nejsou** použity.

## Knihovny (runtime)

| Knihovna | Verze | Licence | Použití |
|---|---|---|---|
| three | 0.186.1 | MIT | render, `Sky`, `EffectComposer`, `OutputPass` |
| @dimforge/rapier3d-compat | 0.21.0 | Apache-2.0 | kolize, pohyb postavy, raycasty |
| n8ao | 2.0.1 | ISC | ambientní zastínění (profil Vysoká) |
| postprocessing | 6.39.6 | Zlib | závislost n8ao |
| ws | 8.21.3 | MIT | WebSocket server a testovací klienti |
| @fontsource/barlow-semi-condensed | 5.3.0 | OFL-1.1 (písmo), MIT (balík) | písmo herního UI, servírované lokálně (žádný dotaz na Google Fonts) |

Všechny umožňují úpravy, distribuci v browserové hře i komerční použití; texty licencí jsou
v `node_modules/<balík>/LICENSE` a při distribuci buildu se přiloží.
