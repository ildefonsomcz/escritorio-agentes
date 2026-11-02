// Cena para a Manu: o retrato de onde cada agente está e o que faz (world/scene-report.ts).
import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../../shared/types';
import type { Appearance, ArtModule, RoomTheme } from '../art/api';
import { DEFAULT_WORLD_OPTIONS } from './api';
import { Sim } from './sim/sim';
import { describeScene } from './scene-report';

const theme: RoomTheme = {
  carpet: '#4f6d8f',
  carpet2: '#486685',
  wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' },
  accent: '#3f7fd8',
  deskVariant: 'wood',
  chairVariant: 'black',
};

const appearance: Appearance = {
  skin: '#f0c8a0',
  hair: '#3a2a20',
  hairStyle: 'short',
  eyes: '#222',
  top: '#3f7fd8',
  topAccent: '#fff',
  topStyle: 'tshirt',
  bottom: '#333',
  shoes: '#111',
  accessory: 'none',
  accessoryColor: '#000',
  lanyard: null,
  look: 'm',
};

const art = { appearanceFromSeed: () => appearance, roomTheme: () => theme } as unknown as ArtModule;
const T0 = 1_700_000_000_000;

function room(id: string, slot: number): RoomInfo {
  return { id, name: id.replace('/', ''), path: id, slot, seed: slot * 99 + 7, createdAt: T0 };
}

function agent(id: string, roomId: string, status: AgentInfo['status'], extra: Partial<AgentInfo> = {}): AgentInfo {
  let seed = 0;
  for (const c of id) seed = (Math.imul(seed, 31) + c.charCodeAt(0)) >>> 0;
  return {
    id,
    kind: 'main',
    roomId,
    name: id[0].toUpperCase() + id.slice(1),
    look: 'f',
    role: 'Agente principal',
    sessionId: `s-${id}`,
    account: '.claude',
    status,
    recent: [],
    tasks: [],
    startedAt: T0,
    lastEventAt: T0,
    statusSince: T0,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: seed * 2654435761,
    ...extra,
  };
}

function snap(rooms: RoomInfo[], agents: AgentInfo[], rev = 1): OfficeSnapshot {
  return {
    rev,
    serverTime: T0,
    rooms,
    agents,
    accounts: [{ id: '.claude', short: 'C', name: 'Conta C', color: '#f08a3c', configDir: '~/.claude', sessions: 1, usageStatus: 'ok' }],
    meta: { demo: true, sources: [], startedAt: T0, version: 't' },
  };
}

function run(sim: Sim, clock: { now: number }, seconds: number, until?: () => boolean): void {
  const steps = Math.round(seconds * 30);
  for (let i = 0; i < steps; i++) {
    clock.now += 1000 / 30;
    sim.update(1 / 30, clock.now);
    if (until?.()) return;
  }
}

function newSim(): Sim {
  return new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'lively' }));
}

const ROOMS = [room('/a', 0), room('/b', 1)];

describe('cena para a Manu', () => {
  it('conta quem joga com quem, onde e quem está trabalhando', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(
      snap(ROOMS, [
        agent('n8n:salsicha', '/a', 'idle', { name: 'Salsicha' }),
        agent('n8n:scooby', '/b', 'idle', { name: 'Scooby' }),
        agent('n8n:fred', '/a', 'working', { name: 'Fred' }),
      ]),
      clock.now,
    );
    run(sim, clock, 0.3);
    expect(sim.social.force('videogame', clock.now, ['n8n:salsicha', 'n8n:scooby'])).toHaveLength(2);
    run(sim, clock, 60, () => sim.chars.get('n8n:salsicha')?.gathering?.phase === 'run');
    const cena = describeScene(sim, clock.now);
    const salsicha = cena.find((c) => c.slug === 'salsicha')!;
    expect(salsicha.roda).toBe('videogame');
    expect(salsicha.com).toEqual(['Scooby']);
    expect(salsicha.atividade).toMatch(/videogame com Scooby/);
    expect(salsicha.lugar).toMatch(/Lounge/);
    const fred = cena.find((c) => c.slug === 'fred')!;
    expect(fred.atividade).toBe('Trabalhando');
    expect(fred.roda).toBeNull();
  });
});
