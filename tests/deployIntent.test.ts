import { describe, expect, it } from 'vitest';
import { DeployIntent, type DeployTarget, type IntentInput } from '../src/client/ui/deployIntent';

const flag: DeployTarget = { id: 'cp:a', kind: 'cp', name: 'Tržiště', x: 0, z: 0, rel: 'own', available: true, spawnId: 'sa' };
const leader: DeployTarget = { id: 'squad:L', kind: 'leader', name: 'Velitel', x: 0, z: 0, rel: 'own', available: true, spawnId: 'squad:L' };
const base = (over: Partial<IntentInput> = {}): IntentInput => ({ now: 0, life: 'dead', lifeId: 1, waitLeft: 0, target: flag, kitOk: true, roundKey: 'r1', ended: false, ...over });

function make() {
  const it = new DeployIntent();
  const sends: string[] = [];
  it.onSend = (t) => {
    sends.push(t.id);
    return null;
  };
  it.update(base());
  return { it, sends };
}

describe('nasazení – záměr a potvrzené čekání', () => {
  it('bez potvrzení se nikdy neodešle (ani po smrti, ani po vypršení času)', () => {
    const { it, sends } = make();
    for (let i = 0; i < 10; i++) it.update(base({ now: i }));
    expect(sends).toEqual([]);
  });

  it('potvrzení během odpočtu → jediný požadavek po jeho vypršení', () => {
    const { it, sends } = make();
    it.confirm(base({ waitLeft: 5 }));
    expect(it.phase).toBe('armed');
    for (let i = 0; i < 5; i++) it.update(base({ waitLeft: 5 - i, now: i }));
    expect(sends).toEqual([]);
    it.update(base({ waitLeft: 0, now: 6 }));
    it.update(base({ waitLeft: 0, now: 6.1 }));
    it.confirm(base({ waitLeft: 0, now: 6.2 })); // opakovaný klik během odesílání nic nepošle
    expect(sends).toEqual(['cp:a']);
    expect(it.phase).toBe('sending');
    // Server vytvořil postavu → stav končí.
    it.update(base({ life: 'alive', lifeId: 2, now: 6.3 }));
    expect(it.phase).toBe('idle');
  });

  it('zrušení čekání zabrání budoucímu odeslání', () => {
    const { it, sends } = make();
    it.confirm(base({ waitLeft: 3 }));
    it.cancel();
    it.update(base({ waitLeft: 0, now: 4 }));
    expect(sends).toEqual([]);
  });

  it('ztráta bodu během čekání zruší záměr s důvodem; znovuzískání ho neobnoví', () => {
    const { it, sends } = make();
    it.confirm(base({ waitLeft: 3 }));
    it.update(base({ waitLeft: 2, target: { ...flag, available: false, reason: 'deploy.reasonEnemy' } }));
    expect(it.phase).toBe('idle');
    expect(it.note?.key).toBe('deploy.targetLost');
    it.update(base({ waitLeft: 0 }));
    expect(sends).toEqual([]);
  });

  it('leader zemře / změní se → cíl zmizí, záměr zrušen s vysvětlením (žádné přesměrování)', () => {
    const { it, sends } = make();
    it.confirm(base({ waitLeft: 2, target: leader }));
    it.update(base({ waitLeft: 1, target: null }));
    expect(it.note?.key).toBe('deploy.leaderLost');
    it.update(base({ waitLeft: 0, target: flag }));
    expect(sends).toEqual([]);
  });

  it('změna classy nebo cíle během čekání zruší čekání a vyžádá nové potvrzení', () => {
    const { it, sends } = make();
    it.confirm(base({ waitLeft: 2 }));
    it.selectionChanged();
    expect(it.phase).toBe('idle');
    expect(it.note?.key).toBe('deploy.changedCancel');
    it.update(base({ waitLeft: 0 }));
    expect(sends).toEqual([]);
  });

  it('oživení / vyřazení: zaživa ani vyřazený nelze potvrdit; oživení zruší záměr', () => {
    const { it, sends } = make();
    it.confirm(base({ life: 'downed', waitLeft: 0 }));
    expect(it.phase).toBe('idle');
    it.confirm(base({ waitLeft: 2 }));
    it.update(base({ life: 'alive', lifeId: 1 }));
    expect(it.phase).toBe('idle');
    it.update(base({ waitLeft: 0 }));
    expect(sends).toEqual([]);
  });

  it('nové kolo zruší čekání; opožděné odmítnutí předchozího požadavku nic nezmění', () => {
    const { it, sends } = make();
    it.confirm(base({ waitLeft: 2 }));
    it.update(base({ waitLeft: 1, roundKey: 'r2' }));
    expect(it.phase).toBe('idle');
    expect(it.note?.key).toBe('deploy.roundCancel');
    it.reject('opožděné');
    expect(it.note?.key).toBe('deploy.roundCancel');
    expect(sends).toEqual([]);
  });

  it('odmítnutí serverem během odesílání vrátí výběr k úpravě s důvodem', () => {
    const { it } = make();
    it.confirm(base());
    expect(it.phase).toBe('sending');
    it.reject('všechna místa obsazená');
    expect(it.phase).toBe('idle');
    expect(it.note?.vars?.reason).toBe('všechna místa obsazená');
  });
});
