import { describe, expect, it } from 'vitest';
import type { Activity, AgentStatus } from '../../../shared/types';
import type { MainInput, Office } from '../../model/office';
import { CerebroSource, fixtureAt, isManager, norm, orderAgents, requesterOf, roomPathOf, type CerebroAgente, type CerebroEstado } from './source';

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
  const summons: Array<{ id: string; by: string; text?: string; live?: boolean }> = [];
  const kinds: Array<{ id: string; kind: string }> = [];
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
    summon(id: string, by: string, text: string | undefined, _ms: number, opts: { live?: boolean } = {}) {
      summons.push({ id, by, text, live: opts.live });
    },
    setRoomKind(id: string, kind: string) {
      kinds.push({ id, kind });
    },
  };
  return { office: office as unknown as Office, mains, status, acts, effects, summons, kinds };
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

  it('pedido a um colega (subfluxo sem fim registrado) termina quando quem pediu termina', () => {
    const f = fakeOffice();
    const src = new CerebroSource({ office: f.office, config: { pollMs: 3000, timeoutMs: 300_000 }, now: () => now });
    src.apply(base, true);
    src.apply(
      {
        ...base,
        execucoes: [
          { id: 's1', agente: 'salsicha', gatilho: 'chat', iniciado_em: iso(now - 5000), status: 'rodando' },
          { id: 'd1', agente: 'dafne', canal: 'api', gatilho: 'pedido do Salsicha', resumo: 'Horas por pessoa', iniciado_em: iso(now - 3000), status: 'rodando' },
        ],
      },
      false,
    );
    expect(f.status.get('n8n:dafne')).toBe('working');
    expect(f.acts.some((x) => x.id === 'n8n:dafne' && x.a.icon === '🤝' && x.a.text.startsWith('Pedido do Salsicha'))).toBe(true);
    src.apply({ ...base, interacoes: [{ id: 30, agente: 'salsicha', ocorrido_em: iso(now), status: 'ok', n8n_execution_id: 's1' }] }, false);
    expect(f.status.get('n8n:salsicha')).toBe('idle');
    expect(f.status.get('n8n:dafne')).toBe('idle');
  });
});

describe('gerência e chamado da gerente', () => {
  const now = Date.parse('2026-11-02T10:00:00-03:00');
  const iso = (ms: number) => new Date(ms).toISOString();
  const MANU = agente('manu', 'Manu', { sala: 'Diretoria', tipo: 'gerencia', ordem: 5, papel: 'Gerente geral', visual: 'f' });
  const COM_MANU = [MANU, ...AGENTES];
  const base: CerebroEstado = { agora: iso(now), agentes: COM_MANU, execucoes: [], interacoes: [] };
  const cfg = { pollMs: 3000, timeoutMs: 300_000 };
  const pedido = (id: string, agente: string, at = now - 1000, gatilho = 'pedido da Manu') => ({ id, agente, canal: 'api', gatilho, resumo: 'Fechamento do dia', iniciado_em: iso(at), status: 'rodando' });

  it('gatilho sem diferenciar maiúsculas nem acentos; quem é a gerente', () => {
    expect(norm('  Pédido  DA   Manú ')).toBe('pedido da manu');
    expect(requesterOf('PEDIDO DA MANÚ')).toBe('manu');
    expect(requesterOf('pedido do Salsicha')).toBe('salsicha');
    expect(requesterOf('chat')).toBeUndefined();
    expect(isManager(MANU)).toBe(true);
    // a Manu chama mesmo antes de a sala dela virar 'gerencia'
    expect(isManager(agente('manu', 'Manu', { sala: 'Diretoria', tipo: 'sala' }))).toBe(true);
    expect(isManager(agente('x', 'Chefe', { sala: 'Sala', tipo: 'Gerência' }))).toBe(true);
    expect(isManager(AGENTES[0])).toBe(false);
  });

  it('gerência logo depois do restaurante, perto da entrada; o co-work vai depois dela', () => {
    const rooms = [...new Set(orderAgents(COM_MANU.slice(0, 8)).map(roomPathOf))];
    expect(rooms.slice(0, 3)).toEqual(['/agentes/Restaurante', '/agentes/Diretoria', '/agentes/Co-work']);
    // restaurante continua primeiro mesmo com `ordem` maior que a da gerência
    const r2 = orderAgents([agente('m', 'M', { sala: 'Diretoria', tipo: 'gerencia', ordem: 0 }), agente('r', 'R', { sala: 'Rest', tipo: 'restaurante', ordem: 9 })]).map(roomPathOf);
    expect(r2).toEqual(['/agentes/Rest', '/agentes/Diretoria']);
  });

  it('pedido da Manu ao vivo: ela "Chamou o Scooby", ele é chamado à sala dela e trabalha até o próprio fim', () => {
    const f = fakeOffice();
    const src = new CerebroSource({ office: f.office, config: cfg, now: () => now });
    src.apply(base, true);
    expect(f.mains.find((m) => m.name === 'Manu')?.roomKind).toBe('gerencia');
    src.apply(
      {
        ...base,
        execucoes: [
          { id: 'm1', agente: 'manu', canal: 'telegram', gatilho: 'chat', resumo: 'Pede o fechamento', iniciado_em: iso(now - 3000), status: 'rodando' },
          pedido('s1', 'scooby'),
          pedido('d1', 'dafne', now - 900, 'Pedido da MANÚ'),
        ],
      },
      false,
    );
    expect(f.summons).toEqual([
      { id: 'n8n:scooby', by: 'n8n:manu', text: 'Fechamento do dia', live: true },
      { id: 'n8n:dafne', by: 'n8n:manu', text: 'Fechamento do dia', live: true },
    ]);
    const manu = f.acts.filter((x) => x.id === 'n8n:manu').map((x) => x.a.text);
    expect(manu).toContain('Chamou o Scooby: Fechamento do dia');
    expect(manu).toContain('Chamou a Dafne: Fechamento do dia');
    expect(f.acts.some((x) => x.id === 'n8n:scooby' && x.a.text === 'Pedido da Manu: Fechamento do dia')).toBe(true);
    expect(f.status.get('n8n:scooby')).toBe('working');
    // a Manu terminou o turno dela: o Scooby continua (o pedido da gerente fecha só pelo próprio fim)
    src.apply({ ...base, interacoes: [{ id: 40, agente: 'manu', ocorrido_em: iso(now), status: 'ok', n8n_execution_id: 'm1' }] }, false);
    expect(f.status.get('n8n:scooby')).toBe('working');
    // a mesma execução relida não chama de novo
    src.apply({ ...base, execucoes: [pedido('s1', 'scooby')] }, false);
    expect(f.summons).toHaveLength(2);
    // fim do Scooby pelo mesmo execution id; canal 'api' de um pedido não é lead no CRM
    src.apply({ ...base, interacoes: [{ id: 41, agente: 'scooby', ocorrido_em: iso(now), status: 'ok', canal: 'api', n8n_execution_id: 's1', duracao_ms: 4000 }] }, false);
    expect(f.status.get('n8n:scooby')).toBe('idle');
    expect(f.effects).toEqual([]);
    expect(f.acts.some((x) => x.id === 'n8n:scooby' && x.a.text === 'Respondeu em 4s')).toBe(true);
  });

  it('pedido que começou e terminou entre duas leituras também chama (e sem festa de lead)', () => {
    const f = fakeOffice();
    const src = new CerebroSource({ office: f.office, config: cfg, now: () => now });
    src.apply(base, true);
    src.apply(
      {
        ...base,
        execucoes: [{ ...pedido('j1', 'jorge'), finalizado_em: iso(now - 200), status: 'ok' }],
        interacoes: [{ id: 50, agente: 'jorge', ocorrido_em: iso(now - 200), status: 'ok', canal: 'api', n8n_execution_id: 'j1' }],
      },
      false,
    );
    expect(f.summons.map((s) => s.id)).toEqual(['n8n:jorge']);
    expect(f.effects).toEqual([]);
  });

  it('carga inicial, pedido antigo, pedido de colega comum e gerente ausente não chamam ninguém', () => {
    const f = fakeOffice();
    const src = new CerebroSource({ office: f.office, config: cfg, now: () => now });
    src.apply({ ...base, execucoes: [pedido('b1', 'fred')] }, true);
    // o boot já viu b1: relido ao vivo, não chama
    src.apply({ ...base, execucoes: [pedido('b1', 'fred')] }, false);
    // antigo (mais de 2 min): não atravessa o prédio
    src.apply({ ...base, execucoes: [pedido('old', 'fred', now - 4 * 60_000)] }, false);
    // "pedido do Salsicha" continua só trabalho na mesa
    src.apply({ ...base, execucoes: [pedido('p1', 'dafne', now - 500, 'pedido do Salsicha')] }, false);
    expect(f.summons).toEqual([]);
    // sem a Manu cadastrada: o agente só trabalha
    const g = fakeOffice();
    const sem = new CerebroSource({ office: g.office, config: cfg, now: () => now });
    sem.apply({ ...base, agentes: AGENTES }, true);
    sem.apply({ ...base, agentes: AGENTES, execucoes: [pedido('x1', 'fred')] }, false);
    expect(g.summons).toEqual([]);
    expect(g.status.get('n8n:fred')).toBe('working');
  });

  it('tipo trocado no banco (sala -> gerencia): mesma sala, planta nova', () => {
    const f = fakeOffice();
    const src = new CerebroSource({ office: f.office, config: cfg, now: () => now });
    const antes = { ...MANU, escritorio: { ...MANU.escritorio, tipo: 'sala' } };
    src.apply({ ...base, agentes: [antes, ...AGENTES] }, true);
    src.apply(base, false);
    expect(f.kinds).toEqual([{ id: 'n8n:manu', kind: 'gerencia' }]);
    expect(f.mains.filter((m) => m.name === 'Manu')).toHaveLength(1);
  });

  it('fixture: só o que já aconteceu (o pedido agendado aparece ao vivo, depois)', () => {
    const st: CerebroEstado = {
      ...base,
      execucoes: [{ ...pedido('f1', 'scooby', now + 20_000), finalizado_em: iso(now + 50_000), status: 'ok' }],
      interacoes: [{ id: 60, agente: 'scooby', ocorrido_em: iso(now + 50_000), status: 'ok', n8n_execution_id: 'f1' }],
    };
    expect(fixtureAt(st, now).execucoes).toEqual([]);
    expect(fixtureAt(st, now).interacoes).toEqual([]);
    const mid = fixtureAt(st, now + 30_000);
    expect(mid.execucoes[0]).toMatchObject({ id: 'f1', status: 'rodando', finalizado_em: null });
    expect(mid.interacoes).toEqual([]);
    const end = fixtureAt(st, now + 60_000);
    expect(end.execucoes[0]).toMatchObject({ status: 'ok' });
    expect(end.interacoes).toHaveLength(1);
  });
});
