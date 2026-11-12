'use strict';
// Dungeon generation. A level is a handful of 25×25 room templates (see templates.js) laid
// out on a coarse grid of slots, each next to the one it grew from, so the slots form a
// tree. Neighbouring templates share their outer wall, and a doorway opens in the middle of
// it (plus wherever both have an extra connection point). You arrive at one end of the
// longest route through the tree and the stairs down are at the other. A template with a
// locked side is placed on that route, turned so the lock faces onward: you have to find its
// key, somewhere in that template, to get past.
//
// grid[i] === 1 means wall (wallKind says what kind), 0 means floor (furn says what stands
// on it, if anything).

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

const TPL = 25, STRIDE = 24, MID = 12;
// How far light sources reach (tiles) and how bright they are
const TORCH = { r: 6.5, I: 1.35 }, BRAZIER = { r: 8, I: 1.65 };
const WALL_KIND = { '#': 0, '+': 0, K: 1, X: 2 }; // 3 = locked door
const FURN = { T: 1, '=': 2, x: 3, h: 4, '|': 5 };
const FURN_NAME = ['', 'table', 'bed', 'crate', 'bench', 'bars'];
const SIDES = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const ARROW = { '>': [1, 0], '<': [-1, 0], v: [0, 1], '^': [0, -1] };
const KEY_COLORS = [
  { name: 'brass', col: '#e2b34c' }, { name: 'iron', col: '#9fb8d6' }, { name: 'copper', col: '#d27a46' },
];

// The 8 ways to place a template: t & 3 quarter turns, after mirroring left-right if t & 4
function tfCell(t, x, y) {
  if (t & 4) x = TPL - 1 - x;
  for (let i = 0; i < (t & 3); i++) [x, y] = [TPL - 1 - y, x];
  return [x, y];
}
function tfDir(t, dx, dy) {
  if (t & 4) dx = -dx;
  for (let i = 0; i < (t & 3); i++) [dx, dy] = [-dy, dx];
  return [dx, dy];
}

// Carve the template's maze area ('%') into passages: a random spanning tree over the
// cells at even coordinates, plus a few extra openings so it isn't a perfect maze.
function carveMaze(cells, rnd) {
  const inR = (x, y) => x > 0 && y > 0 && x < TPL - 1 && y < TPL - 1 && cells[y][x] === '%';
  const nodes = [];
  for (let y = 2; y < TPL - 1; y += 2) for (let x = 2; x < TPL - 1; x += 2) if (inR(x, y)) nodes.push([x, y]);
  if (!nodes.length) return;
  const seen = new Set(), key = (x, y) => y * TPL + x;
  const D = [[2, 0], [-2, 0], [0, 2], [0, -2]];
  const open = [];
  for (const start of nodes) {
    if (seen.has(key(...start))) continue;
    seen.add(key(...start)); open.push(start);
    const stack = [start];
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const next = D.map(([dx, dy]) => [x + dx, y + dy, x + dx / 2, y + dy / 2])
        .filter(([nx, ny, mx, my]) => inR(nx, ny) && inR(mx, my) && !seen.has(key(nx, ny)));
      if (!next.length) { stack.pop(); continue; }
      const [nx, ny, mx, my] = next[Math.floor(rnd() * next.length)];
      seen.add(key(nx, ny)); open.push([mx, my], [nx, ny]);
      stack.push([nx, ny]);
    }
  }
  // extra openings between neighbouring passages, making loops
  for (const [x, y] of nodes)
    for (const [dx, dy] of [[2, 0], [0, 2]])
      if (inR(x + dx, y + dy) && inR(x + dx / 2, y + dy / 2) && rnd() < 0.12) open.push([x + dx / 2, y + dy / 2]);
  for (const [x, y] of open) cells[y][x] = '.';
  for (let y = 0; y < TPL; y++) for (let x = 0; x < TPL; x++) if (cells[y][x] === '%') cells[y][x] = '#';
}

const WALKABLE_CH = new Set(['.', '@', 'S', 'k', '>', '<', 'v', '^']);

// One template, as placed: its cells after the maze is carved, the key spot chosen, and
// turned to orientation t. Returns a 25×25 array of characters.
function instantiate(tpl, t, rnd, keepKey) {
  const cells = tpl.rows.map(r => [...r]);
  carveMaze(cells, rnd);
  // one of the key spots gets the key (if the lock is in use); the rest are floor
  const ks = [];
  for (let y = 0; y < TPL; y++) for (let x = 0; x < TPL; x++) if (cells[y][x] === 'k') ks.push([x, y]);
  const pick = keepKey && ks.length ? ks[Math.floor(rnd() * ks.length)] : null;
  for (const [x, y] of ks) if (!pick || x !== pick[0] || y !== pick[1]) cells[y][x] = '.';
  const out = [];
  for (let y = 0; y < TPL; y++) out.push(new Array(TPL));
  const flip = { '>': 0, '<': 0, v: 0, '^': 0 };
  for (let y = 0; y < TPL; y++)
    for (let x = 0; x < TPL; x++) {
      let c = cells[y][x];
      if (c in flip) { // turn the guard's facing with the template
        const [dx, dy] = tfDir(t, ...ARROW[c]);
        c = dx > 0 ? '>' : dx < 0 ? '<' : dy > 0 ? 'v' : '^';
      }
      const [nx, ny] = tfCell(t, x, y);
      out[ny][nx] = c;
    }
  return out;
}

function generateDungeon(seed, depth = 1) {
  const rnd = mulberry32(seed);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // --- The layout: a tree of slots on a coarse grid ---
  const wide = rnd() < 0.6;
  const GW = wide ? 4 : 3, GH = wide ? 3 : 4;
  const W = GW * STRIDE + 1, H = GH * STRIDE + 1;
  const n = Math.min(GW * GH, ri(6, 8) + (depth >= 3 ? 1 : 0));
  const adj = new Map();
  const nb = s => {
    const gx = s % GW, gy = (s / GW) | 0, out = [];
    if (gx > 0) out.push(s - 1); if (gx < GW - 1) out.push(s + 1);
    if (gy > 0) out.push(s - GW); if (gy < GH - 1) out.push(s + GW);
    return out;
  };
  const link = (a, b) => { adj.get(a).push(b); adj.get(b).push(a); };
  adj.set(ri(0, GW * GH - 1), []);
  while (adj.size < n) {
    // grow from a random slot; slots with fewer neighbours in use are preferred, so the
    // level branches and winds instead of filling a block
    const cands = [];
    for (const a of adj.keys())
      for (const b of nb(a)) if (!adj.has(b)) cands.push([a, b, nb(b).filter(c => adj.has(c)).length]);
    const best = Math.min(...cands.map(c => c[2]));
    const pool = cands.filter(c => c[2] === best || rnd() < 0.25);
    const [a, b] = pool[Math.floor(rnd() * pool.length)];
    adj.set(b, []); link(a, b);
  }
  const farthest = from => {
    const d = new Map([[from, 0]]), prev = new Map(), q = [from];
    for (let h = 0; h < q.length; h++) for (const b of adj.get(q[h])) if (!d.has(b)) { d.set(b, d.get(q[h]) + 1); prev.set(b, q[h]); q.push(b); }
    let far = from;
    for (const [s, v] of d) if (v > d.get(far) || (v === d.get(far) && rnd() < 0.5)) far = s;
    return { far, prev };
  };
  const startSlot = farthest([...adj.keys()][0]).far;
  const { far: exitSlot, prev } = farthest(startSlot);
  const route = [exitSlot];
  while (route[0] !== startSlot) route.unshift(prev.get(route[0]));

  // --- Which template goes where, and which way round ---
  const starts = TEMPLATES.filter(t => t.start), locked = shuffle(TEMPLATES.filter(t => t.lock && !t.start));
  const plain = shuffle(TEMPLATES.filter(t => !t.lock && !t.start));
  const place = new Map(); // slot -> { tpl, lockTo: slot | null }
  place.set(startSlot, { tpl: starts[Math.floor(rnd() * starts.length)], lockTo: null });
  const inner = shuffle(route.slice(1, -1));
  const nLocks = Math.min(locked.length, inner.length, depth >= 3 && rnd() < 0.5 ? 2 : 1);
  for (let i = 0; i < nLocks; i++) {
    const s = inner[i];
    place.set(s, { tpl: locked.pop(), lockTo: route[route.indexOf(s) + 1] });
  }
  const rest = [...plain, ...locked];
  for (const s of adj.keys()) if (!place.has(s)) place.set(s, { tpl: rest.length ? rest.shift() : plain[0], lockTo: null });

  // --- A few extra doorways between neighbouring slots, for loops (never round a lock) ---
  const lockEdges = new Set([...place].filter(([, p]) => p.lockTo != null).map(([s, p]) => `${Math.min(s, p.lockTo)}-${Math.max(s, p.lockTo)}`));
  const side = new Map(); // which part of the level each slot is in, between the locks
  {
    let part = 0;
    for (const s of adj.keys()) {
      if (side.has(s)) continue;
      const q = [s]; side.set(s, part);
      for (let h = 0; h < q.length; h++)
        for (const b of adj.get(q[h])) {
          if (side.has(b) || lockEdges.has(`${Math.min(q[h], b)}-${Math.max(q[h], b)}`)) continue;
          side.set(b, part); q.push(b);
        }
      part++;
    }
  }
  for (const a of adj.keys())
    for (const b of nb(a))
      if (b > a && adj.has(b) && !adj.get(a).includes(b) && side.get(a) === side.get(b) && rnd() < 0.3) link(a, b);

  // --- Build the grid ---
  const grid = new Uint8Array(W * H).fill(1);
  const wallKind = new Uint8Array(W * H);
  const furn = new Uint8Array(W * H);
  const isWall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || grid[y * W + x] === 1;
  const props = [], braziers = [], posts = [], stairSpots = new Map(), slots = [];
  const doors = [], keys = [];
  let start = null;
  const inst = new Map();
  for (const [s, p] of place) {
    let t = Math.floor(rnd() * 8);
    if (p.lockTo != null) { // turn it so the locked side faces the next slot on the route
      const want = [p.lockTo % GW - s % GW, ((p.lockTo / GW) | 0) - ((s / GW) | 0)];
      const ok = [];
      for (let u = 0; u < 8; u++) { const [dx, dy] = tfDir(u, ...SIDES[p.tpl.lock]); if (dx === want[0] && dy === want[1]) ok.push(u); }
      t = ok[Math.floor(rnd() * ok.length)];
    }
    const cells = instantiate(p.tpl, t, rnd, p.lockTo != null);
    inst.set(s, cells);
    const ox = (s % GW) * STRIDE, oy = ((s / GW) | 0) * STRIDE;
    slots.push({ slot: s, x: ox, y: oy, w: TPL, h: TPL, name: p.tpl.name, id: p.tpl.id, t, cx: ox + MID, cy: oy + MID });
    const sp = [];
    stairSpots.set(s, sp);
    for (let y = 1; y < TPL - 1; y++)
      for (let x = 1; x < TPL - 1; x++) {
        const c = cells[y][x], X = ox + x, Y = oy + y, i = Y * W + X;
        if (c in WALL_KIND) { grid[i] = 1; wallKind[i] = WALL_KIND[c]; continue; }
        grid[i] = 0; wallKind[i] = 0;
        if (c in FURN) furn[i] = FURN[c];
        else if (c === 'b') props.push({ type: 'barrel', x: X + 0.5, y: Y + 0.5, r: 0.27, nudge: true });
        else if (c === 'B') braziers.push([X, Y]);
        else if (c === '@') start = { x: X + 0.5, y: Y + 0.5 };
        else if (c === 'S') sp.push([X, Y]);
        else if (c === 'k') keys.push({ x: X + 0.5, y: Y + 0.5, slot: s });
        else if (c in ARROW) posts.push({ x: X, y: Y, c, guardP: p.tpl.guardP, slot: s });
      }
  }
  // Doorways between linked slots: the middle of the shared wall, plus any other point both
  // sides offer. A locked link gets just the one door, locked.
  for (const [a, list] of adj)
    for (const b of list) {
      if (b < a) continue;
      const horiz = b === a + 1;
      const A = inst.get(a), B = inst.get(b);
      const lockedHere = (place.get(a).lockTo === b) || (place.get(b).lockTo === a);
      for (let o = 1; o < TPL - 1; o++) {
        const both = horiz ? A[o][TPL - 1] === '+' && B[o][0] === '+' : A[TPL - 1][o] === '+' && B[0][o] === '+';
        if (!both || (lockedHere && o !== MID)) continue;
        const X = horiz ? ((b % GW) * STRIDE) : (a % GW) * STRIDE + o;
        const Y = horiz ? ((a / GW) | 0) * STRIDE + o : ((b / GW) | 0) * STRIDE;
        const i = Y * W + X;
        if (lockedHere) {
          const owner = place.get(a).lockTo === b ? a : b;
          const id = doors.length, kc = KEY_COLORS[id % KEY_COLORS.length];
          doors.push({ x: X, y: Y, id, slot: owner, name: kc.name, col: kc.col, axis: horiz ? 'x' : 'y' });
          wallKind[i] = 3;
        } else { grid[i] = 0; wallKind[i] = 0; }
      }
    }
  for (const k of keys) {
    const d = doors.find(d => d.slot === k.slot);
    k.id = d ? d.id : -1; k.name = d ? d.name : ''; k.col = d ? d.col : '#fff';
  }
  if (!start) start = { x: slots[0].cx + 0.5, y: slots[0].cy + 0.5 };

  // Barrels sit snug against whatever wall is next to them
  for (const p of props) {
    if (!p.nudge) continue;
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (isWall(x - 1, y)) p.x -= 0.2; else if (isWall(x + 1, y)) p.x += 0.2;
    if (isWall(x, y - 1)) p.y -= 0.2; else if (isWall(x, y + 1)) p.y += 0.2;
    p.x += (rnd() - 0.5) * 0.08; p.y += (rnd() - 0.5) * 0.08;
    delete p.nudge;
  }

  // --- Furniture: what it takes up of its square, for bumping into ---
  const furnBoxes = new Array(W * H);
  const same = (x, y, f) => x >= 0 && y >= 0 && x < W && y < H && furn[y * W + x] === f && grid[y * W + x] === 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const f = furn[y * W + x];
      if (!f) continue;
      const sW = same(x - 1, y, f), sE = same(x + 1, y, f), sN = same(x, y - 1, f), sS = same(x, y + 1, f);
      let box;
      if (f === 5) { // bars: thin runs from the middle toward any bars or wall alongside
        const t = 0.07, c = 0.5, out = [[x + c - t, y + c - t, x + c + t, y + c + t]];
        const joins = (dx, dy) => same(x + dx, y + dy, 5) || isWall(x + dx, y + dy);
        if (joins(-1, 0)) out.push([x, y + c - t, x + c, y + c + t]);
        if (joins(1, 0)) out.push([x + c, y + c - t, x + 1, y + c + t]);
        if (joins(0, -1)) out.push([x + c - t, y, x + c + t, y + c]);
        if (joins(0, 1)) out.push([x + c - t, y + c, x + c + t, y + 1]);
        furnBoxes[y * W + x] = out;
        continue;
      }
      const ins = f === 3 ? 0.1 : f === 2 ? 0.12 : 0.06;
      box = [x + (sW ? 0 : ins), y + (sN ? 0 : ins), x + 1 - (sE ? 0 : ins), y + 1 - (sS ? 0 : ins)];
      if (f === 4) { // benches are narrow across their length
        if (sW || sE) { box[1] = y + 0.3; box[3] = y + 0.7; } else if (sN || sS) { box[0] = x + 0.3; box[2] = x + 0.7; }
        else { box = [x + 0.3, y + 0.3, x + 0.7, y + 0.7]; }
      }
      furnBoxes[y * W + x] = [box];
    }

  // --- How far every square is from the start (4-way steps, through doors) ---
  const dist = new Int32Array(W * H).fill(-1);
  const passable = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (grid[y * W + x] === 0 || wallKind[y * W + x] === 3);
  {
    const s0 = Math.floor(start.y) * W + Math.floor(start.x), q = [s0];
    dist[s0] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!passable(nx, ny) || dist[ny * W + nx] >= 0) continue;
        dist[ny * W + nx] = dist[c] + 1; q.push(ny * W + nx);
      }
    }
  }
  const propNear = (x, y, d) => props.some(p => Math.abs(p.x - x) < d && Math.abs(p.y - y) < d) ||
    braziers.some(([bx, by]) => Math.abs(bx + 0.5 - x) < d && Math.abs(by + 0.5 - y) < d);
  const clearAround = (x, y) => { // no furniture right next to it
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (furn[(y + dy) * W + x + dx]) return false;
    return true;
  };

  // --- The way out: stairs down, in the slot at the far end of the route ---
  let exit = null;
  {
    const ex = slots.find(s => s.slot === exitSlot);
    const westWall = (x, y) => isWall(x - 1, y) && isWall(x - 1, y - 1) && isWall(x - 1, y + 1) && !isWall(x + 1, y) &&
      wallKind[y * W + x - 1] === 0;
    const okSpot = (x, y) => !isWall(x, y) && !furn[y * W + x] && dist[y * W + x] >= 0 && !propNear(x + 0.5, y + 0.5, 1.2) && clearAround(x, y);
    const score = (x, y) => dist[y * W + x] + (westWall(x, y) ? 1000 : 0);
    let best = -1;
    // the template's own good spots first, then anywhere in it
    for (const pass of [stairSpots.get(exitSlot), null]) {
      const list = pass || [];
      if (!pass) for (let y = ex.y + 1; y < ex.y + TPL - 1; y++) for (let x = ex.x + 1; x < ex.x + TPL - 1; x++) list.push([x, y]);
      for (const [x, y] of list) if (okSpot(x, y) && score(x, y) > best) { best = score(x, y); exit = { x, y, wall: westWall(x, y) }; }
      if (exit && (pass == null || exit.wall)) break;
    }
  }

  // --- Light: the templates' braziers, and torches along their walls ---
  const lr = mulberry32(seed ^ 0x5f3759df);
  const lights = [];
  const farFromLights = (x, y, d) => lights.every(l => Math.hypot(l.x - x, l.y - y) >= d);
  for (const [x, y] of braziers) {
    if (exit && x === exit.x && y === exit.y) continue;
    lights.push({ kind: 'brazier', x: x + 0.5, y: y + 0.5, ...BRAZIER });
    props.push({ type: 'brazier', x: x + 0.5, y: y + 0.5, r: 0.24 });
  }
  // Torches hang on stone wall faces the camera can see: the south face of a wall to the
  // north of a floor square, or the east face of a wall to its west.
  const stone = (x, y) => isWall(x, y) && (x < 0 || y < 0 || x >= W || y >= H || wallKind[y * W + x] === 0);
  const torchSpot = (x, y) => {
    if (isWall(x, y)) return null;
    if (stone(x, y - 1) && stone(x - 1, y - 1) && stone(x + 1, y - 1))
      return { x: x + 0.5, y: y + 0.14, wx: x, wy: y - 1, face: 'S' };
    if (stone(x - 1, y) && stone(x - 1, y - 1) && stone(x - 1, y + 1))
      return { x: x + 0.14, y: y + 0.5, wx: x - 1, wy: y, face: 'E' };
    return null;
  };
  const addTorch = s => lights.push({ kind: 'torch', ...TORCH, ...s });
  if (exit && exit.wall) addTorch(torchSpot(exit.x, exit.y)); // so the way out stands out
  for (const s of slots) {
    const tpl = TEMPLATES.find(t => t.id === s.id);
    const spots = [];
    for (let y = s.y + 1; y < s.y + TPL - 1; y++)
      for (let x = s.x + 1; x < s.x + TPL - 1; x++) { const t = torchSpot(x, y); if (t) spots.push(t); }
    // each one where it's furthest from the lights already up (give or take), so they
    // spread out over the template instead of bunching
    for (let n = 0; n < tpl.torches && spots.length; n++) {
      let best = null, bs = -1;
      for (const t of spots) {
        let d = Infinity;
        for (const l of lights) { const e = Math.hypot(l.x - t.x, l.y - t.y); if (e < d) d = e; }
        const sc = Math.min(d, 12) + lr() * 1.5;
        if (sc > bs) { bs = sc; best = t; }
      }
      if (!best || !farFromLights(best.x, best.y, 2.4)) break;
      addTorch(best);
    }
  }

  // Squares guards won't walk into: furniture, things standing there, and the stairs
  const blocked = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (furn[i]) blocked[i] = 1;
  for (const p of props) blocked[Math.floor(p.y) * W + Math.floor(p.x)] = 1;
  if (exit) blocked[exit.y * W + exit.x] = 1;

  // --- Guards, at the templates' posts: more of them manned the deeper you go ---
  const er = mulberry32(seed ^ 0x2545f491);
  const enemies = [];
  for (const p of posts) {
    const chance = Math.min(0.95, p.guardP + 0.05 * (depth - 1));
    if (er() >= chance) continue;
    const i = p.y * W + p.x;
    if (blocked[i] || dist[i] < 8 || Math.hypot(p.x + 0.5 - start.x, p.y + 0.5 - start.y) < 9) continue;
    const [dx, dy] = ARROW[p.c];
    enemies.push({ x: p.x + 0.5, y: p.y + 0.5, facing: Math.atan2(dy, dx) + (er() - 0.5) * 0.3 });
  }

  return {
    W, H, grid, wallKind, furn, furnBoxes, rooms: slots, slots, props, lights, seed, depth, isWall, blocked,
    enemies, exit, start, doors, keys, layout: { GW, GH, route, startSlot, exitSlot },
  };
}
