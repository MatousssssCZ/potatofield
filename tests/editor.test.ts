import { describe, expect, it } from 'vitest';
import { EditorDoc, History, cmds } from '../src/client/editor/editorDoc';
import { buildEmptyMap } from '../src/world/maps/empty';
import { buildRangeMap } from '../src/world/maps/range';
import { parseMapJson } from '../src/shared/map/validate';
import type { MapObject } from '../src/shared/map/schema';

const box = (id: string): MapObject => ({
  id,
  assetId: 'prim.box',
  generatorVersion: 1,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
  params: { width: 2, height: 2, depth: 2 },
  seed: 42,
  material: 'concrete',
});

describe('historie editoru', () => {
  it('vložení → posun → parametr → duplikace → smazání: undo vše vrátí, redo zopakuje do shodného stavu', () => {
    const ed = new EditorDoc(buildRangeMap());
    const h = new History(ed);
    const initial = JSON.stringify(ed.doc);

    h.execute(cmds.insert(ed, [box('t1')]));
    h.execute(cmds.update(ed, 't1', (o) => (o.transform.position = [3, 0, -2]), 'Posun'));
    h.execute(cmds.update(ed, 't1', (o) => (o.params.width = 5), 'Parametr'));
    const { cmd, newIds } = cmds.duplicate(ed, ['t1'], [1, 0, 0]);
    h.execute(cmd);
    h.execute(cmds.remove(ed, ['obj_010', 't1']));
    const final = JSON.stringify(ed.doc);

    const dup = ed.getObject(newIds[0])!;
    expect(dup.params.width).toBe(5);
    expect(dup.seed).toBe(42);
    expect(dup.id).not.toBe('t1');

    for (let i = 0; i < 5; i++) expect(h.undo()).not.toBeNull();
    expect(h.undo()).toBeNull();
    expect(JSON.stringify(ed.doc)).toBe(initial);
    for (let i = 0; i < 5; i++) h.redo();
    expect(JSON.stringify(ed.doc)).toBe(final);
  });

  it('smazání uprostřed seznamu a undo vrátí objekt na původní index', () => {
    const ed = new EditorDoc(buildRangeMap());
    const h = new History(ed);
    const ids = ed.doc.objects.map((o) => o.id);
    h.execute(cmds.remove(ed, [ids[3], ids[7]]));
    h.undo();
    expect(ed.doc.objects.map((o) => o.id)).toEqual(ids);
  });

  it('nová akce po undo zahodí redo', () => {
    const ed = new EditorDoc(buildEmptyMap());
    const h = new History(ed);
    h.execute(cmds.insert(ed, [box('a')]));
    h.undo();
    h.execute(cmds.insert(ed, [box('b')]));
    expect(h.canRedo).toBe(false);
  });

  it('beze změny nevzniká položka historie', () => {
    const ed = new EditorDoc(buildEmptyMap());
    const h = new History(ed);
    h.execute(cmds.insert(ed, [box('a')]));
    h.execute(cmds.update(ed, 'a', () => {}));
    h.undo();
    expect(h.canUndo).toBe(false);
  });

  it('duplikace skupiny vytvoří novou skupinu (vazby se nemíchají s originálem)', () => {
    const ed = new EditorDoc(buildEmptyMap());
    const h = new History(ed);
    const a = { ...box('a'), editor: { group: 'g1' } };
    const b = { ...box('b'), editor: { group: 'g1' } };
    h.execute(cmds.insert(ed, [a, b]));
    const { cmd, newIds } = cmds.duplicate(ed, ['a', 'b'], [0, 0, 2]);
    h.execute(cmd);
    const g = newIds.map((id) => ed.getObject(id)!.editor!.group);
    expect(g[0]).toBe(g[1]);
    expect(g[0]).not.toBe('g1');
  });

  it('export/import zachová ID, parametry, prostředí i testovací spawn', () => {
    const ed = new EditorDoc(buildEmptyMap());
    const h = new History(ed);
    h.execute(cmds.insert(ed, [box('a')]));
    h.execute({ label: 'Prostředí', changes: [{ kind: 'environment', before: ed.doc.environment, after: { ...ed.doc.environment, sunAzimuthDeg: 100 } }] });
    const text = JSON.stringify(ed.doc);
    const r = parseMapJson(text);
    expect(r.ok).toBe(true);
    expect(r.doc!.objects[0].id).toBe('a');
    expect(r.doc!.environment.sunAzimuthDeg).toBe(100);
    expect(r.doc!.testSpawn).toEqual(ed.doc.testSpawn);
  });
});
