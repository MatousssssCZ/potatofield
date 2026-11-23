"""Souhrn klientských měření (docs/perf-audit/data/client-*.json) do tabulek pro zprávu."""
import json, sys, glob
for path in sys.argv[1:] or sorted(glob.glob('docs/perf-audit/data/client-*.json')):
    print('==', path)
    for r in json.load(open(path)):
        fr = r.get('frame')
        if not fr:
            continue
        a, b = fr['heapStart'], fr['heapEnd']
        sec = {k: v['mean'] for k, v in fr['sections'].items() if v['mean'] >= 0.03}
        dom = f"style {round(b['styleMs']-a['styleMs'])} ms/{round(b['recalcStyleCount']-a['recalcStyleCount']) if 'recalcStyleCount' in a and a['recalcStyleCount'] is not None else '?'}x layout {round(b['layoutMs']-a['layoutMs'])} ms" if b.get('styleMs') else ''
        print(r['scenario'], r['view'].get('extra'), 'frames', fr['frames'], 'cpu', fr['cpu']['mean'], fr['cpu']['p95'], fr['cpu']['p99'], 'gpu', (fr['gpu'] or {}).get('p50'), 'draw', fr['calls']['p50'], fr['calls']['max'], 'tri', fr['triangles']['p50'], 'vis', fr['counts'].get('soldiersVisible'), '/', fr['counts'].get('soldiers'), 'obj', fr['counts']['sceneObjects'], dom)
        print('   ', sec)
