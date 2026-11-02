// Vibe Code (sala do tipo 'vibecode'): sala de descanso e criação, com um aquário grande (3 tiles, uns 2 m na escala do
// escritório), sofá virado para o aquário, puffs em volta de uma mesinha, duas estações de código e um fliperama. Mesmas
// dimensões e porta de uma sala de projeto (16x12). Pode existir sem nenhum agente (sala fixa do Cérebro,
// cerebro.escritorio_salas): fica sempre acesa e os colegas à toa vêm sentar no sofá, nos puffs e ver os peixes.
//
//   linhas 0–1  face da parede norte (salas ao sul: com a passagem da porta) — placa, pôsteres, relógio
//   linha  2    estante | aquário (colunas 10–12, sem nada na frente) | fliperama (coluna 14)
//   linha  3    quem vem olhar os peixes (spots 'window', de frente para o aquário)
//   linhas 4–5  estações de código (colunas 2–5) | sofá de costas, de frente para o aquário (colunas 10–12)
//   linhas 7–9  puffs em volta da mesinha (colunas 2–5) | dois puffs atrás do sofá (colunas 10 e 12)
//   linha 11    parede sul (salas ao norte: com a porta para o corredor)
import type { FurnitureKind, RoomTheme, WallStyle } from '../../art/api';
import { DOOR_W, DOOR_X, TILE } from '../constants';
import { AreaBuilder } from './builder';
import { slotRect, slotSide } from './geometry';
import type { AreaLayout } from './types';
import type { RoomInput } from './room';

const WALL: WallStyle = { base: '#2f2b4f', trim: '#8f6bff', pattern: 'stripes' };
const CARPET = '#3a3160';
const CARPET2 = '#342b57';
const RUG_FISH = '#1f6f86';
const RUG_PUFF = '#7a3fa0';

export function layoutVibeCodeRoom(room: RoomInput, theme: RoomTheme): AreaLayout {
  const rect = slotRect(room.slot);
  const side = slotSide(room.slot);
  const north = side === 'north';
  const b = new AreaBuilder(room.id, 'room', rect);
  const area = b.area;
  area.side = side;
  const door = { lx: DOOR_X, w: DOOR_W };
  const furn = (kind: FurnitureKind, lx: number, ly: number, variant?: string, order = 0.5, dx?: number) => b.furn(kind, lx, ly, variant, { order, dx });

  // ---- carpete roxo-escuro, tapete azul-petróleo diante do aquário e roxo sob os puffs
  b.floor('carpet', 0, 0, 16, 12, room.seed, CARPET, CARPET2);
  area.floorTint = CARPET;
  b.rug(9.25, 2.6, 4.5, 4.2, RUG_FISH, room.seed + 1);
  b.rug(1.5, 6.6, 5, 3.6, RUG_PUFF, room.seed + 2);
  b.rug(DOOR_X - 0.25, north ? 9.5 : 2, DOOR_W + 0.5, 1.25, '#241f3d', room.seed + 3);

  // ---- paredes (escuras, com faixa neon)
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

  // ---- parede: placa ("Vibe Code") sobre as estações, pôsteres e relógio (a passagem da porta fica livre)
  area.signId = b.wall('sign', 4, undefined, { order: 0.95 });
  b.wall('poster', 1.5, 'code', { order: 0.5 });
  b.wall('poster', 6.1, 'rocket', { order: 0.52 });
  b.wall('clock', 9.6, undefined, { order: 0.7 });
  b.wall('poster', 13.6, 'ship_it', { order: 0.54 });
  if (north) {
    b.wall('light_switch', DOOR_X - 0.5, 'on', { ly: 12, on: 'south', order: 0.8 });
    b.spot('switch', DOOR_X - 1, 10, 'down', { dy: -1 });
  } else {
    b.wall('light_switch', DOOR_X - 0.5, 'on', { order: 0.8 });
    b.spot('switch', DOOR_X - 1, 2, 'up', { dy: -3 });
  }

  // ---- aquário grande encostado na parede, com quem vem olhar os peixes na frente
  furn('aquarium', 10, 2, undefined, 0.3);
  b.spot('window', 10, 3, 'up', { dx: 4, dy: -2 });
  b.spot('window', 12, 3, 'up', { dx: -4, dy: -2 });
  // fliperama no canto
  furn('arcade', 14, 2, undefined, 0.26);
  b.spot('arcade', 14, 3, 'up', { dy: -3 });

  // ---- sofá de costas para a câmera, de frente para o aquário
  const sofa = b.furn('sofa', 10, 5, 'up', { order: 0.5 });
  for (let i = 0; i < 3; i++) b.seat('sofa', 'sofa', 10 + i, 5, 'up', 'up', { noFurniture: true, furnitureId: sofa });
  // dois puffs atrás do sofá, também olhando os peixes
  b.seat('beanbag', 'beanbag', 10, 7, 'up', 'blue', { order: 0.62 });
  b.seat('beanbag', 'beanbag', 12, 7, 'up', 'yellow', { order: 0.63 });

  // ---- estações de código (para quem vier fazer vibe code; também servem a um agente desta sala)
  const deskV = theme.deskVariant === 'white' ? 'dark' : theme.deskVariant;
  const d1 = b.furn('desk', 2, 4, deskV, { order: 0.4, seat: 'S0' });
  const d2 = b.furn('desk', 4, 4, deskV, { order: 0.42, seat: 'S1' });
  b.seat('desk', 'office_chair', 2, 5, 'up', 'red', { dx: TILE / 2, deskId: d1, rank: 0, side: 'S', order: 0.6 });
  b.seat('desk', 'office_chair', 4, 5, 'up', 'blue', { dx: TILE / 2, deskId: d2, rank: 1, side: 'S', order: 0.61 });
  furn('binder_shelf', 1, 2, undefined, 0.2);
  furn('floor_lamp', 6, 4, undefined, 0.3);

  // ---- canto dos puffs em volta da mesinha de centro
  furn('coffee_table', 3, 8, undefined, 0.5);
  b.seat('beanbag', 'beanbag', 3, 7, 'down', 'red', { order: 0.64 });
  b.seat('beanbag', 'beanbag', 4, 7, 'down', 'green', { order: 0.65 });
  b.seat('beanbag', 'beanbag', 2, 8, 'right', 'yellow', { order: 0.66 });
  b.seat('beanbag', 'beanbag', 5, 8, 'left', 'blue', { order: 0.67 });

  // ---- cantos de baixo
  furn('plant_small', 1, 10, 'fern', 0.2);
  furn('plant_tall', 14, 10, 'bonsai', 0.26);
  furn('floor_lamp', 13, 10, undefined, 0.25);
  furn('plant_small', 10, 10, 'flower', 0.24);
  // plantas longe do aquário (para não tapar a vista)
  furn('plant_tall', 6, 10, 'monstera', 0.22);
  furn('plant_tall', 14, 5, 'palm', 0.23);

  // ponto em pé extra (trabalho sem mesa)
  b.spot('stand', 14, 7, 'left');

  const p = { x: rect.x * TILE, y: rect.y * TILE, w: rect.w * TILE, h: rect.h * TILE };
  area.shade = north ? { x: p.x, y: p.y, w: p.w, h: p.h - TILE } : { x: p.x, y: p.y, w: p.w, h: p.h };
  return b.build();
}
