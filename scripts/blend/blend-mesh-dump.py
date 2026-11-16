# Čtení meshů z .blend (Blender 4.x) bez Blenderu – pro scripts/prepare-grass.mjs.
# Potřebuje: pip install zstandard blender-asset-tracer; soubor .blend nejdřív rozbalit ze zstd.
# Použití: python blend-mesh-dump.py <rozbalený.blend> <Mesh1,Mesh2,...> <výstup.json>
# Vytáhne z .blend (Blender 4.x, rozbalený) pozice, rohy polygonů a UV vybraných meshů do JSON.
import sys, pathlib, json, struct
from blender_asset_tracer import blendfile
bf = blendfile.open_cached(pathlib.Path(sys.argv[1]))
want = sys.argv[2].split(',')
out = {}
def layers(me, cd):
    n = me[cd, b'totlayer']
    lp = me.get_pointer((cd, b'layers'))
    res = []
    for i in range(n):
        nm = lp.get(b'name', as_str=True, array_index=i)
        tp = lp.get(b'type', array_index=i)
        addr = lp.get(b'data', array_index=i)
        blk = bf.dereference_pointer(addr) if addr else None
        res.append((nm, tp, blk))
    return res
for me in bf.find_blocks_from_code(b'ME'):
    name = me[b'id', b'name'].decode()[2:]
    if name not in want: continue
    nv, npoly, nl = me[b'totvert'], me[b'totpoly'], me[b'totloop']
    rec = {'layers': {}}
    for cd in (b'vdata', b'ldata', b'pdata'):
        for nm, tp, blk in layers(me, cd):
            rec['layers'][cd.decode() + ':' + nm] = tp
            if blk is None: continue
            raw = blk.raw_data()
            if cd == b'vdata' and nm == 'position': rec['pos'] = list(struct.unpack('<%df' % (nv * 3), raw[: nv * 12]))
            if cd == b'ldata' and nm == '.corner_vert': rec['cv'] = list(struct.unpack('<%di' % nl, raw[: nl * 4]))
            if cd == b'ldata' and tp == 49 and 'uv' not in rec: rec['uv'] = list(struct.unpack('<%df' % (nl * 2), raw[: nl * 8])); rec['uvname'] = nm
    po = me.get_pointer(b'poly_offset_indices')
    if po is not None: rec['po'] = list(struct.unpack('<%di' % (npoly + 1), po.raw_data()[: (npoly + 1) * 4]))
    out[name] = rec
json.dump(out, open(sys.argv[3], 'w'))
for k, v in out.items(): print(k, v['layers'], len(v.get('pos', [])) // 3, len(v.get('cv', [])), len(v.get('uv', [])) // 2, len(v.get('po', [])))
