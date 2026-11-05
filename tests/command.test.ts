import { describe, expect, it } from 'vitest';
import { TeamLayer } from '../src/shared/net/team';
import { NET } from '../src/shared/net/protocol';

describe('commander (serverová oprávnění)', () => {
  it('jeden commander na tým; běžný hráč nezíská práva; odchod uvolní místo', () => {
    const t = new TeamLayer();
    t.addMember('a', 'A', 'teamA');
    t.addMember('b', 'B', 'teamA');
    t.addMember('x', 'X', 'teamB');
    expect(t.applyCommander('a')).toBeNull();
    expect(t.applyCommander('b')).toMatch(/obsazené/);
    expect(t.applyCommander('x')).toBeNull(); // druhý tým má vlastní místo
    expect(t.useAbility('b', 'scan', 0)).toMatch(/jen commander/);
    t.removeMember('a');
    expect(t.command.teamA.commander).toBeNull();
    expect(t.applyCommander('b')).toBeNull();
  });

  it('rozkaz: commander libovolné četě svého týmu, cizí četě ne; běžný hráč cizí četě ne', () => {
    const t = new TeamLayer();
    for (const [id, team] of [['c', 'teamA'], ['l', 'teamA'], ['m', 'teamA'], ['e', 'teamB']] as const) t.addMember(id, id, team);
    t.createSquad('l', true);
    t.createSquad('e', true);
    const sqA = [...t.squads.values()].find((s) => s.team === 'teamA')!.id;
    const sqB = [...t.squads.values()].find((s) => s.team === 'teamB')!.id;
    t.applyCommander('c');
    expect(t.issueOrder('c', 'attack', { pos: [0, 0, 0] }, 1, sqA)).toBeNull();
    expect(t.orderFor(sqA)?.author).toBe('c');
    expect(t.issueOrder('c', 'attack', { pos: [0, 0, 0] }, 1, sqB)).toMatch(/neznámá četa/);
    expect(t.issueOrder('m', 'move', { pos: [0, 0, 0] }, 1, sqA)).toMatch(/jen commander/);
  });

  it('UAV a scan: cooldowny vynucuje server', () => {
    const t = new TeamLayer();
    t.addMember('c', 'C', 'teamA');
    t.applyCommander('c');
    expect(t.useAbility('c', 'uav', 10)).toMatch(/chybí cíl/);
    expect(t.useAbility('c', 'uav', 10, [0, 0, 0])).toBeNull();
    expect(t.command.teamA.uav?.until).toBe(10 + NET.command.uavDuration);
    expect(t.useAbility('c', 'uav', 20, [0, 0, 0])).toMatch(/obnova/);
    expect(t.useAbility('c', 'scan', 20)).toBeNull();
    expect(t.useAbility('c', 'scan', 30)).toMatch(/obnova/);
    expect(t.useAbility('c', 'scan', 20 + NET.command.scanCooldown)).toBeNull();
  });
});
