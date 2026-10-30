// Fonte de agentes do n8n: lê o banco do Cérebro (Supabase) e alimenta o escritório.
//
// Cada agente cadastrado em cerebro.agentes vira um personagem fixo, com nome e sala vindos de
// config.escritorio (sala, tipo, ordem, papel, posto, visual, colabora_com). Quem está trabalhando sai de
// cerebro.execucoes_ao_vivo (o início, gravado pelo subfluxo "CEREBRO - Registrar Inicio" no começo de cada
// execução); o que ele fez sai de cerebro.interacoes (o log normal, gravado no fim). Tudo vem de UMA chamada,
// a RPC public.cerebro_escritorio_estado, repetida a cada CEREBRO_POLL_MS.
//
// Sem dependências: fetch do Node. A chave (service_role/secret) fica só aqui no servidor.
import { readFile } from 'node:fs/promises';
import type { Activity, ActivityKind, AgentStats, SourceInfo } from '../../../shared/types';
import type { CerebroConfig } from '../../config';
import { errMsg, log } from '../../log';
import type { Office } from '../../model/office';
import type { AgentSource } from '../source';

export interface CerebroEscritorio {
  sala?: string;
  tipo?: string;
  ordem?: number;
  papel?: string;
  posto?: string;
  visual?: 'f' | 'm';
  /** slug do colega -> palavras que, no nome de uma ferramenta usada, indicam que ele ajudou. */
  colabora_com?: Record<string, string[]>;
}

export interface CerebroAgente {
  slug: string;
  nome: string;
  dominio?: string | null;
  status?: string | null;
  criticidade?: number | null;
  cor?: string | null;
  escritorio?: CerebroEscritorio | null;
}

export interface CerebroExecucao {
  id: string;
  agente: string;
  canal?: string | null;
  gatilho?: string | null;
  resumo?: string | null;
  iniciado_em: string;
  finalizado_em?: string | null;
  status: string;
}

export interface CerebroInteracao {
  id: number;
  agente: string;
  ocorrido_em: string;
  canal?: string | null;
  status?: string | null;
  intencao?: string | null;
  ferramentas?: string[] | null;
  modelo?: string | null;
  tokens_entrada?: number | null;
  tokens_saida?: number | null;
  custo_usd?: number | null;
  custo_brl?: number | null;
  duracao_ms?: number | null;
  entrada?: string | null;
  erro?: string | null;
  n8n_execution_id?: string | null;
  evento?: string | null;
}

export interface CerebroEstado {
  agora: string;
  agentes: CerebroAgente[];
  execucoes: CerebroExecucao[];
  interacoes: CerebroInteracao[];
}

/** Status de cerebro.agentes que tiram o agente do escritório. */
const FORA = new Set(['inativo', 'desativado', 'arquivado', 'removido']);
/** Agente que fez algo sem início registrado (rotina antiga, fluxo sem o nó de início): trabalha por este tempo. */
const FLASH_MS = 6_000;
/** Colega que ajudou (colabora_com): trabalha junto por este tempo. */
const HELP_MS = 10_000;
const ALARM_MS = 10 * 60_000;
const PARTY_MS = 12_000;
/** Janela da primeira leitura (histórico do dia) e sobreposição das leituras seguintes. */
const BOOT_WINDOW_MS = 24 * 3600_000;
const OVERLAP_MS = 15 * 60_000;
/** Ids já vistos guardados por, no máximo, isto (evita crescer sem fim). */
const SEEN_MAX = 5_000;
const MAX_TEXT = 46;
/** Colunas do núcleo do prédio no cliente (client/src/world/constants.ts, CORE_COLS). */
const CORE_COLS = 2;

const CANAL_ICON: Record<string, string> = { telegram: '💬', whatsapp: '💬', web: '🌐', api: '🔗', cron: '⏰', email: '📧', outro: '⚙️' };

interface AgentState {
  row: CerebroAgente;
  id: string;
  open: Map<string, number>;
  /** Gatilho de cada execução aberta (ex.: "pedido do Salsicha"): fecha quando o colega termina. */
  openGatilho: Map<string, string>;
  flashUntil: number;
  stats: AgentStats;
  statsDay: string;
}

/** Corta um texto para o balão (com reticências). */
export function fit(text: string, max = MAX_TEXT): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Nome de ferramenta legível: "FinERP_CRM_consultar_crm" -> "FinERP CRM consultar crm". */
export function toolLabel(name: string): string {
  return name.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function formatSecs(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}min${s % 60 ? ` ${s % 60}s` : ''}`;
}

/** Dia local (AAAA-MM-DD) de um instante, para zerar os números à meia-noite. */
function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function zero(): AgentStats {
  return { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0, costUSD: 0 };
}

/** Caminho (= id da sala no escritório) de um agente. */
export function roomPathOf(a: CerebroAgente): string {
  const sala = a.escritorio?.sala?.trim() || `Sala ${a.nome}`;
  return `/agentes/${sala.replace(/\//g, '-')}`;
}

/**
 * Ordem de criação das salas (o servidor dá o slot pela ordem de chegada; no cliente, coluna = slot/2, par ao norte).
 * Restaurante primeiro (junto da entrada), depois as outras por `ordem`, e o co-work no meio do prédio.
 */
export function orderAgents(agentes: readonly CerebroAgente[]): CerebroAgente[] {
  const rooms = new Map<string, { path: string; tipo: string; ordem: number; agents: CerebroAgente[] }>();
  for (const a of agentes) {
    const path = roomPathOf(a);
    const r = rooms.get(path) ?? { path, tipo: a.escritorio?.tipo ?? 'sala', ordem: Number.POSITIVE_INFINITY, agents: [] };
    r.ordem = Math.min(r.ordem, a.escritorio?.ordem ?? 100);
    if (a.escritorio?.tipo) r.tipo = a.escritorio.tipo;
    r.agents.push(a);
    rooms.set(path, r);
  }
  const all = [...rooms.values()].sort((x, y) => x.ordem - y.ordem || x.path.localeCompare(y.path));
  const cowork = all.filter((r) => r.tipo === 'cowork');
  const rest = all.filter((r) => r.tipo !== 'cowork');
  if (cowork.length) {
    // coluna do meio do prédio inteiro (as 2 primeiras colunas são o núcleo: recepção, banheiros, copa e lounge)
    const total = CORE_COLS + Math.ceil(all.length / 2);
    const col = Math.max(0, Math.floor((total - 1) / 2) - CORE_COLS);
    let at = col * 2;
    // o restaurante fica sempre na primeira vaga: o co-work vai para o outro lado do corredor
    if (at === 0 && rest[0]?.tipo === 'restaurante') at = 1;
    rest.splice(Math.min(at, rest.length), 0, ...cowork);
  }
  return rest.flatMap((r) => r.agents.sort((x, y) => (x.escritorio?.posto === 'balcao' ? -1 : 0) - (y.escritorio?.posto === 'balcao' ? -1 : 0) || x.nome.localeCompare(y.nome)));
}

export interface CerebroSourceDeps {
  office: Office;
  config: CerebroConfig;
  /** Relógio (testes). */
  now?: () => number;
  /** Leitura do estado (testes); padrão = RPC no Supabase ou arquivo CEREBRO_FIXTURE. */
  fetchState?: (since: Date) => Promise<CerebroEstado>;
}

export class CerebroSource implements AgentSource {
  readonly provider = 'claude' as const;
  private readonly office: Office;
  private readonly cfg: CerebroConfig;
  private readonly now: () => number;
  private readonly fetchState: (since: Date) => Promise<CerebroEstado>;
  private agents = new Map<string, AgentState>();
  private seenExec = new Map<string, string>();
  private seenInter = new Set<number>();
  private lastAgora = 0;
  private timer: NodeJS.Timeout | undefined;
  private tick: NodeJS.Timeout | undefined;
  private stopped = false;
  private ok = false;
  private error: string | undefined;
  private busy = false;

  constructor(deps: CerebroSourceDeps) {
    this.office = deps.office;
    this.cfg = deps.config;
    this.now = deps.now ?? Date.now;
    this.fetchState = deps.fetchState ?? ((since) => this.defaultFetch(since));
  }

  sources(): SourceInfo[] {
    const open = [...this.agents.values()].filter((a) => a.open.size > 0).length;
    const info: SourceInfo = { label: 'n8n', path: this.cfg.fixture ?? this.cfg.url ?? '(sem banco)', sessions: open, ok: this.ok };
    if (this.error) info.error = this.error;
    return [info];
  }

  transcriptPathOf(): string | undefined {
    return undefined;
  }

  async start(): Promise<void> {
    if (!this.cfg.fixture && (!this.cfg.url || !this.cfg.key)) {
      this.error = 'Defina CEREBRO_SUPABASE_URL e CEREBRO_SUPABASE_KEY (ou CEREBRO_FIXTURE).';
      log.error(`Cérebro: ${this.error}`);
    }
    this.office.beginBoot();
    try {
      await this.poll(true);
    } finally {
      this.office.endBoot();
    }
    this.schedule();
    // timeouts e o fim dos "flashes" não dependem de dado novo
    this.tick = setInterval(() => this.refreshAll(), 1000);
    this.tick.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.tick) clearInterval(this.tick);
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.poll(false).finally(() => this.schedule());
    }, this.cfg.pollMs);
    this.timer.unref?.();
  }

  private async defaultFetch(since: Date): Promise<CerebroEstado> {
    if (this.cfg.fixture) return JSON.parse(await readFile(this.cfg.fixture, 'utf8')) as CerebroEstado;
    if (!this.cfg.url || !this.cfg.key) throw new Error('sem banco configurado');
    const key = this.cfg.key;
    const headers: Record<string, string> = { 'content-type': 'application/json', apikey: key, accept: 'application/json' };
    // chaves antigas (JWT) também vão no Authorization; as novas (sb_secret_...) só no apikey
    if (!key.startsWith('sb_')) headers.authorization = `Bearer ${key}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(`${this.cfg.url}/rest/v1/rpc/cerebro_escritorio_estado`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_desde: since.toISOString(), p_limite: 500 }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as CerebroEstado;
    } finally {
      clearTimeout(t);
    }
  }

  /** Uma leitura do banco. `boot` = primeira (histórico, sem avisos nem efeitos). */
  async poll(boot: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const since = new Date(boot || !this.lastAgora ? this.now() - BOOT_WINDOW_MS : this.lastAgora - OVERLAP_MS);
      const st = await this.fetchState(since);
      this.apply(st, boot);
      if (!this.ok || this.error) log.info('Cérebro: conectado.');
      this.ok = true;
      this.error = undefined;
    } catch (err) {
      const msg = errMsg(err);
      if (msg !== this.error) log.warn(`Cérebro: falha na leitura (${msg}).`);
      this.ok = false;
      this.error = msg;
      this.office.markDirty();
    } finally {
      this.busy = false;
    }
  }

  /** Aplica um estado lido (exportado para testes). */
  apply(st: CerebroEstado, boot: boolean): void {
    const agora = Date.parse(st.agora);
    this.lastAgora = Number.isFinite(agora) ? agora : this.now();
    this.syncAgents(st.agentes ?? []);
    const live = !boot;
    // interações primeiro (fecham execuções), na ordem em que aconteceram
    const inters = [...(st.interacoes ?? [])].sort((a, b) => a.id - b.id);
    for (const it of inters) this.onInteraction(it, live);
    const execs = [...(st.execucoes ?? [])].sort((a, b) => Date.parse(a.iniciado_em) - Date.parse(b.iniciado_em));
    for (const ex of execs) this.onExecution(ex, live);
    this.trimSeen();
    this.refreshAll();
  }

  private syncAgents(rows: readonly CerebroAgente[]): void {
    const wanted = orderAgents(rows.filter((r) => !FORA.has(String(r.status ?? '').toLowerCase())));
    const keep = new Set(wanted.map((r) => r.slug));
    for (const row of wanted) {
      const cur = this.agents.get(row.slug);
      if (cur) {
        const moved = roomPathOf(cur.row) !== roomPathOf(row) || cur.row.nome !== row.nome || cur.row.escritorio?.posto !== row.escritorio?.posto;
        cur.row = row;
        if (!moved) continue;
        // mudou de sala, de nome ou de posto: sai e entra de novo
        this.office.closeMain(cur.id);
        this.agents.delete(row.slug);
      }
      const id = `n8n:${row.slug}`;
      const esc = row.escritorio ?? {};
      const now = this.now();
      this.office.addMain({
        id,
        account: 'n8n',
        sessionId: `n8n:${row.slug}`,
        cwd: roomPathOf(row),
        role: esc.papel || row.dominio || 'Agente do n8n',
        startedAt: now,
        status: 'idle',
        name: row.nome,
        look: esc.visual === 'f' ? 'f' : 'm',
        roomKind: esc.tipo || 'sala',
        post: esc.posto,
      });
      const state: AgentState = { row, id, open: new Map(), openGatilho: new Map(), flashUntil: 0, stats: zero(), statsDay: dayOf(now) };
      this.agents.set(row.slug, state);
      this.pushStats(state);
    }
    for (const [slug, a] of this.agents) {
      if (keep.has(slug)) continue;
      this.office.closeMain(a.id);
      this.agents.delete(slug);
    }
  }

  private onExecution(ex: CerebroExecucao, live: boolean): void {
    const a = this.agents.get(ex.agente);
    if (!a) return;
    const started = Date.parse(ex.iniciado_em);
    const finished = ex.finalizado_em ? Date.parse(ex.finalizado_em) : undefined;
    const running = ex.status === 'rodando' && finished === undefined && this.now() - started < this.cfg.timeoutMs;
    const prev = this.seenExec.get(ex.id);
    const key = running ? 'rodando' : 'fim';
    if (prev === key) return;
    this.seenExec.set(ex.id, key);
    if (running) {
      a.open.set(ex.id, started);
      if (ex.gatilho) a.openGatilho.set(ex.id, ex.gatilho.toLowerCase());
      if (prev === undefined) this.office.addActivity(a.id, this.startActivity(a, ex, started), true, { feed: live });
    } else {
      a.open.delete(ex.id);
      a.openGatilho.delete(ex.id);
      // início de uma execução que já terminou e nunca foi vista: entra no histórico, sem balão
      if (prev === undefined) this.office.addActivity(a.id, this.startActivity(a, ex, started), false, { feed: false });
    }
  }

  private startActivity(a: AgentState, ex: CerebroExecucao, at: number): Activity {
    const canal = ex.canal ?? 'telegram';
    const rotina = ex.gatilho && ex.gatilho !== 'chat';
    const what = ex.resumo?.trim();
    let text: string;
    let kind: ActivityKind = 'prompt';
    const pedido = /^pedido d[oa] /i.exec(ex.gatilho ?? '');
    if (pedido) {
      kind = 'communicate';
      text = `${ex.gatilho!.replace(/^pedido/i, 'Pedido')}${what ? `: ${what}` : ''}`;
    } else if (rotina) {
      kind = 'plan';
      text = what ? `Rotina: ${what}` : `Rotina: ${ex.gatilho}`;
    } else if (canal === 'web') text = what ? `Site: ${what}` : 'Atendendo no site';
    else text = what ? what : 'Recebeu uma mensagem';
    const icon = /^pedido d[oa] /i.test(ex.gatilho ?? '') ? '🤝' : rotina ? '⏰' : (CANAL_ICON[canal] ?? '💬');
    const act: Activity = { id: `${a.id}#e:${ex.id}`, kind, icon, text: fit(text), at };
    if (what && what.length > MAX_TEXT) act.detail = what;
    return act;
  }

  private onInteraction(it: CerebroInteracao, live: boolean): void {
    if (this.seenInter.has(it.id)) return;
    this.seenInter.add(it.id);
    const a = this.agents.get(it.agente);
    if (!a) return;
    const at = Date.parse(it.ocorrido_em);
    const began = at - Math.max(0, it.duracao_ms ?? 0);
    const exec = it.n8n_execution_id ?? undefined;
    const hadStart = exec !== undefined && this.seenExec.has(exec);
    if (exec) {
      a.open.delete(exec);
      a.openGatilho.delete(exec);
      this.seenExec.set(exec, 'fim');
    }
    // pedidos que este agente fez a colegas (subfluxos sem log de fim, ex.: "pedido do Salsicha") terminam com ele
    const nome = a.row.nome.toLowerCase();
    for (const other of this.agents.values()) {
      if (other === a) continue;
      for (const [id, g] of other.openGatilho) {
        if (!g.includes(nome)) continue;
        other.open.delete(id);
        other.openGatilho.delete(id);
      }
    }
    // pedido (só quando o início não foi registrado; senão o balão do início já mostrou)
    if (!hadStart && it.entrada?.trim()) {
      const canal = it.canal ?? 'telegram';
      const icon = CANAL_ICON[canal] ?? '💬';
      const text = canal === 'cron' ? `Rotina: ${it.entrada}` : it.entrada;
      const act: Activity = { id: `${a.id}#i:${it.id}:p`, kind: canal === 'cron' ? 'plan' : 'prompt', icon, text: fit(text), at: began };
      if (text.length > MAX_TEXT) act.detail = text;
      this.office.addActivity(a.id, act, false, { feed: live });
    }
    const tools = (it.ferramentas ?? []).filter(Boolean);
    tools.forEach((t, i) => {
      this.office.addActivity(a.id, { id: `${a.id}#i:${it.id}:t${i}`, kind: 'mcp', icon: '🔧', text: fit(`Usou ${toolLabel(t)}`), tool: t, at: Math.max(began, at - 1) }, false, { feed: live });
    });
    const took = formatSecs(it.duracao_ms);
    let final: Activity;
    if (it.status === 'erro') {
      final = { id: `${a.id}#i:${it.id}:f`, kind: 'error', icon: '⚠️', text: fit(`Erro${it.erro ? `: ${it.erro}` : ''}`), at, error: true };
      if (it.erro) final.detail = it.erro;
    } else if (it.status === 'ignorado') {
      final = { id: `${a.id}#i:${it.id}:f`, kind: 'other', icon: '🙈', text: fit(it.entrada ? `Ignorou: ${it.entrada}` : 'Ignorou'), at };
    } else if (it.canal === 'api') {
      final = { id: `${a.id}#i:${it.id}:f`, kind: 'communicate', icon: '📤', text: 'Enviou o lead para o CRM', at };
    } else {
      final = { id: `${a.id}#i:${it.id}:f`, kind: 'done', icon: '✅', text: took ? `Respondeu em ${took}` : 'Respondeu', at };
      if (it.intencao) final.detail = it.intencao;
    }
    if (it.duracao_ms) final.durationMs = it.duracao_ms;
    this.office.addActivity(a.id, final, true, { feed: live });
    this.addStats(a, it, at);
    if (!live) return;
    if (!hadStart) a.flashUntil = Math.max(a.flashUntil, this.now() + FLASH_MS);
    if (it.status === 'erro') {
      this.office.roomEffect(a.id, 'alarm', fit(`Erro no ${a.row.nome}`, 30), ALARM_MS);
      this.office.externalNotice(a.id, 'alert', `⚠️ ${a.row.nome} teve um erro${it.erro ? `: ${fit(it.erro, 80)}` : ''}`);
    } else if (it.canal === 'api' && it.status === 'ok') {
      this.office.roomEffect(a.id, 'party', 'Lead novo no CRM!', PARTY_MS);
      this.office.externalNotice(a.id, 'success', `🎉 ${a.row.nome} enviou um lead para o CRM`);
    }
    this.helpers(a, tools, at);
  }

  /** Colegas que ajudaram (colabora_com no Cérebro, ou o nome do colega no nome da ferramenta). */
  private helpers(a: AgentState, tools: readonly string[], at: number): void {
    if (!tools.length) return;
    const map = a.row.escritorio?.colabora_com ?? {};
    for (const other of this.agents.values()) {
      if (other === a) continue;
      const words = [...(map[other.row.slug] ?? []), other.row.nome.toLowerCase()].filter((w) => w.length >= 3);
      const used = tools.find((t) => {
        const name = toolLabel(t).toLowerCase();
        return words.some((w) => name.includes(w.toLowerCase()));
      });
      if (!used) continue;
      other.flashUntil = Math.max(other.flashUntil, this.now() + HELP_MS);
      this.office.addActivity(other.id, { id: `${other.id}#ajuda:${a.row.slug}:${at}`, kind: 'communicate', icon: '🤝', text: fit(`Ajudando ${a.row.nome}: ${toolLabel(used)}`), at }, true);
    }
  }

  private addStats(a: AgentState, it: CerebroInteracao, at: number): void {
    const day = dayOf(this.now());
    if (a.statsDay !== day) {
      a.statsDay = day;
      a.stats = zero();
    }
    if (dayOf(at) !== day) return;
    a.stats.toolCalls += (it.ferramentas ?? []).filter(Boolean).length;
    a.stats.tokensIn += it.tokens_entrada ?? 0;
    a.stats.tokensOut += it.tokens_saida ?? 0;
    // o escritório mostra custo em R$ (campo costUSD carrega reais nesta versão; ver client/src/ui/format.ts)
    const brl = it.custo_brl ?? undefined;
    a.stats.costUSD = (a.stats.costUSD ?? 0) + (brl ?? 0);
    this.pushStats(a);
  }

  private pushStats(a: AgentState): void {
    this.office.applyTranscript(a.id, {
      title: a.row.dominio ? `${a.row.dominio}` : undefined,
      tasks: [],
      stats: { ...a.stats },
    });
  }

  /** Status de cada agente: trabalhando com execução aberta (ou "flash"); senão, à toa. */
  private refreshAll(): void {
    const now = this.now();
    for (const a of this.agents.values()) {
      for (const [id, started] of a.open) {
        if (now - started < this.cfg.timeoutMs) continue;
        a.open.delete(id);
        a.openGatilho.delete(id);
      }
      if (a.statsDay !== dayOf(now)) {
        a.statsDay = dayOf(now);
        a.stats = zero();
        this.pushStats(a);
      }
      const working = a.open.size > 0 || a.flashUntil > now;
      this.office.setStatus(a.id, working ? 'working' : 'idle');
    }
  }

  private trimSeen(): void {
    if (this.seenInter.size > SEEN_MAX) {
      const keep = [...this.seenInter].sort((x, y) => y - x).slice(0, SEEN_MAX / 2);
      this.seenInter = new Set(keep);
    }
    if (this.seenExec.size > SEEN_MAX) {
      const entries = [...this.seenExec.entries()].slice(-SEEN_MAX / 2);
      this.seenExec = new Map(entries);
    }
  }
}
