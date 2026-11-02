// Gerência (sala do tipo 'gerencia': a gerente geral dos agentes do n8n). Mesmas dimensões e porta de uma sala de
// projeto (16x12), com cara de diretoria: piso de madeira, lambri, mesa executiva com poltrona de chefe e uma mesa de
// reunião com poltronas, onde os agentes chamados ouvem a instrução (sim.ts, planSummon).
//
//   linhas 0–1  face da parede norte (salas ao sul: com a passagem da porta) — placa, quadro, relógio, janela
//   linha  2    estantes atrás da mesa executiva
//   linhas 4–7  mesa de reunião 3x2 (colunas 2–4) com poltronas 'listen' em volta | mesa executiva (colunas 10–13)
//   linhas 9–10 cantos decorados (a passagem da porta, colunas 7–8, fica livre)
//   linha 11    parede sul (salas ao norte: com a porta para o corredor)
//
// Spots 'listen' só servem ao chamado da gerente: ninguém senta neles para trabalhar nem para descansar. O de
// `group: GERENCIA_HEAD` é a cabeceira, onde a gerente fica de pé falando com quem veio ouvir.
import type { Dir, FurnitureKind, RoomTheme, WallStyle } from '../../art/api';
import { mulberry32 } from '../../../../shared/hash';
import { DOOR_W, DOOR_X, TILE } from '../constants';
import { AreaBuilder } from './builder';
import { slotRect, slotSide } from './geometry';
import type { AreaLayout } from './types';
import type { RoomInput } from './room';

/** Grupo do spot da cabeceira da mesa de reunião (a gerente, de pé). */
export const GERENCIA_HEAD = 'gerencia:cabeceira';

const WALL: WallStyle = { base: '#3f5d52', trim: '#5a3b26', pattern: 'wood_panel' };
const FLOOR_TINT = '#8a5a34';
const RUG_MEETING = '#6e2633';
const RUG_DESK = '#24395c';

export function layoutGerenciaRoom(room: RoomInput, theme: RoomTheme): AreaLayout {
  const rect = slotRect(room.slot);
  const side = slotSide(room.slot);
  const north = side === 'north';
  const rng = mulberry32(room.seed ^ 0x6e7e);
  const b = new AreaBuilder(room.id, 'room', rect);
  const area = b.area;
  area.side = side;
  const door = { lx: DOOR_X, w: DOOR_W };
  const furn = (kind: FurnitureKind, lx: number, ly: number, variant?: string, order = 0.5, dx?: number) => b.furn(kind, lx, ly, variant, { order, dx });
  /** Poltrona da mesa de reunião (só para quem foi chamado). */
  const listen = (lx: number, ly: number, dir: Dir, order: number) => b.seat('listen', 'armchair', lx, ly, dir, dir, { order });

  // ---- piso de madeira escura, tapete vinho sob a reunião e azul-marinho sob a mesa executiva
  b.floor('wood', 0, 0, 16, 12, room.seed);
  area.floorTint = FLOOR_TINT;
  b.rug(1.25, 3.6, 5.5, 4.8, RUG_MEETING, room.seed + 1);
  b.rug(9.5, 3.4, 5, 4.6, RUG_DESK, room.seed + 2);
  b.rug(DOOR_X - 0.25, north ? 9.5 : 2, DOOR_W + 0.5, 1.25, '#3a2618', room.seed + 3);

  // ---- paredes (lambri de madeira)
  if (north) {
    b.face(0.5, 15, WALL);
    b.south(0.5, 15, 11, WALL, [door]);
  } else {
    b.face(0.5, 15, WALL, [door]);
    b.south(0.5, 15, 11, { ...WALL, exterior: true });
    b.wall('door_frame', DOOR_X + DOOR_W / 2, undefined, { order: 0.05 });
  }
  b.cap(0, 0, 0.5, 12, WALL);
  b.cap(15.5, 0, 0.5, 12, WALL);

  // ---- caminhabilidade
  b.walk(1, 2, 14, 9);
  area.door = north ? { x: rect.x + DOOR_X, y: rect.y + 11, w: DOOR_W, h: 1 } : { x: rect.x + DOOR_X, y: rect.y, w: DOOR_W, h: 2 };
  b.walk(area.door.x - rect.x, area.door.y - rect.y, area.door.w, area.door.h);

  // ---- parede: placa (o nome da sala, ex.: "Diretoria") sobre a mesa executiva, quadro sobre a reunião
  area.signId = b.wall('sign', 11.5, undefined, { order: 0.95 });
  b.wall('painting', 3.5, undefined, { order: 0.4 });
  if (north) {
    b.wall('clock', 5.75, undefined, { order: 0.7 });
    b.wall('window', 8, undefined, { order: 0.45 });
    b.wall('light_switch', DOOR_X - 0.5, 'on', { ly: 12, on: 'south', order: 0.8 });
    b.spot('switch', DOOR_X - 1, 10, 'down', { dy: -1 });
  } else {
    b.wall('clock', 5.5, undefined, { order: 0.7 });
    b.wall('light_switch', DOOR_X - 0.5, 'on', { order: 0.8 });
    b.spot('switch', DOOR_X - 1, 2, 'up', { dy: -3 });
  }

  // ---- planta e estante nos cantos da parede norte (a placa, sobre a mesa executiva, fica à vista)
  furn('plant_tall', 9, 2, rng() < 0.5 ? 'ficus' : 'monstera', 0.2);
  furn('bookshelf', 13, 2, undefined, 0.22);
  furn('binder_shelf', 1, 2, undefined, 0.24);

  // ---- mesa executiva (desk_back escura com gaveteiros dos lados) e a poltrona da chefe, de frente para a sala
  furn('filing_cabinet', 10, 5, undefined, 0.38);
  const desk = furn('desk_back', 11, 5, 'dark', 0.4);
  furn('filing_cabinet', 13, 5, undefined, 0.42);
  b.seat('desk', 'armchair', 11, 4, 'down', 'down', { dx: TILE / 2, deskId: desk, rank: 0, side: 'N', order: 0.55 });
  furn('floor_lamp', 14, 4, undefined, 0.3);
  // duas poltronas de visita em frente à mesa (decoração: ninguém senta)
  furn('armchair', 11, 7, 'up', 0.6);
  furn('armchair', 12, 7, 'up', 0.61);

  // ---- mesa de reunião com poltronas: onde os agentes chamados ouvem a gerente
  furn('meeting_table', 2, 5, undefined, 0.45);
  listen(2, 4, 'down', 0.62);
  listen(4, 4, 'down', 0.63);
  listen(2, 7, 'up', 0.64);
  listen(4, 7, 'up', 0.65);
  listen(1, 5, 'right', 0.66);
  listen(1, 6, 'right', 0.67);
  listen(3, 4, 'down', 0.68);
  listen(3, 7, 'up', 0.69);
  // cabeceira: a gerente fica de pé na ponta da mesa, virada para quem está ouvindo
  b.spot('listen', 5, 5, 'left', { group: GERENCIA_HEAD });

  // ---- cantos de baixo
  furn('plant_tall', 1, 10, 'palm', 0.2);
  furn('binder_shelf', 2, 10, undefined, 0.21);
  furn('filing_cabinet', 3, 10, undefined, 0.22);
  furn('plant_small', 5, 10, 'flower', 0.23);
  furn('water_cooler', 10, 10, undefined, 0.24);
  furn('plant_small', 12, 10, 'succulent', 0.25);
  furn('plant_tall', 14, 10, rng() < 0.5 ? 'bonsai' : 'palm', 0.26);

  // ponto em pé extra (alguém da mesma sala sem mesa trabalha aqui)
  b.spot('stand', 13, 8, 'left');

  void theme;
  const p = { x: rect.x * TILE, y: rect.y * TILE, w: rect.w * TILE, h: rect.h * TILE };
  area.shade = north ? { x: p.x, y: p.y, w: p.w, h: p.h - TILE } : { x: p.x, y: p.y, w: p.w, h: p.h };
  return b.build();
}
