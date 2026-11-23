#!/usr/bin/env bash
# Matice serverových měření pro audit (≈ 17 min). Výsledky: docs/perf-audit/data/server.json
set -e
OUT=${OUT:-docs/perf-audit/data/server.json}
run() { npx tsx scripts/perf/server.ts --out "$OUT" "$@" > /dev/null; echo "hotovo: $*"; }
for s in 1 2 3; do run --bots 8 --mode fight --seed $s --label "8 fight #$s"; done
for s in 1 2 3; do run --bots 16 --mode fight --seed $s --label "16 fight #$s"; done
run --bots 16 --mode spread --label "16 spread"
run --bots 32 --mode fight --label "32 fight"
run --bots 32 --mode spread --label "32 spread"
run --bots 64 --mode fight --label "64 fight"
run --bots 64 --mode spread --label "64 spread"
run --bots 64 --mode fight --cull 0 --label "64 fight bez skrývání nepřátel"
