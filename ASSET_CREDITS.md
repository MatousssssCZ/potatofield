# Assety a licence

## Vlastní obsah projektu

| Asset | Původ | Poznámka |
|---|---|---|
| Všechny textury (omítky, beton, cihla, pískovec, dlažba, asfalt, písek, hlína, dřevo, kov, plátno, barva, terč) | procedurálně generované kódem `src/client/render/texgen.ts` | vlastní dílo projektu, žádný převzatý obrázek |
| Velkoplošný šum (anti-tiling) | `makeMacroNoise()` v `src/client/render/materials.ts` | vlastní |
| Geometrie objektů střelnice (kvádry, rampy, bedny, sudy, bariéry, pytle, cedule, terče) | generátory v `src/world/assets/` | vlastní, deterministické |
| Rig úchopů rukou v první osobě (záložní ruce), kolimátor, puškohled, záblesk, nábojnice; zbraně bez modelu z balíčku (M249, PKM, PLA) a záložní modely všech zbraní | `src/client/render/weapons/*` | vlastní programové modely; reference jen jako předloha proporcí |
| Kamufláže rukávů | `makeCamoTexture()` | vlastní vzory (ne kopie BF2) |
| Zvuky (výstřel, dopady, hitmarker) | `src/client/runtime/audio.ts` | syntetizované za běhu (WebAudio), žádné nahrávky |
| Vojáci USMC / MEC (tělo, výstroj rolí, kostra, atlas uniforem, animace) | `src/client/render/soldier/*` | vlastní programový model a procedurální animace; obrazové reference sloužily jen jako popis siluety (nevloženy do textur) |
| Gradient okolního světla, obloha | gradient vlastní; obloha = `Sky` z příkladů Three.js (MIT) | |

## Modely třetích stran

| Asset | Autor / zdroj | Licence | Použití |
|---|---|---|---|
| CC0 Flat Guns West (Rifle_Assault, Sniper_Rifle, Pistol_Full) | Pichuliru – [OpenGameArt](https://opengameart.org/content/cc0-flat-guns-west), [itch.io](https://pichuliru.itch.io/cc0-flat-guns-west) | CC0 dle OpenGameArt (itch.io uvádí CC-BY 4.0 – autora proto vždy uvádíme) | `public/models/weapons/` – M4A1, M16A2, M24, M9 |
| CC0 Flat Guns East (Rifle_Assault, Rifle_Battle, Shotgun_Auto, Shotgun_Pump, Sniper_Rifle, Pistol_Compact) | Pichuliru – [OpenGameArt](https://opengameart.org/node/137087), [itch.io](https://pichuliru.itch.io/cc0-flat-guns-east) | CC0 | AK-101, AKM, Saiga-12, Remington 870, SVD, PM |
| Universal Animation Library [Standard] (Mannequin + klipy Idle, Walk, Jog, Sprint, Crouch, Jump, Death01, Hit_Chest) | Quaternius – [quaternius.com](https://quaternius.com) | CC0 1.0 (License.txt v balíčku) | `public/models/soldier/ual_soldier.glb` (zmenšeno skriptem `scripts/prepare-soldier.mjs`) – tělo vzdálených vojáků a paže v první osobě (zápěstí a prsty řídí rig úchopů hry, paže IK) |

Barvy materiálů, optika (kolimátor, puškohled), body úchopu a chování zbraní přidává hra;
výstroj vojáků (helma, vesta, sumky) je vlastní procedurální model nasazený na tělo Mannequinu.
Nepoužito (zatím): Animated FPS Guns (Quaternius, CC0 – nahrazeno Flat Guns), PSX First Person
Arms (drillimpact, itch.io – licence neověřena, do repozitáře nevloženo).

Zvuky a textury třetích stran zatím **nejsou** použity.

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
