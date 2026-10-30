import { describe, expect, it } from 'vitest';
import type { Activity, AgentStatus } from '../../../shared/types';
import type { MainInput, Office } from '../../model/office';
import { CerebroSource, orderAgents, roomPathOf, type CerebroAgente, type CerebroEstado } from './source';

function agente(slug: string, nome: string, esc: CerebroAgente['escritorio']): CerebroAgente {
  return { slug, nome, status: 'ativo', escritorio: esc };
}

const AGENTES: CerebroAgente[] = [
  agente('fred', 'Fred', { sala: 'Sala do Fred', tipo: 'sala', ordem: 10 }),
  agente('dafne', 'Dafne', { sala: 'Co-work', tipo: 'cowork', ordem: 50, visual: 'f' }),
  agente('salsicha', 'Salsicha', { sala: 'Co-work', tipo: 'cowork', ordem: 50, colabora_com: { dafne: ['paralelo'] } }),
  agente('jorge', 'Jorge Estoquista', { sala: 'Restaurante', tipo: 'restaurante', ordem: 0, posto: 'cozinha' }),
  agente('scooby', 'Scooby', { sala: 'Restaurante', tipo: 'restaurante', ordem: 0, posto: 'balcao' }),
  agente('sdr-a', 'SDR A', { sala: 'Comercial A', ordem: 20 }),
  agente('sdr-b', 'SDR B', { sala: 'Comercial B', ordem: 21 }),
  agente('velho', 'Velho', { sala: 'Sala velha' }),
];
AGENTES[7].status = 'inativo';

/** Office de mentira: só o que a fonte usa. */
function fakeOffice() {
  const mains: MainInput[] = [];
  const status = new Map<string, AgentStatus>();
  const acts: Array<{ id: string; a: Activity }> = [];
  const effects: string[] = [];
  const office = {
    beginBoot() {},
    endBoot() {},
    markDirty() {},
    addMain(p: MainInput) {
      mains.push(p);
      status.set(p.id, p.status);
    },
    closeMain(id: string) {
      status.set(id, 'offline');
    },
    setStatus(id: string, s: AgentStatus) {
      status.set(id, s);
    },
    addActivity(id: string, a: Activity) {
      acts.push({ id, a });
    },
    applyTranscript() {},
    roomEffect(id: string, kind: string) {
      effects.push(`${id}:${kind}`);
    },
    externalNotice() {},
  };
  return { office: office as unknown as Office, mains, status, acts, effects };
}

describe('orderAgents', () => {
  it('restaurante na primeira vaga, co-work no meio do prédio e o balcão antes da cozinha', () => {
    const rooms = [...new Set(orderAgents(AGENTES.slice(0, 7)).map(roomPathOf))];
    expect(rooms[0]).toBe('/agentes/Restaurante');
    // 5 salas + 2 colunas de núcleo = 5 colunas; meio = coluna 2 = primeira coluna de salas -> vaga 1 (sul)
    expect(rooms[1]).toBe('/agentes/Co-work');
    expect(orderAgents(AGENTES.slice(0, 7))[0].slug).toBe('scooby');
  });
});

describe('CerebroSource', () => {
  const now = Date.parse('2026-10-30T10:00:00-03:00');
  const iso = (ms: number) => new Date(ms).toISOString();
  const base: CerebroEstado = { agora: iso(now), agentes: AGENTES, execucoes: [], interacoes: [] };

  it('cria um personagem por agente ativo, com nome, sala e posto', () => {
    const f = fakeOffice();
    const src = new CerebroSource({ office: f.office, config: { pollMs: 3000, timeoutMs: 300_000 }, now: () => now });
    src.apply(base, true);
    expect(f.mains.map((m) => m.name)).not.toContain('Velho');
    const scooby = f.mains.find((m) => m.name === 'Scooby')!;
    expect(scooby).toMatchObject({ cwd: '/agentes/Restaurante', roomKind: 'restaurante', post: 'balcao', status: 'idle' });
    expect(f.mains.find((m) => m.name === 'Dafne')?.look).toBe('f');
  });

  it('início aberto = trabalhando; interação da mesma execução fecha; timeout também', () => {
    let t = now;
    const f = fakeOffice();
    const src = new CerebroSource({ office: f.office, config: { pollMs: 3000, timeoutMs: 300_000 }, now: () => t });
    src.apply(base, true);
    src.apply({ ...base, execucoes: [{ id: 'e1', agente: 'scooby', canal: 'telegram', gatilho: 'chat', resumo: 'Quanto vendi hoje?', iniciado_em: iso(t - 1000), status: 'rodando' }] }, false);
    expect(f.status.get('n8n:scooby')).toBe('working');
    expect(f.acts.some((x) => x.a.text === 'Quanto vendi hoje?')).toBe(true);
    // fim: a interação chega com o mesmo execution id
    src.apply({ ...base, interacoes: [{ id: 1, agente: 'scooby', ocorrido_em: iso(t), status: 'ok', canal: 'telegram', ferramentas: ['Consultar_Vendas'], n8n_execution_id: 'e1', duracao_ms: 9000 }] }, false);
    expect(f.status.get('n8n:scooby')).toBe('idle');
    expect(f.acts.some((x) => x.a.text === 'Usou Consultar Vendas')).toBe(true);
    // execução sem fim registrado: some depois do timeout
    src.apply({ ...base, execucoes: [{ id: 'e2', agente: 'fred', iniciado_em: iso(t), status: 'rodando' }] }, false);
    expect(f.status.get('n8n:fred')).toBe('working');
    t += 301_000;
    src.apply(base, false);
    expect(f.status.get('n8n:fred')).toBe('idle');
  });

  it('erro liga o alarme; lead no CRM faz festa; colega ajuda pelo colabora_com', () => {
    const f = fakeOffice();
    const src = new CerebroSource({ office: f.office, config: { pollMs: 3000, timeoutMs: 300_000 }, now: () => now });
    src.apply(base, true);
    src.apply(
      {
        ...base,
        interacoes: [
          { id: 10, agente: 'fred', ocorrido_em: iso(now), status: 'erro', erro: 'timeout' },
          { id: 11, agente: 'sdr-a', ocorrido_em: iso(now), status: 'ok', canal: 'api' },
          { id: 12, agente: 'salsicha', ocorrido_em: iso(now), status: 'ok', ferramentas: ['Paralelo_Ponto_x_Synnapse'] },
        ],
      },
      false,
    );
    expect(f.effects).toEqual(['n8n:fred:alarm', 'n8n:sdr-a:party']);
    expect(f.status.get('n8n:dafne')).toBe('working');
    expect(f.acts.some((x) => x.id === 'n8n:dafne' && x.a.icon === '🤝')).toBe(true);
  });

  it('a carga inicial não liga efeitos nem deixa ninguém trabalhando por interação antiga', () => {
    const f = fakeOffice();
    const src = new CerebroSource({ office: f.office, config: { pollMs: 3000, timeoutMs: 300_000 }, now: () => now });
    src.apply({ ...base, interacoes: [{ id: 20, agente: 'fred', ocorrido_em: iso(now - 3600_000), status: 'erro' }] }, true);
    expect(f.effects).toEqual([]);
    expect(f.status.get('n8n:fred')).toBe('idle');
  });
});
