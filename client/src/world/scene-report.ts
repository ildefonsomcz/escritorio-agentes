// Cena do escritório para a Manu (gerente geral): onde cada agente está e o que está fazendo na tela agora
// (trabalhando, jogando videogame com o Scooby, cochilando no lounge...). A vida social roda só no navegador, então a
// página aberta manda este retrato ao servidor de tempos em tempos (POST /api/cena), e o servidor guarda no Cérebro
// para a ferramenta "Ver o escritorio agora" da Manu.
import type { Sim } from './sim/sim';
import type { Character } from './sim/character';
import { inRect } from './layout/geometry';
import { active, KINDS } from './social/gathering';
import { CAFE_ID, LOUNGE_ID, RECEPTION_ID, RESTROOM_ID } from './layout/core';

export interface CenaAgente {
  /** Slug do agente no Cérebro (o id do personagem é `n8n:<slug>`). */
  slug: string;
  nome: string;
  /** Cômodo onde está agora ("Lounge", "Copa", "Sala do Fred"...). */
  lugar: string;
  /** O que está fazendo, em português ("Jogando videogame com Scooby", "Cochilando", "Trabalhando"). */
  atividade: string;
  /** Tipo da roda social (videogame, tv, pingpong, kitchen, talk, rps, arcade, mirror), se estiver numa. */
  roda: string | null;
  /** Colegas na mesma roda. */
  com: string[];
  /** Balão de fala na tela agora (vazio se não está falando). */
  fala: string;
  dormindo: boolean;
  /** Modo do personagem: work | wait | idle | shell | deliver | leave. */
  modo: string;
}

const CORE_NAMES: Readonly<Record<string, string>> = {
  [LOUNGE_ID]: 'Lounge (sala de descanso)',
  [CAFE_ID]: 'Copa',
  [RECEPTION_ID]: 'Recepção',
  [RESTROOM_ID]: 'Banheiros',
};

const MODE_TEXT: Readonly<Record<string, string>> = {
  work: 'Trabalhando',
  wait: 'Esperando uma resposta para continuar',
  shell: 'Esperando um comando terminar',
  deliver: 'Entregando um resultado',
  leave: 'Indo embora',
};

function slugOf(id: string): string {
  return id.startsWith('n8n:') ? id.slice(4) : id;
}

function placeOf(sim: Sim, ch: Character): string {
  for (const area of sim.building.core) if (inRect(area.rect, ch.tx, ch.ty)) return CORE_NAMES[area.id] ?? area.id;
  for (const room of sim.rooms.values()) if (room.present && !room.ghost && inRect(room.layout.rect, ch.tx, ch.ty)) return room.info.name;
  if (inRect(sim.building.corridor.rect, ch.tx, ch.ty)) return 'Corredor';
  return sim.rooms.get(ch.roomId)?.info.name ?? 'Escritório';
}

function idleText(ch: Character, place: string): string {
  if (ch.pose === 'sleep' || ch.icon === 'zzz') return 'Cochilando';
  if (ch.step?.t === 'stall' || (ch.inside && place.startsWith('Banheiros'))) return 'No banheiro';
  if (ch.step?.t === 'go' || ch.step?.t === 'elevIn' || ch.step?.t === 'elevOut') return 'Andando pelo escritório';
  if (ch.held === 'coffee') return 'Tomando um café';
  if (ch.held === 'water') return 'Tomando água';
  if (ch.held === 'phone') return 'Mexendo no celular';
  if (ch.held === 'book') return 'Lendo um livro';
  if (ch.held === 'papers') return 'Olhando o quadro de anotações';
  if (ch.pose === 'stretch') return 'Se espreguiçando';
  if (ch.pose === 'use') return 'Usando uma máquina (café, água ou fliperama)';
  return 'À toa, sem fazer nada';
}

/** Retrato da cena atual: um item por agente presente no escritório. */
export function describeScene(sim: Sim, now: number): CenaAgente[] {
  const out: CenaAgente[] = [];
  for (const ch of sim.chars.values()) {
    if (ch.gone) continue;
    const lugar = placeOf(sim, ch);
    const g = ch.gathering && ch.gathering.phase !== 'ended' ? ch.gathering : null;
    const com = g
      ? active(g)
          .filter((m) => m.id !== ch.id)
          .map((m) => sim.chars.get(m.id)?.info.name)
          .filter((n): n is string => !!n)
      : [];
    const dormindo = ch.pose === 'sleep';
    let atividade: string;
    if (g) {
      const raw = sim.social.doing(ch.id) ?? KINDS[g.kind].label;
      atividade = raw.replace(/^\S+\s/u, '');
      if (dormindo) atividade = `Cochilando (estava: ${atividade})`;
    } else if (ch.leaving) atividade = 'Indo embora';
    else if (ch.mode !== 'idle') atividade = MODE_TEXT[ch.mode] ?? 'Trabalhando';
    else atividade = idleText(ch, lugar);
    out.push({
      slug: slugOf(ch.id),
      nome: ch.info.name,
      lugar,
      atividade,
      roda: g ? g.kind : null,
      com,
      fala: now < ch.sayUntil ? ch.sayText.slice(0, 140) : '',
      dormindo,
      modo: ch.mode,
    });
  }
  return out;
}
