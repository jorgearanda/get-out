'use strict';
// Line of sight: a 360° visibility polygon around the player, where the reach of each
// ray depends on its angle (long inside the view cone, short "close awareness" outside it).
// Besides the polygon, we record exactly which stretch of each wall face the rays landed
// on, so the renderer can light only the parts of walls the character actually sees.

const FACE_N = 0, FACE_E = 1, FACE_S = 2, FACE_W = 3;

function wrapAngle(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

function smoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

// Grid DDA raycast. Returns the hit point plus which cell/face was struck.
function castRay(map, ox, oy, dx, dy, maxDist) {
  let cx = Math.floor(ox), cy = Math.floor(oy);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx > 0 ? (cx + 1 - ox) * tDX : dx < 0 ? (ox - cx) * tDX : Infinity;
  let tMaxY = dy > 0 ? (cy + 1 - oy) * tDY : dy < 0 ? (oy - cy) * tDY : Infinity;
  for (;;) {
    let t, face;
    if (tMaxX < tMaxY) { t = tMaxX; cx += stepX; tMaxX += tDX; face = stepX > 0 ? FACE_W : FACE_E; }
    else { t = tMaxY; cy += stepY; tMaxY += tDY; face = stepY > 0 ? FACE_N : FACE_S; }
    if (t >= maxDist) return { x: ox + dx * maxDist, y: oy + dy * maxDist, cell: -1, face: -1 };
    if (map.isWall(cx, cy)) return { x: ox + dx * t, y: oy + dy * t, cell: cy * map.W + cx, face };
  }
}

function makeRangeFn(facing, P) {
  const { half, soft, range, periph } = P;
  return a => {
    const rel = Math.abs(wrapAngle(a - facing));
    if (rel <= half) return range;
    if (rel >= half + soft) return periph;
    return range + (periph - range) * smoothstep((rel - half) / soft);
  };
}

function computeVision(map, px, py, facing, P) {
  const { half, soft, range } = P;
  const rangeAt = makeRangeFn(facing, P);
  const angles = [];

  // Dense rays inside the cone (smooth arc at the edge of sight), sparse ones behind.
  const span = Math.min(Math.PI, half + soft + 0.02);
  const dense = 0.3 * Math.PI / 180;
  for (let a = -span; a < span; a += dense) angles.push(facing + a);
  if (span < Math.PI) {
    const sparse = 2.5 * Math.PI / 180;
    for (let a = span; a < 2 * Math.PI - span; a += sparse) angles.push(facing + a);
  }

  // Rays aimed just either side of every wall corner, for crisp shadow edges.
  const reach = range + 1.5, eps = 1e-4;
  const x0 = Math.max(0, Math.floor(px - reach)), x1 = Math.min(map.W, Math.ceil(px + reach));
  const y0 = Math.max(0, Math.floor(py - reach)), y1 = Math.min(map.H, Math.ceil(py + reach));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const w = map.isWall(x - 1, y - 1) + map.isWall(x, y - 1) + map.isWall(x - 1, y) + map.isWall(x, y);
      if (w === 0 || w === 4) continue;
      const dx = x - px, dy = y - py;
      const a = Math.atan2(dy, dx);
      if (Math.hypot(dx, dy) > rangeAt(a) + 0.75) continue;
      angles.push(a - eps, a, a + eps);
    }
  }

  for (let i = 0; i < angles.length; i++) angles[i] = wrapAngle(angles[i]);
  angles.sort((a, b) => a - b);

  const pts = [];
  for (const a of angles) {
    const h = castRay(map, px, py, Math.cos(a), Math.sin(a), rangeAt(a));
    h.a = a;
    pts.push(h);
  }

  // Visible stretches of wall faces: consecutive rays striking the same face.
  const faces = new Map();
  const litCells = new Set();
  const tOf = (p) => {
    const cx = p.cell % map.W, cy = (p.cell / map.W) | 0;
    const t = (p.face === FACE_N || p.face === FACE_S) ? p.x - cx : p.y - cy;
    return Math.max(0, Math.min(1, t));
  };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (a.cell < 0) continue;
    litCells.add(a.cell);
    if (b.cell !== a.cell || b.face !== a.face) continue;
    const key = a.cell * 4 + a.face;
    const ta = tOf(a), tb = tOf(b);
    let list = faces.get(key);
    if (!list) faces.set(key, list = []);
    list.push([Math.min(ta, tb), Math.max(ta, tb)]);
  }
  for (const [key, list] of faces) {
    list.sort((p, q) => p[0] - q[0]);
    const merged = [list[0].slice()];
    for (let i = 1; i < list.length; i++) {
      const last = merged[merged.length - 1];
      if (list[i][0] <= last[1] + 0.03) last[1] = Math.max(last[1], list[i][1]);
      else merged.push(list[i].slice());
    }
    faces.set(key, merged);
  }

  return {
    pts, faces, litCells, px, py, facing, half, soft, range,
    // Fast test for a star-shaped polygon: binary search on ray angle.
    sees(x, y) {
      const dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
      if (d < 1e-6) return true;
      const q = Math.atan2(dy, dx), n = pts.length;
      let lo = 0, hi = n - 1;
      if (q < pts[0].a || q >= pts[n - 1].a) { lo = n - 1; }
      else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].a <= q) lo = m; else hi = m; } }
      const A = pts[lo], B = pts[(lo + 1) % n];
      const ex = B.x - A.x, ey = B.y - A.y;
      const den = dx / d * ey - dy / d * ex;
      let t;
      if (Math.abs(den) < 1e-9) t = Math.min(Math.hypot(A.x - px, A.y - py), Math.hypot(B.x - px, B.y - py));
      else t = ((A.x - px) * ey - (A.y - py) * ex) / den;
      return d <= t + 1e-6;
    },
    contains(x, y) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    },
  };
}
