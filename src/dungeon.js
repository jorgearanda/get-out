'use strict';
// Dungeon generation: rooms + 1-wide corridors on a tile grid.
// grid[i] === 1 means solid wall, 0 means floor.

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, s) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function generateDungeon(seed) {
  const W = 64, H = 48;
  const rnd = mulberry32(seed);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const grid = new Uint8Array(W * H).fill(1);
  const isWall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || grid[y * W + x] === 1;
  const carve = (x, y) => { if (x >= 1 && y >= 1 && x < W - 1 && y < H - 1) grid[y * W + x] = 0; };

  // --- Rooms ---
  const rooms = [];
  for (let t = 0; t < 800 && rooms.length < 15; t++) {
    const big = rnd() < 0.3;
    const w = big ? ri(8, 13) : ri(4, 8);
    const h = big ? ri(7, 10) : ri(4, 7);
    const x = ri(2, W - w - 2), y = ri(2, H - h - 2);
    if (rooms.some(r => x < r.x + r.w + 3 && x + w + 3 > r.x && y < r.y + r.h + 3 && y + h + 3 > r.y)) continue;
    rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
  }
  for (const r of rooms)
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) carve(x, y);

  // --- Corridors: minimum spanning tree + a few extra loops ---
  const n = rooms.length;
  const d2 = (a, b) => (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;
  const edges = [];
  const used = new Set([0]);
  while (used.size < n) {
    let best = null;
    for (const i of used)
      for (let j = 0; j < n; j++)
        if (!used.has(j)) { const d = d2(rooms[i], rooms[j]); if (!best || d < best.d) best = { i, j, d }; }
    used.add(best.j); edges.push([best.i, best.j]);
  }
  const linked = (i, j) => edges.some(e => (e[0] === i && e[1] === j) || (e[0] === j && e[1] === i));
  for (let k = 0; k < Math.floor(n / 3); k++) {
    const i = ri(0, n - 1);
    let best = null;
    for (let j = 0; j < n; j++)
      if (j !== i && !linked(i, j)) { const d = d2(rooms[i], rooms[j]); if (!best || d < best.d) best = { j, d }; }
    if (best) edges.push([i, best.j]);
  }
  const corridor = (a, b, wide) => {
    let x = a.cx, y = a.cy;
    const step = (tx, ty) => {
      while (x !== tx || y !== ty) {
        if (x !== tx) x += Math.sign(tx - x); else y += Math.sign(ty - y);
        carve(x, y);
        if (wide) { carve(x + 1, y); carve(x, y + 1); }
      }
    };
    if (rnd() < 0.5) { step(b.cx, y); step(b.cx, b.cy); } else { step(x, b.cy); step(b.cx, b.cy); }
  };
  for (const [i, j] of edges) corridor(rooms[i], rooms[j], rnd() < 0.15);

  // --- Room furnishing (never touches the outer ring of a room, so connectivity holds) ---
  const props = [];
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i];
    const roll = rnd();
    if (r.w >= 7 && r.h >= 6 && roll < 0.45) {
      const sp = rnd() < 0.5 ? 2 : 3; // pillared hall
      for (let y = r.y + 2; y <= r.y + r.h - 3; y += sp)
        for (let x = r.x + 2; x <= r.x + r.w - 3; x += sp) grid[y * W + x] = 1;
    } else if (r.w >= 8 && r.h >= 5 && roll < 0.75) {
      if (rnd() < 0.5) { for (let x = r.x + 2; x <= r.x + r.w - 3; x++) grid[r.cy * W + x] = 1; }
      else { for (let y = r.y + 2; y <= r.y + r.h - 3; y++) grid[y * W + r.cx] = 1; }
    }
    // Barrels tucked into closed corners
    if (rnd() < 0.6) {
      const corners = [[r.x, r.y, -1, -1], [r.x + r.w - 1, r.y, 1, -1], [r.x, r.y + r.h - 1, -1, 1], [r.x + r.w - 1, r.y + r.h - 1, 1, 1]];
      for (const [x, y, sx, sy] of corners) {
        if (rnd() < 0.5) continue;
        if (!isWall(x + sx, y) || !isWall(x, y + sy) || !isWall(x + sx, y + sy)) continue;
        if (isWall(x, y)) continue;
        const bx = x + 0.5 + sx * 0.2, by = y + 0.5 + sy * 0.2;
        props.push({ type: 'barrel', x: bx, y: by, r: 0.27 });
        if (rnd() < 0.6) props.push({ type: 'barrel', x: bx - sx * 0.58, y: by + (rnd() - 0.5) * 0.05, r: 0.27 });
        if (rnd() < 0.4) props.push({ type: 'barrel', x: bx + (rnd() - 0.5) * 0.05, y: by - sy * 0.58, r: 0.27 });
      }
    }
  }

  // --- Light sources: braziers in some rooms, torches on some walls, the rest dark ---
  // (own random stream, so adding lights doesn't change the layout above)
  const lr = mulberry32(seed ^ 0x5f3759df);
  const lights = [];
  const inRoom = (x, y) => rooms.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const farFromLights = (x, y, d) => lights.every(l => Math.hypot(l.x - x, l.y - y) >= d);
  // Torches hang on wall faces the camera can see: the south face of a wall to the north of a
  // floor square, or the east face of a wall to its west.
  const torchSpot = (x, y) => {
    if (isWall(x, y)) return null;
    if (isWall(x, y - 1) && isWall(x - 1, y - 1) && isWall(x + 1, y - 1))
      return { x: x + 0.5, y: y + 0.14, wx: x, wy: y - 1, face: 'S' };
    if (isWall(x - 1, y) && isWall(x - 1, y - 1) && isWall(x - 1, y + 1))
      return { x: x + 0.14, y: y + 0.5, wx: x - 1, wy: y, face: 'E' };
    return null;
  };
  const addTorch = s => lights.push({ kind: 'torch', r: 4.3, I: 1.15, ...s });
  rooms.forEach((r, i) => {
    const roll = lr();
    if (i === 0 || roll < 0.3) {
      const spots = [];
      for (let x = r.x; x < r.x + r.w; x++) { const s = torchSpot(x, r.y); if (s && s.face === 'S') spots.push(s); }
      for (let y = r.y; y < r.y + r.h; y++) { const s = torchSpot(r.x, y); if (s && s.face === 'E') spots.push(s); }
      const want = r.w * r.h > 40 && lr() < 0.5 ? 2 : 1;
      let placed = 0;
      for (let k = 0; k < 20 && spots.length && placed < want; k++) {
        const s = spots[Math.floor(lr() * spots.length)];
        if (farFromLights(s.x, s.y, 3.5)) { addTorch(s); placed++; }
      }
    } else if (roll < 0.62) {
      // A brazier near the middle, with open floor all around it
      const cands = [];
      for (let y = r.y + 1; y < r.y + r.h - 1; y++)
        for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
          let open = true;
          for (let dy = -1; dy <= 1 && open; dy++) for (let dx = -1; dx <= 1; dx++) if (isWall(x + dx, y + dy)) { open = false; break; }
          if (open && !props.some(p => Math.abs(p.x - x - 0.5) < 1.6 && Math.abs(p.y - y - 0.5) < 1.6))
            cands.push([x, y, Math.hypot(x - r.cx, y - r.cy) + lr() * 0.8]);
        }
      cands.sort((a, b) => a[2] - b[2]);
      if (cands.length) {
        const [x, y] = cands[0];
        lights.push({ kind: 'brazier', x: x + 0.5, y: y + 0.5, r: 5.6, I: 1.45 });
        props.push({ type: 'brazier', x: x + 0.5, y: y + 0.5, r: 0.24 });
      }
    }
  });
  // A few torches along corridors
  const corridorSpots = [];
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (inRoom(x, y)) continue;
      const s = torchSpot(x, y);
      if (s) corridorSpots.push(s);
    }
  for (let i = corridorSpots.length - 1; i > 0; i--) { const j = Math.floor(lr() * (i + 1)); [corridorSpots[i], corridorSpots[j]] = [corridorSpots[j], corridorSpots[i]]; }
  for (const s of corridorSpots) if (lr() < 0.3 && farFromLights(s.x, s.y, 9)) addTorch(s);

  const r0 = rooms[0];
  return {
    W, H, grid, rooms, props, lights, seed, isWall,
    start: { x: r0.cx + 0.5, y: r0.cy + 0.5 },
  };
}
