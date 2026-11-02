// Cena do escritório para a Manu (POST/GET /api/cena). A página aberta manda, a cada 15 s, onde cada agente está e o
// que faz na tela (client/src/world/scene-report.ts). O servidor guarda o último retrato e o grava no Cérebro
// (RPC public.cerebro_escritorio_cena_gravar), de onde a ferramenta "Ver o escritorio agora" da Manu lê junto com o
// trabalho real (RPC public.manu_escritorio_agora).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CerebroConfig } from '../config';
import { log } from '../log';

export interface CenaItem {
  slug: string;
  nome: string;
  lugar: string;
  atividade: string;
  roda: string | null;
  com: string[];
  fala: string;
  dormindo: boolean;
  modo: string;
}

/** Grava no Cérebro no máximo uma vez a cada tanto (várias abas abertas mandam cada uma o seu retrato). */
const SAVE_EVERY_MS = 10_000;
const MAX_ITEMS = 80;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Valida e limpa o corpo de POST /api/cena. Itens sem slug ou nome são descartados. */
export function cleanCena(body: unknown): CenaItem[] | null {
  const list = (body as { cena?: unknown } | null)?.cena;
  if (!Array.isArray(list)) return null;
  const out: CenaItem[] = [];
  for (const raw of list.slice(0, MAX_ITEMS)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const slug = str(r.slug, 80);
    const nome = str(r.nome, 80);
    if (!slug || !nome) continue;
    out.push({
      slug,
      nome,
      lugar: str(r.lugar, 80),
      atividade: str(r.atividade, 160),
      roda: str(r.roda, 20) || null,
      com: Array.isArray(r.com) ? r.com.map((n) => str(n, 80)).filter(Boolean).slice(0, 8) : [],
      fala: str(r.fala, 140),
      dormindo: r.dormindo === true,
      modo: str(r.modo, 12),
    });
  }
  return out;
}

export interface CenaStore {
  current(): { cena: CenaItem[]; at: number } | null;
  handle(req: IncomingMessage, res: ServerResponse, readJson: (req: IncomingMessage) => Promise<unknown>, send: (res: ServerResponse, status: number, body: unknown) => void): Promise<void>;
}

export function createCenaStore(cfg: CerebroConfig | undefined, now: () => number = Date.now): CenaStore {
  let last: { cena: CenaItem[]; at: number } | null = null;
  let savedAt = 0;
  let saving = false;

  const save = async (cena: CenaItem[]) => {
    if (!cfg?.url || !cfg.key || saving) return;
    saving = true;
    const headers: Record<string, string> = { 'content-type': 'application/json', apikey: cfg.key };
    if (!cfg.key.startsWith('sb_')) headers.authorization = `Bearer ${cfg.key}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(`${cfg.url}/rest/v1/rpc/cerebro_escritorio_cena_gravar`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_cena: cena }),
        signal: ctrl.signal,
      });
      if (!res.ok) log.warn(`Cena da Manu: HTTP ${res.status} ao gravar no Cérebro: ${(await res.text()).slice(0, 200)}`);
    } catch (err) {
      log.warn(`Cena da Manu: falha ao gravar no Cérebro (${(err as Error).message})`);
    } finally {
      clearTimeout(t);
      saving = false;
    }
  };

  return {
    current: () => last,
    async handle(req, res, readJson, send) {
      const method = req.method ?? 'GET';
      if (method === 'GET' || method === 'HEAD') {
        send(res, 200, last ?? { cena: [], at: null });
        return;
      }
      if (method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        send(res, 405, { error: 'método não permitido' });
        return;
      }
      const cena = cleanCena(await readJson(req));
      if (!cena) {
        send(res, 400, { error: 'esperado {cena: [...]}' });
        return;
      }
      last = { cena, at: now() };
      if (now() - savedAt >= SAVE_EVERY_MS) {
        savedAt = now();
        void save(cena);
      }
      send(res, 200, { ok: true, agentes: cena.length });
    },
  };
}
