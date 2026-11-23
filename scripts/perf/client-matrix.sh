#!/usr/bin/env bash
# Matice klientských měření pro audit (SwiftShader!). Předpoklad: vite build + vite preview na :4173.
# Výsledky: docs/perf-audit/data/client-*.json
set -e
D=docs/perf-audit/data
c() { npx tsx scripts/perf/client.ts "$@"; }
# A) Herní logika a UI bez vykreslování (renderer.render se nevolá) – snímky běží 60 Hz, CPU časy úseků.
for rep in 1 2 3; do c --scenario idle,fight16 --extra "&ab=norender" --out $D/client-logic.json; done
c --scenario fight8,spread16,fight32,spread32 --extra "&ab=norender" --out $D/client-logic.json
c --scenario fight16 --extra "&ab=norender,noanim" --out $D/client-logic-ab.json
c --scenario fight16 --extra "&ab=norender,nohud" --out $D/client-logic-ab.json
c --scenario fight16 --extra "&ab=norender,noeffects" --out $D/client-logic-ab.json
# B) S vykreslováním v malém rozlišení (320×180): draw calls, trojúhelníky, průchody, CPU odeslání renderu.
c --scenario idle,route,fight16,first --w 640 --h 360 --extra "&ab=half" --out $D/client-render.json
c --scenario lifecycle --w 640 --h 360 --extra "&ab=half" --out $D/client-render.json
# C) Poměry práce GPU v SwiftShaderu (časovač GPU, jen relativně): stanoviště trasy, jedna změna na běh.
for v in "" ",noshadow" ",nograss"; do c --scenario route --w 640 --h 360 --extra "&ab=half$v" --out $D/client-gpu-ab.json; done
for q in low high; do c --scenario route --q $q --w 640 --h 360 --extra "&ab=half" --out $D/client-gpu-ab.json; done
echo hotovo
