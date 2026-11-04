import type { ControlPoint, EnvironmentProfile, MapDocument, MapObject, Scenario, SpawnPoint, Transform, Zone } from '../../shared/map/schema';
import { readRegion, writeRegion, type Region } from '../../world/terrain';

export type EntityCollection = 'controlPoints' | 'spawnPoints' | 'zones' | 'scenarios';
export type Entity = ControlPoint | SpawnPoint | Zone | Scenario;
type RegionValues = ReturnType<typeof readRegion>;

/**
 * Autorský dokument editoru. Jediné místo, kde se mění mapa – vždy přes
 * změny (Change), které jdou vrátit. Neobsahuje nic z Three.js (testovatelné v Node).
 */
export type Change =
  | { kind: 'object'; id: string; before: MapObject | null; after: MapObject | null; index?: number }
  | { kind: 'testSpawn'; before: Transform | undefined; after: Transform | undefined }
  | { kind: 'environment'; before: EnvironmentProfile; after: EnvironmentProfile }
  | { kind: 'name'; before: string; after: string }
  | { kind: 'terrain'; region: Region; before: RegionValues; after: RegionValues }
  | { kind: 'entity'; collection: EntityCollection; id: string; before: Entity | null; after: Entity | null; index?: number };

export interface Command {
  label: string;
  changes: Change[];
}

export type DocListener = (changes: Change[], direction: 'do' | 'undo') => void;

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

export class EditorDoc {
  private listeners = new Set<DocListener>();

  constructor(public doc: MapDocument) {}

  onChange(fn: DocListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getObject(id: string): MapObject | undefined {
    return this.doc.objects.find((o) => o.id === id);
  }

  indexOf(id: string) {
    return this.doc.objects.findIndex((o) => o.id === id);
  }

  /** Aplikuje změny ve směru `do` (after) nebo `undo` (before, v opačném pořadí). */
  apply(changes: Change[], direction: 'do' | 'undo') {
    const list = direction === 'do' ? changes : [...changes].reverse();
    for (const c of list) {
      const target = direction === 'do' ? c.after : c.before;
      switch (c.kind) {
        case 'object': {
          const i = this.indexOf(c.id);
          const v = target as MapObject | null;
          if (v === null) {
            if (i >= 0) {
              // Index v okamžiku odebrání → undo (v opačném pořadí) vrátí přesné pořadí.
              if (direction === 'do') c.index = i;
              this.doc.objects.splice(i, 1);
            }
          } else if (i >= 0) {
            this.doc.objects[i] = clone(v);
          } else {
            const at = c.index !== undefined ? Math.min(c.index, this.doc.objects.length) : this.doc.objects.length;
            this.doc.objects.splice(at, 0, clone(v));
          }
          break;
        }
        case 'testSpawn':
          this.doc.testSpawn = clone(target as Transform | undefined);
          break;
        case 'environment':
          this.doc.environment = clone(target as EnvironmentProfile);
          break;
        case 'name':
          this.doc.name = target as string;
          break;
        case 'terrain':
          writeRegion(this.doc.terrain, c.region, target as RegionValues);
          break;
        case 'entity': {
          const arr = this.doc[c.collection] as Entity[];
          const i = arr.findIndex((e) => e.id === c.id);
          const v = target as Entity | null;
          if (v === null) {
            if (i >= 0) {
              if (direction === 'do') c.index = i;
              arr.splice(i, 1);
            }
          } else if (i >= 0) arr[i] = clone(v);
          else arr.splice(c.index !== undefined ? Math.min(c.index, arr.length) : arr.length, 0, clone(v));
          break;
        }
      }
    }
    for (const l of this.listeners) l(list, direction);
  }

  getEntity(collection: EntityCollection, id: string): Entity | undefined {
    return (this.doc[collection] as Entity[]).find((e) => e.id === id);
  }

  /** Vytvoří nové unikátní ID objektu. */
  newId(prefix = 'obj'): string {
    const used = new Set([...this.doc.objects, ...this.doc.controlPoints, ...this.doc.spawnPoints, ...this.doc.zones, ...this.doc.scenarios].map((o) => o.id));
    for (;;) {
      const id = `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
      if (!used.has(id)) return id;
    }
  }
}

/** Historie úprav. Jedno dokončené tažení / jedna operace = jedna položka. */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  onChange: () => void = () => {};

  constructor(
    private ed: EditorDoc,
    private limit = 300,
  ) {}

  execute(cmd: Command) {
    if (cmd.changes.length === 0) return;
    this.ed.apply(cmd.changes, 'do');
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChange();
  }

  undo(): Command | null {
    const c = this.undoStack.pop();
    if (!c) return null;
    this.ed.apply(c.changes, 'undo');
    this.redoStack.push(c);
    this.onChange();
    return c;
  }

  redo(): Command | null {
    const c = this.redoStack.pop();
    if (!c) return null;
    this.ed.apply(c.changes, 'do');
    this.undoStack.push(c);
    this.onChange();
    return c;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get undoLabel() {
    return this.undoStack.at(-1)?.label;
  }
  get redoLabel() {
    return this.redoStack.at(-1)?.label;
  }
}

/** Pomocné konstruktory příkazů. */
export const cmds = {
  entity<T extends Entity>(ed: EditorDoc, collection: EntityCollection, id: string, mutate: ((e: T) => void) | null, label: string): Command {
    const before = ed.getEntity(collection, id) as T | undefined;
    if (!before) return { label, changes: [] };
    if (!mutate) return { label, changes: [{ kind: 'entity', collection, id, before: clone(before), after: null }] };
    const after = clone(before);
    mutate(after);
    if (JSON.stringify(after) === JSON.stringify(before)) return { label, changes: [] };
    return { label, changes: [{ kind: 'entity', collection, id, before: clone(before), after }] };
  },
  addEntity(collection: EntityCollection, e: Entity, label: string): Command {
    return { label, changes: [{ kind: 'entity', collection, id: e.id, before: null, after: clone(e) }] };
  },
  insert(_ed: EditorDoc, objs: MapObject[], label = 'Vložit'): Command {
    return { label, changes: objs.map((o) => ({ kind: 'object', id: o.id, before: null, after: clone(o) })) };
  },
  remove(ed: EditorDoc, ids: string[], label = 'Smazat'): Command {
    return {
      label,
      changes: ids
        .map((id) => ed.getObject(id))
        .filter((o): o is MapObject => !!o)
        .map((o) => ({ kind: 'object', id: o.id, before: clone(o), after: null })),
    };
  },
  update(ed: EditorDoc, id: string, mutate: (o: MapObject) => void, label = 'Upravit'): Command {
    const before = ed.getObject(id);
    if (!before) return { label, changes: [] };
    const after = clone(before);
    mutate(after);
    if (JSON.stringify(after) === JSON.stringify(before)) return { label, changes: [] };
    return { label, changes: [{ kind: 'object', id, before: clone(before), after }] };
  },
  updateMany(ed: EditorDoc, ids: string[], mutate: (o: MapObject) => void, label = 'Upravit'): Command {
    const changes: Change[] = [];
    for (const id of ids) {
      const c = cmds.update(ed, id, mutate, label);
      changes.push(...c.changes);
    }
    return { label, changes };
  },
  /** Duplikace: nová ID, stejné parametry i seed, mírný posun. */
  duplicate(ed: EditorDoc, ids: string[], offset: [number, number, number]): { cmd: Command; newIds: string[] } {
    const newIds: string[] = [];
    const objs: MapObject[] = [];
    const groupMap = new Map<string, string>();
    for (const id of ids) {
      const o = ed.getObject(id);
      if (!o) continue;
      const c = clone(o);
      c.id = ed.newId();
      while (newIds.includes(c.id)) c.id = ed.newId();
      c.transform.position = [o.transform.position[0] + offset[0], o.transform.position[1] + offset[1], o.transform.position[2] + offset[2]];
      // Vnitřní vazba skupiny se přenese na novou skupinu (kopie nepatří do původní).
      if (c.editor?.group) {
        if (!groupMap.has(c.editor.group)) groupMap.set(c.editor.group, `grp_${Math.random().toString(36).slice(2, 7)}`);
        c.editor.group = groupMap.get(c.editor.group);
      }
      if (c.editor) c.editor.locked = false;
      newIds.push(c.id);
      objs.push(c);
    }
    return { cmd: cmds.insert(ed, objs, 'Duplikovat'), newIds };
  },
};
