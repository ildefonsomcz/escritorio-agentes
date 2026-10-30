// Restaurante (sala do tipo 'restaurante', a primeira do prédio, junto da entrada): cozinha na parede norte, balcão de
// atendimento no meio e salão com mesinhas. Mesmas dimensões e porta de uma sala de projeto (16x12).
//
//   linhas 0–1  face da parede norte (salas ao sul: com a passagem da porta)
//   linha  2    cozinha: bancadas, pia, cafeteira, micro-ondas, geladeira (colunas 1–6) | prateleiras (10–14)
//   linha  3    posto "cozinha" (em pé, virado para a bancada)
//   linha  4    posto "balcao" (em pé atrás do balcão, de frente para o salão)
//   linha  5    balcão de atendimento (3x1, colunas 10–12)
//   linhas 6–10 salão: mesinhas com cadeiras (a passagem da porta, colunas 7–8, fica livre)
//   linha 11    parede sul (salas ao norte: com a porta para o corredor)
//
// Os postos (`post`) são reservados: o agente com AgentInfo.post igual senta/fica ali (sim/behavior.ts, chooseSeat).
// As cadeiras do salão são 'cafe_seat': os colegas à toa também vêm tomar um café aqui.
import type { Dir, FurnitureKind, RoomTheme, WallStyle } from '../../art/api';
import { mulberry32 } from '../../../../shared/hash';
import { DOOR_W, DOOR_X, TILE } from '../constants';
import { AreaBuilder } from './builder';
import { slotRect, slotSide } from './geometry';
import type { AreaLayout } from './types';
import type { RoomInput } from './room';

const WALL: WallStyle = { base: '#e9d5b5', trim: '#8a5a3c' };
const FLOOR_TINT = '#c98a4b';

export function layoutRestaurantRoom(room: RoomInput, theme: RoomTheme): AreaLayout {
  const rect = slotRect(room.slot);
  const side = slotSide(room.slot);
  const north = side === 'north';
  const rng = mulberry32(room.seed ^ 0x2e57);
  const b = new AreaBuilder(room.id, 'room', rect);
  const area = b.area;
  area.side = side;
  const door = { lx: DOOR_X, w: DOOR_W };
  const furn = (kind: FurnitureKind, lx: number, ly: number, variant?: string, order = 0.5) => b.furn(kind, lx, ly, variant, { order });
  const chair = (lx: number, ly: number, dir: Dir, order: number) => b.seat('cafe_seat', 'cafe_chair', lx, ly, dir, dir, { order });

  // ---- piso: xadrez de restaurante na cozinha, madeira no salão
  b.floor('tile_check', 0, 0, 16, 4, room.seed);
  b.floor('wood', 0, 4, 16, 8, room.seed + 1);
  area.floorTint = FLOOR_TINT;
  // tapete do salão e tapetinho da entrada
  b.rug(1.5, 6.5, 5, 3.5, '#b5482f', room.seed + 2);
  b.rug(10.25, 6.75, 4.5, 3.5, '#b5482f', room.seed + 3);
  b.rug(DOOR_X - 0.25, north ? 9.5 : 2, DOOR_W + 0.5, 1.25, '#7a3b22', room.seed + 4);

  // ---- paredes (iguais às da sala de projeto, com o tom do restaurante)
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

  // ---- parede: placa, cardápio (TV), relógio, quadro e janela
  area.signId = b.wall('sign', north ? 8 : 11, undefined, { order: 0.95 });
  b.wall('tv', north ? 4 : 3, undefined, { order: 0.6 });
  b.wall('clock', north ? 10.5 : 13.5, undefined, { order: 0.7 });
  b.wall('painting', north ? 12.5 : 5.5, undefined, { order: 0.4 });
  if (north) {
    b.wall('light_switch', DOOR_X - 0.5, 'on', { ly: 12, on: 'south', order: 0.8 });
    b.spot('switch', DOOR_X - 1, 10, 'down', { dy: -1 });
  } else {
    b.wall('light_switch', DOOR_X - 0.5, 'on', { order: 0.8 });
    b.spot('switch', DOOR_X - 1, 2, 'up', { dy: -3 });
  }

  // ---- cozinha (colunas 1–6 da linha 2; as colunas 7–8 ficam livres para a porta das salas ao sul)
  furn('counter', 1, 2, 'drawers', 0.2);
  furn('counter_sink', 2, 2, undefined, 0.22);
  const coffee = furn('coffee_machine', 3, 2, undefined, 0.24);
  furn('microwave', 4, 2, undefined, 0.26);
  furn('counter', 5, 2, 'plain', 0.28);
  furn('fridge', 6, 2, undefined, 0.3);
  // posto da cozinha/estoque: em pé, de frente para a bancada
  b.spot('stand', 5, 3, 'up', { dy: -2, post: 'cozinha' });
  b.spot('stand', 1, 3, 'up', { dy: -2, post: 'cozinha' });
  // a cafeteira também serve aos colegas
  b.spot('coffee', 3, 3, 'up', { dy: -2, furnitureId: coffee });

  // ---- prateleiras e estoque à direita
  furn('binder_shelf', 13, 2, undefined, 0.3);
  furn('vending_machine', 14, 2, undefined, 0.32);
  furn('plant_tall', 9, 2, rng() < 0.5 ? 'palm' : 'monstera', 0.2);

  // ---- balcão de atendimento: quem atende fica atrás dele (linha 4), virado para o salão
  furn('reception_desk', 10, 5, undefined, 0.4);
  b.spot('stand', 11, 4, 'down', { dy: -1, post: 'balcao' });
  b.spot('stand', 12, 4, 'down', { dy: -1, post: 'balcao' });
  furn('plant_small', 13, 5, 'flower', 0.42);

  // ---- salão: mesinhas com duas cadeiras cada
  furn('cafe_table', 3, 7, undefined, 0.45);
  chair(2, 7, 'right', 0.6);
  chair(4, 7, 'left', 0.61);
  furn('cafe_table', 3, 9, undefined, 0.46);
  chair(2, 9, 'right', 0.62);
  chair(4, 9, 'left', 0.63);
  furn('cafe_table', 12, 8, undefined, 0.47);
  chair(11, 8, 'right', 0.64);
  chair(13, 8, 'left', 0.65);
  furn('plant_small', 1, 10, 'fern', 0.5);
  furn('plant_tall', 14, 10, 'ficus', 0.5);
  furn('trash_bin', 6, 10, undefined, 0.5);

  // pontos em pé extras (colegas visitando; sem posto)
  b.spot('stand', 9, 7, 'left');
  b.spot('stand', 6, 6, 'down');

  void theme;
  const p = { x: rect.x * TILE, y: rect.y * TILE, w: rect.w * TILE, h: rect.h * TILE };
  area.shade = north ? { x: p.x, y: p.y, w: p.w, h: p.h - TILE } : { x: p.x, y: p.y, w: p.w, h: p.h };
  return b.build();
}
