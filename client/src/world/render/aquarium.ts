// Vida do aquário (sala Vibe Code): peixes nadando de um lado para o outro e bolhas subindo, desenhados por cima do
// sprite do aquário (rects.glass = área da água). Só fillRect: cabe em qualquer quadro sem alocar nada.
import { mulberry32 } from '../../../../shared/hash';

interface Fish {
  color: string;
  fin: string;
  /** Faixa de altura (0..1 da área da água). */
  lane: number;
  /** px por segundo. */
  speed: number;
  phase: number;
  big: boolean;
}

const COLORS: readonly [string, string][] = [
  ['#ff8a2a', '#ffffff'], // palhaço
  ['#ffd23f', '#ff9f1c'], // amarelo
  ['#4fb3ff', '#1f5fd1'], // azul
  ['#ff5e7e', '#ffd1dc'], // rosa
  ['#b388ff', '#7c4dff'], // roxo
  ['#7cf29a', '#2fbf71'], // verde
  ['#f4f6f8', '#ff6b35'], // branco com laranja
];

const cache = new Map<number, Fish[]>();

function school(seed: number): Fish[] {
  const hit = cache.get(seed);
  if (hit) return hit;
  const rng = mulberry32((seed ^ 0xf154) >>> 0);
  const list: Fish[] = [];
  for (let i = 0; i < 7; i++) {
    const [color, fin] = COLORS[i % COLORS.length];
    list.push({ color, fin, lane: 0.12 + ((i * 0.13 + rng() * 0.08) % 0.72), speed: 5 + rng() * 9, phase: rng() * 1000, big: i === 0 || i === 4 });
  }
  cache.set(seed, list);
  return list;
}

/** Desenha peixes e bolhas na área `r` (px de mundo). `light` 0..1: com a sala apagada, os peixes quase somem. */
export function drawAquariumLife(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, now: number, seed: number, light = 1): void {
  const t = now / 1000;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.min(1, light));
  // ---- bolhas (três colunas, uma sai do castelinho)
  ctx.fillStyle = 'rgba(235,252,255,0.85)';
  const cols = [0.1, 0.62, 0.86];
  cols.forEach((cx, k) => {
    for (let j = 0; j < 3; j++) {
      const span = r.h + 4;
      const y = r.y + r.h - (((t * (9 + k * 3) + j * (span / 3) + k * 7) % span) | 0);
      const x = r.x + Math.round(r.w * cx + Math.sin(t * 2 + j + k) * 1.2);
      const size = j === 1 ? 2 : 1;
      ctx.fillRect(x, y, size, size);
    }
  });
  // ---- peixes (vai e volta; vira na parede)
  for (const f of school(seed)) {
    const len = f.big ? 7 : 5;
    const travel = r.w - len - 3;
    const p = (t * f.speed + f.phase) % (travel * 2);
    const right = p < travel;
    const fx = Math.round(r.x + 1 + (right ? p : travel * 2 - p));
    const fy = Math.round(r.y + 2 + f.lane * (r.h - 8) + Math.sin(t * 1.6 + f.phase) * 1.5);
    const h = f.big ? 3 : 2;
    ctx.fillStyle = f.color;
    ctx.fillRect(fx, fy, len, h);
    if (f.big) ctx.fillRect(fx + 1, fy - 1, len - 2, 1);
    // rabo (balança) do lado de trás
    const wag = Math.sin(t * 9 + f.phase) > 0 ? 0 : 1;
    ctx.fillStyle = f.fin;
    const tx = right ? fx - 2 : fx + len;
    ctx.fillRect(tx, fy - 1 + wag, 2, h + 1 - wag);
    // listra (peixe-palhaço) e olho
    if (f.fin === '#ffffff') ctx.fillRect(fx + Math.floor(len / 2), fy, 1, h);
    ctx.fillStyle = '#1b1f2a';
    ctx.fillRect(right ? fx + len - 2 : fx + 1, fy, 1, 1);
  }
  ctx.restore();
}
