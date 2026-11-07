'use strict';
// Rendering, input and the main loop.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let cw = 0, ch = 0, dpr = 1;
function resize() {
  dpr = window.devicePixelRatio || 1;
  cw = window.innerWidth; ch = window.innerHeight;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- settings
const S = {
  coneDeg: 90,     // full width of the view cone
  range: 9,        // how far the cone reaches (tiles)
  periph: 1.3,     // "close awareness" radius outside the cone (tiles)
  turnDeg: 720,    // max turn rate of the character's gaze (deg/s)
  speed: 5.0,      // walk speed (tiles/s)
  slideSpeed: 3.0, // speed while pressed against a wall (tiles/s)
  crawlSpeed: 1.0, // crawl speed (tiles/s)
  unstickT: 0.3,   // how long you pull away from a wall before you let go of it (s)
  peek: 0.4,       // how far the head leans out past a corner while pressed to a wall (tiles)
  wallH: 0.9,      // wall height (tiles)
  zoom: 1,
  cutMode: 'near', // which walls sink out of the way: 'off' | 'near' | 'sight'
  debug: false,
  revealAll: false, // show the whole map in outline, explored or not (for comparison)
};
const CUT_H = 0.18;   // height of a cut-away wall stub
const SOFT = 6 * Math.PI / 180;      // soft falloff at the cone's edge
const KEY_TURN = 200 * Math.PI / 180; // keyboard turn rate

const COL = {
  bg: '#07090d',
  grid: 'rgba(78, 96, 126, 0.20)',
  wallLine: '#55647f',
  wallTopOut: '#07090d', wallSOut: '#0c0f15', wallEOut: '#0a0c11',
  floor: [104, 93, 80], wallS: [138, 123, 104], wallE: [104, 93, 79], wallTop: [152, 138, 118],
  wood: [128, 88, 52], hoop: [58, 47, 38],
};

// ---------------------------------------------------------------- world state
let map, player, cam, eye, seed, cut, seenStamp, explored, stamp = 0;

// ---------------------------------------------------------------- exploration memory
// A floor square is explored once any part of it has been in view; a wall square once a
// sight ray has struck it; a barrel once it has been in view. Only explored things are
// drawn (in outline when not currently seen).
function updateExplored(vis) {
  const W = map.W, R = Math.ceil(S.range + 1);
  const pcx = Math.floor(player.x), pcy = Math.floor(player.y);
  for (let cy = Math.max(0, pcy - R); cy <= Math.min(map.H - 1, pcy + R); cy++)
    for (let cx = Math.max(0, pcx - R); cx <= Math.min(W - 1, pcx + R); cx++) {
      const idx = cy * W + cx;
      if (explored[idx] || map.isWall(cx, cy)) continue;
      if (vis.sees(cx + 0.5, cy + 0.5) || vis.sees(cx + 0.15, cy + 0.15) || vis.sees(cx + 0.85, cy + 0.15) ||
          vis.sees(cx + 0.15, cy + 0.85) || vis.sees(cx + 0.85, cy + 0.85)) explored[idx] = 1;
    }
  for (const idx of vis.litCells) explored[idx] = 1;
  for (const p of map.props)
    if (!p.seen && Math.abs(p.x - player.x) <= R && Math.abs(p.y - player.y) <= R &&
        (vis.sees(p.x, p.y) || vis.sees(p.x + 0.2, p.y + 0.2))) p.seen = true;
}
const isExplored = (cx, cy) => S.revealAll || explored[cy * map.W + cx] === 1;
// Unexplored walls are skipped, except fully buried ones next to explored walls: those are
// drawn as invisible filler so explored floor behind a thick wall stays correctly hidden.
function shouldDrawWall(cx, cy) {
  if (isExplored(cx, cy)) return true;
  if (!(map.isWall(cx - 1, cy) && map.isWall(cx + 1, cy) && map.isWall(cx, cy - 1) && map.isWall(cx, cy + 1))) return false;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < map.W && y < map.H && explored[y * map.W + x]) return true;
    }
  return false;
}
function newDungeon(s) {
  seed = s >>> 0;
  map = generateDungeon(seed);
  player = {
    x: map.start.x, y: map.start.y, r: 0.22, facing: -Math.PI * 0.75, target: -Math.PI * 0.75, vx: 0, vy: 0, walk: 0, moving: 0,
    hug: null,           // set while pressed against a wall (see "movement modes")
    crawl: false,        // crawling instead of walking
    bodyDir: -Math.PI * 0.75, // which way the body points (matters when crawling)
    peekX: 0, peekY: 0,  // where the head (and so the eyes) are, relative to the body
  };
  eye = { x: player.x, y: player.y };
  cam = { x: player.x, y: player.y };
  cut = new Float32Array(map.W * map.H);
  seenStamp = new Int32Array(map.W * map.H);
  explored = new Uint8Array(map.W * map.H);
  for (const p of map.props) p.seen = false;
  const el = document.getElementById('seed');
  if (el) el.textContent = seed;
}
newDungeon(1337);

// ---------------------------------------------------------------- projection
// Diagonal (2:1 isometric) projection. World x runs to the screen's lower-right,
// world y to the lower-left, z is up.
let TW, hw, hh, zs, camSX, camSY;
function setupView() {
  TW = 64 * S.zoom; hw = TW / 2; hh = TW / 4; zs = TW * 0.62;
  camSX = (cam.x - cam.y) * hw;
  camSY = (cam.x + cam.y) * hh - 0.4 * zs;
}
const PX = (x, y) => (x - y) * hw - camSX + cw / 2;
const PY = (x, y, z) => (x + y) * hh - z * zs - camSY + ch / 2;
function unproject(sx, sy) {
  const a = (sx - cw / 2 + camSX) / hw, b = (sy - ch / 2 + camSY) / hh;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}
// A direction on screen (e.g. a stick or WASD) -> world angle
function screenDirToAngle(sx, sy) {
  const a = sx / 2, b = sy; // ratios of hw:hh = 2:1
  return Math.atan2((b - a) / 2, (a + b) / 2);
}

// ---------------------------------------------------------------- input
const keys = new Set();
let lookMode = 'mouse';
const mouse = { x: 0, y: 0, has: false };
window.addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'r' && !e.repeat) newDungeon((Math.random() * 1e9) | 0);
  if (k === 'h' && !e.repeat) document.body.classList.toggle('hide-ui');
  if (k === 'x' && !e.repeat) toggleHug();
  if (k === 'c' && !e.repeat) toggleCrawl();
  if (k === 'v' && !e.repeat) cycleCutMode();
  if (k.startsWith('arrow') || k === ' ') e.preventDefault();
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.has = true; lookMode = 'mouse'; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  S.zoom = Math.max(0.5, Math.min(2.2, S.zoom * Math.exp(-e.deltaY * 0.0015)));
  syncSliders();
}, { passive: false });

// ---------------------------------------------------------------- physics
function resolveCollisions(p) {
  for (let it = 0; it < 2; it++) {
    for (let cy = Math.floor(p.y - p.r); cy <= Math.floor(p.y + p.r); cy++) {
      for (let cx = Math.floor(p.x - p.r); cx <= Math.floor(p.x + p.r); cx++) {
        if (!map.isWall(cx, cy)) continue;
        const nx = Math.max(cx, Math.min(cx + 1, p.x)), ny = Math.max(cy, Math.min(cy + 1, p.y));
        let dx = p.x - nx, dy = p.y - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 >= p.r * p.r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          p.x += dx / d * (p.r - d); p.y += dy / d * (p.r - d);
        } else { // centre inside the block: push out along the shallowest axis
          const l = p.x - cx, r = cx + 1 - p.x, t = p.y - cy, b = cy + 1 - p.y;
          const m = Math.min(l, r, t, b);
          if (m === l) p.x = cx - p.r; else if (m === r) p.x = cx + 1 + p.r;
          else if (m === t) p.y = cy - p.r; else p.y = cy + 1 + p.r;
        }
      }
    }
    for (const o of map.props) {
      const dx = p.x - o.x, dy = p.y - o.y, rr = p.r + o.r;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 > 1e-10) { const d = Math.sqrt(d2); p.x += dx / d * (rr - d); p.y += dy / d * (rr - d); }
    }
  }
}

// ---------------------------------------------------------------- movement modes
// Three ways to move: walking, crawling (C toggles) and pressed against a wall (X toggles).
// Pressed against a wall, the character slides along it (slower than walking), stops at its
// end instead of stepping past, and pushing on toward that end leans their head out around
// the corner. Moving straight away from the wall is resisted for a moment before they let go.
// Normals point from the wall out toward the character.
const NORMALS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function backingCell(nx, ny) { // the grid square just behind the character on side -n
  return [Math.floor(player.x - nx * (player.r + 0.03)), Math.floor(player.y - ny * (player.r + 0.03))];
}
function touchingWall(nx, ny) { const [bx, by] = backingCell(nx, ny); return map.isWall(bx, by); }
function overlapsProp(p) {
  for (const o of map.props) if (Math.hypot(p.x - o.x, p.y - o.y) < p.r + o.r - 1e-3) return true;
  return false;
}
// Press against the wall on side i of the grid square (bx,by) behind it.
function startHug(i, bx, by) {
  const [nx, ny] = NORMALS[i];
  const tx = -ny, ty = nx;
  const face = nx > 0 ? bx + 1 : nx < 0 ? bx : ny > 0 ? by + 1 : by; // the wall face's x (or y)
  player.hug = {
    nx, ny, tx, ty, face,
    off: Math.abs((nx ? player.x : player.y) - face), // distance from the wall; eases in to r
    v: 0, // speed along the wall
    pull: 0, turnT: 0,
  };
  player.crawl = false;
  player.vx = player.vy = 0;
  // Starting right at a wall's end? Stay behind the corner.
  for (const s of [1, -1])
    if (wallEndDist(player.hug, s, bx, by) < CORNER_INSET) stopAtWallEnd(player.hug, s, bx, by);
}
// The wall square right behind the character while pressed against a wall
function hugBack(h) {
  return h.nx ? [h.nx > 0 ? h.face - 1 : h.face, Math.floor(player.y)]
              : [Math.floor(player.x), h.ny > 0 ? h.face - 1 : h.face];
}
// X: press against the nearest wall bordering the character's square, or let go.
function toggleHug() {
  if (player.hug) { player.hug = null; return; }
  const cx = Math.floor(player.x), cy = Math.floor(player.y);
  let best = -1, bestD = Infinity;
  for (let i = 0; i < 4; i++) {
    const [nx, ny] = NORMALS[i];
    if (!map.isWall(cx - nx, cy - ny)) continue;
    const d = nx > 0 ? player.x - cx : nx < 0 ? cx + 1 - player.x : ny > 0 ? player.y - cy : cy + 1 - player.y;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0) startHug(best, cx - NORMALS[best][0], cy - NORMALS[best][1]);
}
// C: get down and crawl, or stand back up.
function toggleCrawl() {
  if (player.hug) { player.hug = null; player.crawl = true; return; }
  player.crawl = !player.crawl;
}
function pinToWall(h) {
  const off = h.off + 0.05 * smoothstep(h.pull / S.unstickT); // creeps out a little while pulling
  if (h.nx) player.x = h.face + h.nx * off; else player.y = h.face + h.ny * off;
}
// At a wall's end the body stops this far short of the corner, so it stays behind the wall.
const CORNER_INSET = 0.16;
// Distance from the body to the end of the wall in tangent direction s (+1/-1), when the
// wall ends at the edge of the square (bx,by) behind the body; Infinity otherwise.
function wallEndDist(h, s, bx, by) {
  if (map.isWall(bx + h.tx * s, by + h.ty * s)) return Infinity;
  const c = h.tx ? player.x : player.y, cell = h.tx ? bx : by;
  return (h.tx + h.ty) * s > 0 ? cell + 1 - c : c - cell;
}
function stopAtWallEnd(h, s, bx, by) {
  const cell = h.tx ? bx : by;
  const c = (h.tx + h.ty) * s > 0 ? cell + 1 - CORNER_INSET : cell + CORNER_INSET;
  if (h.tx) player.x = c; else player.y = c;
  h.v = 0;
}
function updateHug(dt, wx, wy, k) {
  const h = player.hug;
  const along = wx * h.tx + wy * h.ty, away = wx * h.nx + wy * h.ny;
  h.off = Math.max(player.r, h.off - dt * 3); // step over to the wall

  // Pulling away is resisted until it has lasted long enough. Only a fairly direct pull
  // counts: a diagonal (along-and-away) push keeps you sliding.
  if (away > 0.75) h.pull += dt; else h.pull = Math.max(0, h.pull - dt * 2);
  if (h.pull >= S.unstickT) {
    player.hug = null;
    player.vx = h.tx * h.v + wx * S.speed * 0.5; player.vy = h.ty * h.v + wy * S.speed * 0.5;
    return [0, 0];
  }

  // Slide along the wall. Screen-relative input meets walls diagonally, so a moderate
  // along-the-wall component already gives full slide speed.
  const s = Math.abs(along) > 0.15 ? Math.sign(along) : 0;
  let target = s * Math.min(1, Math.abs(along) / 0.65) * S.slideSpeed;
  let peek = [0, 0];
  const [bx, by] = hugBack(h);
  if (s && wallEndDist(h, s, bx, by) <= CORNER_INSET + 0.01) {
    // At a corner: the body stays put and the head leans out past it (by S.peek), keeping
    // close to the wall's line, if there's floor to lean into
    target = 0; h.v = 0;
    if (!map.isWall(bx + h.tx * s + h.nx, by + h.ty * s + h.ny)) {
      const a = CORNER_INSET + S.peek;
      peek = [h.tx * s * a - h.nx * 0.13, h.ty * s * a - h.ny * 0.13];
    }
  }
  h.v += (target - h.v) * k;

  const dist = Math.abs(h.v) * dt, steps = Math.max(1, Math.ceil(dist / 0.05));
  for (let i = 0; i < steps; i++) {
    const [pbx, pby] = hugBack(h), ox = player.x, oy = player.y;
    const step = h.v * dt / steps, sd = Math.sign(step);
    player.x += h.tx * step; player.y += h.ty * step;
    pinToWall(h);
    if (overlapsProp(player)) { player.x = ox; player.y = oy; h.v = 0; break; }
    resolveCollisions(player); pinToWall(h);
    // Reached the end of the wall? Stop just short of the corner.
    const [cbx, cby] = hugBack(h);
    if (!map.isWall(cbx, cby)) { stopAtWallEnd(h, sd, pbx, pby); break; }
    if (wallEndDist(h, sd, cbx, cby) < CORNER_INSET) { stopAtWallEnd(h, sd, cbx, cby); break; }
  }

  // Sliding into a wall that runs across this one (an inside corner): keep pushing and you
  // turn to press against that one instead.
  if (s) {
    const n2 = NORMALS.findIndex(([nx, ny]) => nx === -h.tx * s && ny === -h.ty * s);
    if (touchingWall(-h.tx * s, -h.ty * s)) {
      h.turnT += dt;
      if (h.turnT >= 0.25) { const [nbx, nby] = backingCell(-h.tx * s, -h.ty * s); startHug(n2, nbx, nby); return [0, 0]; }
    } else h.turnT = 0;
  } else h.turnT = 0;
  pinToWall(player.hug);
  return peek;
}

function update(dt) {
  // Movement input, in screen space (W = up the screen)
  let mx = 0, my = 0;
  if (keys.has('w')) my -= 1;
  if (keys.has('s')) my += 1;
  if (keys.has('a')) mx -= 1;
  if (keys.has('d')) mx += 1;

  let padLook = null;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    const ax = gp.axes;
    if (Math.hypot(ax[0], ax[1]) > 0.2) { mx += ax[0]; my += ax[1]; }
    if (ax.length >= 4 && Math.hypot(ax[2], ax[3]) > 0.35) padLook = [ax[2], ax[3]];
    break;
  }
  const ml = Math.hypot(mx, my);
  if (ml > 1) { mx /= ml; my /= ml; }
  // screen right = world (1,-1)/√2, screen down = world (1,1)/√2
  const wx = (mx + my) * Math.SQRT1_2, wy = (my - mx) * Math.SQRT1_2;

  // Gaze input
  const turn = ((keys.has('arrowright') || keys.has('e')) ? 1 : 0) - ((keys.has('arrowleft') || keys.has('q')) ? 1 : 0);
  if (turn) {
    if (lookMode !== 'keys') { lookMode = 'keys'; player.target = player.facing; }
    player.target = wrapAngle(player.target + turn * KEY_TURN * dt);
  }
  if (padLook) { lookMode = 'pad'; player.target = screenDirToAngle(padLook[0], padLook[1]); }
  if (lookMode === 'mouse' && mouse.has) {
    const g = unproject(mouse.x, mouse.y);
    const dx = g.x - eye.x, dy = g.y - eye.y;
    if (dx * dx + dy * dy > 0.06) player.target = Math.atan2(dy, dx);
  }
  const diff = wrapAngle(player.target - player.facing);
  const maxStep = S.turnDeg * Math.PI / 180 * dt;
  player.facing = wrapAngle(player.facing + Math.max(-maxStep, Math.min(maxStep, diff)));

  // Velocity with a little acceleration, then collide
  const k = Math.min(1, dt * 14);
  let peekTX = 0, peekTY = 0;
  if (!player.hug) {
    const speed = player.crawl ? S.crawlSpeed : S.speed;
    player.vx += (wx * speed - player.vx) * k;
    player.vy += (wy * speed - player.vy) * k;
    const dist = Math.hypot(player.vx, player.vy) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.08));
    for (let i = 0; i < steps; i++) {
      player.x += player.vx * dt / steps; resolveCollisions(player);
      player.y += player.vy * dt / steps; resolveCollisions(player);
    }
  } else {
    [peekTX, peekTY] = updateHug(dt, wx, wy, k);
  }
  const sp = player.hug ? Math.abs(player.hug.v) : Math.hypot(player.vx, player.vy);
  const modeSpeed = player.hug ? S.slideSpeed : player.crawl ? S.crawlSpeed : S.speed;
  player.moving = Math.min(1, sp / Math.max(0.3, modeSpeed));
  // stride cycle: about the same number of steps per tile whatever the mode
  player.walk += sp * dt * (player.crawl ? 9 : 5.5);
  // A crawling body turns (smoothly) to point where it's going
  if (sp > 0.1) {
    const want = Math.atan2(player.vy, player.vx);
    const d = wrapAngle(want - player.bodyDir), m = 7 * dt;
    player.bodyDir = wrapAngle(player.bodyDir + Math.max(-m, Math.min(m, d)));
  }

  // The head leans out (smoothly); the eyes go with it, but never into a wall
  const pk = Math.min(1, dt * 8);
  player.peekX += (peekTX - player.peekX) * pk;
  player.peekY += (peekTY - player.peekY) * pk;
  const pl = Math.hypot(player.peekX, player.peekY);
  eye.x = player.x; eye.y = player.y;
  if (pl > 1e-3) {
    const hit = castRay(map, player.x, player.y, player.peekX / pl, player.peekY / pl, pl);
    const reach = hit.cell < 0 ? pl : Math.max(0, Math.hypot(hit.x - player.x, hit.y - player.y) - 0.04);
    eye.x += player.peekX / pl * reach; eye.y += player.peekY / pl * reach;
  }

  // Camera follows smoothly
  const ck = Math.min(1, dt * 6);
  cam.x += (player.x - cam.x) * ck;
  cam.y += (player.y - cam.y) * ck;
}

// ---------------------------------------------------------------- lighting helpers
const rgb = (c, f) => `rgb(${(c[0] * f) | 0},${(c[1] * f) | 0},${(c[2] * f) | 0})`;
function lightAt(x, y) {
  const dx = x - eye.x, dy = y - eye.y;
  const d = Math.hypot(dx, dy);
  const fd = 1 - 0.8 * Math.pow(Math.min(1, d / S.range), 1.3);
  const half = S.coneDeg * Math.PI / 360;
  const rel = Math.abs(wrapAngle(Math.atan2(dy, dx) - player.facing));
  const fa = 1 - 0.4 * smoothstep((rel - half) / SOFT);
  return Math.max(0.12, fd * (d < 0.5 ? 1 : fa));
}

function quad(ax, ay, bx, by, cx, cy, dx, dy) {
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(dx, dy); ctx.closePath();
}
function diamond(x, y) { // floor tile at cell (x,y), path only
  ctx.moveTo(PX(x, y), PY(x, y, 0)); ctx.lineTo(PX(x + 1, y), PY(x + 1, y, 0));
  ctx.lineTo(PX(x + 1, y + 1), PY(x + 1, y + 1, 0)); ctx.lineTo(PX(x, y + 1), PY(x, y + 1, 0)); ctx.closePath();
}
function onScreen(cx, cy) {
  const sx = PX(cx + 0.5, cy + 0.5), sy = PY(cx + 0.5, cy + 0.5, 0);
  return sx > -TW && sx < cw + TW && sy > -TW && sy < ch + TW + zs * 2;
}

// ---------------------------------------------------------------- floor
function drawFloorDetails(cx, cy, h) {
  const r = mulberry32(h);
  const G = (u, v) => [PX(cx + u, cy + v), PY(cx + u, cy + v, 0)];
  const kind = h % 23;
  if (kind < 3) { // crack
    ctx.beginPath();
    let u = 0.15 + r() * 0.3, v = 0.15 + r() * 0.3;
    let p = G(u, v); ctx.moveTo(p[0], p[1]);
    for (let i = 0; i < 3; i++) { u += 0.12 + r() * 0.15; v += (r() - 0.3) * 0.25; p = G(Math.min(0.92, u), Math.max(0.08, Math.min(0.92, v))); ctx.lineTo(p[0], p[1]); }
    ctx.strokeStyle = 'rgba(28,22,18,0.55)'; ctx.lineWidth = 1; ctx.stroke();
  } else if (kind < 6) { // pebbles
    ctx.fillStyle = 'rgba(40,34,28,0.5)';
    for (let i = 0; i < 3; i++) {
      const p = G(0.15 + r() * 0.7, 0.15 + r() * 0.7);
      ctx.beginPath(); ctx.ellipse(p[0], p[1], TW * 0.025 + r() * TW * 0.02, TW * 0.014 + r() * TW * 0.008, 0, 0, Math.PI * 2); ctx.fill();
    }
  } else if (kind < 8) { // moss
    const p = G(0.3 + r() * 0.4, 0.3 + r() * 0.4);
    ctx.fillStyle = 'rgba(78,98,52,0.35)';
    ctx.beginPath(); ctx.ellipse(p[0], p[1], TW * 0.16, TW * 0.07, 0, 0, Math.PI * 2); ctx.fill();
  } else if (kind < 12) { // split slab seam
    const a = G(0.5, 0), b = G(0.5, 1);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = 'rgba(20,16,12,0.4)'; ctx.lineWidth = 1; ctx.stroke();
  } else if (kind === 12 && (h >> 8) % 3 === 0) { // drain grate
    ctx.beginPath(); const c = [G(0.3, 0.3), G(0.7, 0.3), G(0.7, 0.7), G(0.3, 0.7)];
    ctx.moveTo(c[0][0], c[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(c[i][0], c[i][1]); ctx.closePath();
    ctx.fillStyle = 'rgba(14,12,10,0.8)'; ctx.fill();
    ctx.beginPath();
    for (let i = 1; i < 4; i++) { const a = G(0.3 + i * 0.1, 0.3), b = G(0.3 + i * 0.1, 0.7); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.strokeStyle = 'rgba(120,110,95,0.6)'; ctx.stroke();
  }
}

function coneWedge(halfA) { // ground-plane wedge covering everything outside ±halfA of facing
  const R = S.range + 3, px = eye.x, py = eye.y, f = player.facing;
  ctx.beginPath(); ctx.moveTo(PX(px, py), PY(px, py, 0));
  const a0 = f + halfA, a1 = f + 2 * Math.PI - halfA;
  for (let a = a0; a <= a1 + 1e-6; a += (a1 - a0) / 48) {
    const x = px + Math.cos(a) * R, y = py + Math.sin(a) * R;
    ctx.lineTo(PX(x, y), PY(x, y, 0));
  }
  ctx.closePath();
}

function drawFloor(vis) {
  // Outline layer: faint grid everywhere
  ctx.beginPath();
  for (let cy = 0; cy < map.H; cy++)
    for (let cx = 0; cx < map.W; cx++)
      if (!map.isWall(cx, cy) && isExplored(cx, cy) && onScreen(cx, cy)) diamond(cx, cy);
  ctx.strokeStyle = COL.grid; ctx.lineWidth = 1; ctx.stroke();

  // Lit layer, clipped to what the character can see
  ctx.save();
  ctx.beginPath();
  vis.pts.forEach((p, i) => { const x = PX(p.x, p.y), y = PY(p.x, p.y, 0); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.closePath();
  ctx.clip();

  const R = Math.ceil(S.range + 1);
  const x0 = Math.max(0, Math.floor(player.x - R)), x1 = Math.min(map.W - 1, Math.floor(player.x + R));
  const y0 = Math.max(0, Math.floor(player.y - R)), y1 = Math.min(map.H - 1, Math.floor(player.y + R));
  const seams = new Path2D();
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (map.isWall(cx, cy) || !onScreen(cx, cy)) continue;
      const h = hash2(cx, cy, seed);
      ctx.beginPath(); diamond(cx, cy);
      ctx.fillStyle = rgb(COL.floor, 0.86 + ((h >>> 20) & 255) / 255 * 0.22);
      ctx.fill();
      drawFloorDetails(cx, cy, h);
      seams.moveTo(PX(cx, cy), PY(cx, cy, 0)); seams.lineTo(PX(cx + 1, cy), PY(cx + 1, cy, 0));
      seams.moveTo(PX(cx, cy), PY(cx, cy, 0)); seams.lineTo(PX(cx, cy + 1), PY(cx, cy + 1, 0));
    }
  }
  ctx.strokeStyle = 'rgba(24,19,15,0.55)'; ctx.lineWidth = 1; ctx.stroke(seams);

  // Distance falloff (an ellipse on screen = a circle on the ground)
  const sx = PX(eye.x, eye.y), sy = PY(eye.x, eye.y, 0);
  const rad = S.range * hw * Math.SQRT2;
  ctx.save();
  ctx.translate(sx, sy); ctx.scale(1, 0.5);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
  g.addColorStop(0, 'rgba(4,5,8,0)');
  g.addColorStop(0.25, 'rgba(4,5,8,0.13)');
  g.addColorStop(0.5, 'rgba(4,5,8,0.33)');
  g.addColorStop(0.75, 'rgba(4,5,8,0.55)');
  g.addColorStop(1, 'rgba(4,5,8,0.8)');
  ctx.fillStyle = g; ctx.fillRect(-rad * 1.3, -rad * 1.3, rad * 2.6, rad * 2.6);
  ctx.restore();
  // Close awareness behind/aside is dimmer than direct sight
  const half = S.coneDeg * Math.PI / 360;
  ctx.fillStyle = 'rgba(4,5,8,0.16)';
  for (let i = 0; i < 3; i++) { coneWedge(half + SOFT * i / 2); ctx.fill(); }
  ctx.restore();
}

// ---------------------------------------------------------------- walls
// Cutaway: in a diagonal view, a wall hides the floor just "behind" it on screen.
// A wall sinks to a stub when it stands between the camera and a "marked" floor square:
//   'off'   – nothing is marked; walls always stand at full height.
//   'near'  – floor within NEAR_R of the character (changes only as you move, not as you look).
//   'sight' – floor the character can currently see (changes as you look around).
const COVER = [[-1, 0], [0, -1], [-1, -1], [-2, -1], [-1, -2], [-2, -2]];
const NEAR_R = 2.6;
function updateCutaway(vis, dt) {
  stamp++;
  const W = map.W, R = Math.ceil(S.range + 1);
  const pcx = Math.floor(player.x), pcy = Math.floor(player.y);
  if (S.cutMode === 'near') {
    const r = Math.ceil(NEAR_R);
    for (let cy = pcy - r; cy <= pcy + r; cy++)
      for (let cx = pcx - r; cx <= pcx + r; cx++)
        if (!map.isWall(cx, cy) && Math.hypot(cx + 0.5 - player.x, cy + 0.5 - player.y) <= NEAR_R)
          seenStamp[cy * W + cx] = stamp;
  } else if (S.cutMode === 'sight') {
    seenStamp[pcy * W + pcx] = stamp;
    const x0 = Math.max(0, pcx - R), x1 = Math.min(W - 1, pcx + R);
    const y0 = Math.max(0, pcy - R), y1 = Math.min(map.H - 1, pcy + R);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        if (map.isWall(cx, cy)) continue;
        if (vis.sees(cx + 0.5, cy + 0.5) || vis.sees(cx + 0.2, cy + 0.2) || vis.sees(cx + 0.8, cy + 0.2) ||
            vis.sees(cx + 0.2, cy + 0.8) || vis.sees(cx + 0.8, cy + 0.8)) seenStamp[cy * W + cx] = stamp;
      }
  }
  const k = Math.min(1, dt * 9);
  for (let cy = 0; cy < map.H; cy++)
    for (let cx = 0; cx < W; cx++) {
      const idx = cy * W + cx;
      if (!map.isWall(cx, cy)) continue;
      let target = 0;
      if (Math.abs(cx - pcx) <= R + 3 && Math.abs(cy - pcy) <= R + 3) {
        for (const [dx, dy] of COVER) {
          const x = cx + dx, y = cy + dy;
          if (!map.isWall(x, y) && seenStamp[y * W + x] === stamp) { target = 1; break; }
        }
      }
      cut[idx] += (target - cut[idx]) * k;
    }
}
function wallHeight(cx, cy) {
  if (!map.isWall(cx, cy)) return 0;
  if (cx < 0 || cy < 0 || cx >= map.W || cy >= map.H) return S.wallH;
  const lo = Math.min(S.wallH, CUT_H);
  return S.wallH - (S.wallH - lo) * cut[cy * map.W + cx];
}

function litFace(x0, y0, x1, y1, base, hz, bricksAlongX) {
  const ax = PX(x0, y0), ay = PY(x0, y0, 0), bx = PX(x1, y1), by = PY(x1, y1, 0);
  const g = ctx.createLinearGradient(ax, ay, bx, by);
  g.addColorStop(0, rgb(base, lightAt(x0, y0)));
  g.addColorStop(1, rgb(base, lightAt(x1, y1)));
  quad(ax, ay, bx, by, bx, by - hz, ax, ay - hz);
  ctx.fillStyle = g; ctx.fill();

  // Masonry
  const rows = Math.max(1, Math.round(hz / zs * 4));
  ctx.beginPath();
  for (let k = 1; k < rows; k++) {
    const dz = hz * k / rows;
    ctx.moveTo(ax, ay - dz); ctx.lineTo(bx, by - dz);
  }
  const t0 = bricksAlongX ? x0 : y0, t1 = bricksAlongX ? x1 : y1;
  for (let k = 0; k < rows; k++) {
    const off = (k % 2) * 0.25;
    for (let t = Math.ceil((t0 - off) * 2) / 2 + off; t < t1; t += 0.5) {
      if (t <= t0) continue;
      const x = bricksAlongX ? t : x0, y = bricksAlongX ? y0 : t;
      const sx = PX(x, y), sy = PY(x, y, 0);
      ctx.moveTo(sx, sy - hz * k / rows); ctx.lineTo(sx, sy - hz * (k + 1) / rows);
    }
  }
  ctx.strokeStyle = 'rgba(30,24,18,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ax, ay - hz); ctx.lineTo(bx, by - hz);
  ctx.strokeStyle = 'rgba(255,240,215,0.25)'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
  ctx.strokeStyle = 'rgba(15,12,9,0.6)'; ctx.stroke();
}

let playerSamples = null, playerHidden = false;
function pointInPoly(p, x, y) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function drawWall(cx, cy, vis) {
  const idx = cy * map.W + cx;
  const h = wallHeight(cx, cy), hz = h * zs, e = 0.01;
  // Neighbour heights (0 = floor). A face is drawn wherever the neighbour is lower.
  const hN = wallHeight(cx, cy - 1), hE = wallHeight(cx + 1, cy), hS = wallHeight(cx, cy + 1), hW = wallHeight(cx - 1, cy);
  const Ax = PX(cx, cy), Ay = PY(cx, cy, 0), Bx = PX(cx + 1, cy), By = PY(cx + 1, cy, 0);
  const Cx = PX(cx + 1, cy + 1), Cy = PY(cx + 1, cy + 1, 0), Dx = PX(cx, cy + 1), Dy = PY(cx, cy + 1, 0);
  const sFace = hS < h - e, eFace = hE < h - e;
  const zS = hS * zs, zE = hE * zs;

  // Outline version (always drawn; hides whatever is behind it)
  if (sFace) { quad(Dx, Dy - zS, Cx, Cy - zS, Cx, Cy - hz, Dx, Dy - hz); ctx.fillStyle = COL.wallSOut; ctx.fill(); }
  if (eFace) { quad(Bx, By - zE, Cx, Cy - zE, Cx, Cy - hz, Bx, By - hz); ctx.fillStyle = COL.wallEOut; ctx.fill(); }
  quad(Ax, Ay - hz, Bx, By - hz, Cx, Cy - hz, Dx, Dy - hz); ctx.fillStyle = COL.wallTopOut; ctx.fill();
  const edges = () => {
    ctx.beginPath();
    if (hN < h - e) { ctx.moveTo(Ax, Ay - hz); ctx.lineTo(Bx, By - hz); }
    if (eFace) { ctx.moveTo(Bx, By - hz); ctx.lineTo(Cx, Cy - hz); }
    if (sFace) { ctx.moveTo(Cx, Cy - hz); ctx.lineTo(Dx, Dy - hz); }
    if (hW < h - e) { ctx.moveTo(Dx, Dy - hz); ctx.lineTo(Ax, Ay - hz); }
  };
  edges();
  if (eFace) { ctx.moveTo(Bx, By - zE); ctx.lineTo(Cx, Cy - zE); }
  if (sFace) { ctx.moveTo(Cx, Cy - zS); ctx.lineTo(Dx, Dy - zS); }
  if (sFace && eFace) { ctx.moveTo(Cx, Cy - Math.min(zS, zE)); ctx.lineTo(Cx, Cy - hz); }
  if (sFace && hW < h - e) { ctx.moveTo(Dx, Dy - zS); ctx.lineTo(Dx, Dy - hz); }
  if (eFace && hN < h - e) { ctx.moveTo(Bx, By - zE); ctx.lineTo(Bx, By - hz); }
  ctx.strokeStyle = COL.wallLine; ctx.lineWidth = 1; ctx.stroke();

  // Lit version, only for the stretches of face the character actually sees
  const ivS = hS === 0 && vis.faces.get(idx * 4 + FACE_S);
  if (ivS) for (const [t0, t1] of ivS) litFace(cx + t0, cy + 1, cx + t1, cy + 1, COL.wallS, hz, true);
  const ivE = hE === 0 && vis.faces.get(idx * 4 + FACE_E);
  if (ivE) for (const [t0, t1] of ivE) litFace(cx + 1, cy + t0, cx + 1, cy + t1, COL.wallE, hz, false);
  // Does this wall (drawn after the character, so in front) cover them on screen?
  if (playerSamples && !playerHidden && h > 0.3) {
    const poly = [Ax, Ay - hz, Bx, By - hz, Bx, By, Cx, Cy, Dx, Dy, Dx, Dy - hz];
    for (const [x, y] of playerSamples) if (pointInPoly(poly, x, y)) { playerHidden = true; break; }
  }
  if (vis.litCells.has(idx)) {
    const f = lightAt(cx + 0.5, cy + 0.5);
    quad(Ax, Ay - hz, Bx, By - hz, Cx, Cy - hz, Dx, Dy - hz);
    ctx.fillStyle = rgb(COL.wallTop, f); ctx.fill();
    edges();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = rgb([255, 240, 215], Math.min(1, f * 0.95)); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- props
function drawBarrel(b, vis) {
  const lit = vis.contains(b.x, b.y) || vis.contains(b.x + 0.2, b.y + 0.2);
  const cx = PX(b.x, b.y), by = PY(b.x, b.y, 0), ty = PY(b.x, b.y, 0.55);
  const rx = b.r * hw * Math.SQRT2, ry = b.r * hh * Math.SQRT2;
  const body = () => {
    ctx.beginPath(); ctx.moveTo(cx - rx, ty); ctx.lineTo(cx - rx, by);
    ctx.ellipse(cx, by, rx, ry, 0, Math.PI, 0, true); ctx.lineTo(cx + rx, ty);
    ctx.ellipse(cx, ty, rx, ry, 0, 0, Math.PI, false); ctx.closePath();
  };
  if (!lit) {
    body(); ctx.fillStyle = COL.wallSOut; ctx.fill(); ctx.strokeStyle = COL.wallLine; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, ty, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = COL.bg; ctx.fill(); ctx.stroke();
    return;
  }
  const f = lightAt(b.x, b.y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(cx + rx * 0.15, by + ry * 0.2, rx * 1.15, ry * 1.15, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
  g.addColorStop(0, rgb(COL.wood, f * 0.65)); g.addColorStop(0.4, rgb(COL.wood, f * 1.05)); g.addColorStop(1, rgb(COL.wood, f * 0.55));
  body(); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = rgb(COL.hoop, f * 1.2); ctx.lineWidth = Math.max(1, TW / 40);
  for (const z of [0.12, 0.43]) {
    const y = PY(b.x, b.y, z);
    ctx.beginPath(); ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI, false); ctx.stroke();
  }
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(cx, ty, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = rgb([150, 108, 68], f); ctx.fill(); ctx.strokeStyle = rgb(COL.hoop, f * 1.2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, ty, rx * 0.6, ry * 0.6, 0, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(60,40,24,0.35)'; ctx.stroke();
}

// ---------------------------------------------------------------- the character
// One hooded figure in three poses: upright when walking; flat against the wall with arms
// spread when pressed to one; stretched out low on the ground when crawling.
const CLOAK = ['#1f4843', '#3f8a7c', '#1a3d39'], CLOAK_LINE = '#0f2522';

function drawHead(hx, hy, r, ux, uy, k) { // hood + face (face only when turned toward the camera)
  ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#2b605a'; ctx.fill();
  const q = r / 7.5, vf = smoothstep((uy + 0.2) / 0.5);
  if (vf > 0) {
    const fcx = hx + ux * 3.0 * k * q, fcy = hy + (1.3 + uy * 1.2) * k * q;
    const fw = 4.6 * k * q * (0.6 + 0.4 * Math.max(0, uy));
    ctx.globalAlpha = vf;
    ctx.beginPath(); ctx.ellipse(fcx, fcy, fw, 4.3 * k * q, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#d6b08a'; ctx.fill();
    ctx.fillStyle = '#1b1410';
    const es = 1.9 * k * q * (0.35 + 0.65 * Math.max(0, uy));
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.arc(fcx + ux * 1.4 * k * q + s * es, fcy - 0.6 * k * q, 0.95 * k * q, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else { // back of the hood: a little seam
    ctx.beginPath(); ctx.moveTo(hx, hy - r * 0.8); ctx.quadraticCurveTo(hx - ux * 2 * k * q, hy, hx, hy + r * 0.8);
    ctx.strokeStyle = 'rgba(15,37,34,0.7)'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2);
  ctx.strokeStyle = CLOAK_LINE; ctx.lineWidth = 1.2; ctx.stroke(); ctx.lineWidth = 1;
}
function paintCloak(path, x0, y0, x1, y1, hl) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, CLOAK[0]); g.addColorStop(Math.max(0.05, Math.min(0.95, hl)), CLOAK[1]); g.addColorStop(1, CLOAK[2]);
  ctx.fillStyle = g; ctx.fill(path);
  ctx.strokeStyle = CLOAK_LINE; ctx.lineWidth = 1.2; ctx.stroke(path); ctx.lineWidth = 1;
}

// Upright, walking
function walkFigure(c) {
  const { sx, sy, k, ux, uy, m, psx, psy } = c;
  const bob = Math.abs(Math.sin(player.walk)) * 1.6 * k * m;
  const head = [sx + ux * 1.2 * k + psx * 0.9, sy - 37 * k - bob + psy * 0.9, 7.5 * k];
  const body = new Path2D();
  const lean = ux * 1.5 * k + psx * 0.5, top = sy - bob + psy * 0.5;
  body.moveTo(sx - 9.5 * k, sy - 4 * k);
  body.bezierCurveTo(sx - 10 * k, sy - 16 * k, sx - 8 * k + lean, top - 26 * k, sx - 6 * k + lean, top - 30 * k);
  body.lineTo(sx + 6 * k + lean, top - 30 * k);
  body.bezierCurveTo(sx + 8 * k + lean, top - 26 * k, sx + 10 * k, sy - 16 * k, sx + 9.5 * k, sy - 4 * k);
  body.quadraticCurveTo(sx, sy + 1.5 * k, sx - 9.5 * k, sy - 4 * k);
  body.closePath();
  return {
    body, head,
    samples: [[sx, sy - 3 * k], [sx - 6 * k, sy - 16 * k], [sx + 6 * k, sy - 16 * k], [sx, sy - 26 * k], [head[0], head[1]]],
    shadow() { ctx.beginPath(); ctx.ellipse(sx, sy, 12 * k, 6 * k, 0, 0, Math.PI * 2); ctx.fill(); },
    paint() {
      const swing = Math.sin(player.walk) * 5 * k * m; // long strides
      ctx.fillStyle = '#231d18';
      for (const side of [-1, 1]) {
        const off = swing * side;
        ctx.beginPath(); ctx.ellipse(sx + side * 4 * k + ux * off, sy - 1 * k + uy * off * 0.5, 3.4 * k, 2.1 * k, 0, 0, Math.PI * 2); ctx.fill();
      }
      paintCloak(body, sx - 10 * k, 0, sx + 10 * k, 0, 0.5 + ux * 0.3);
      ctx.beginPath();
      ctx.moveTo(sx - 9.6 * k, sy - 15 * k - bob * 0.5);
      ctx.quadraticCurveTo(sx, sy - 12 * k - bob * 0.5, sx + 9.6 * k, sy - 15 * k - bob * 0.5);
      ctx.strokeStyle = '#4a3624'; ctx.lineWidth = 2 * k; ctx.stroke(); ctx.lineWidth = 1;
      drawHead(head[0], head[1], head[2], ux, uy, k);
    },
  };
}

// Back flat against the wall, arms spread along it, side-stepping
function hugFigure(c) {
  const { sx, sy, k, ux, uy, m, psx, psy } = c, h = player.hug;
  const [ax, ay] = W2S(h.tx, h.ty), al = Math.hypot(ax, ay), tux = ax / al, tuy = ay / al;
  const [bx, by] = W2S(h.nx, h.ny), bl = Math.hypot(bx, by), nux = bx / bl, nuy = by / bl;
  // P(a, z): a along the wall (in k units), z up; upper body follows the peek lean
  const P = (a, z) => {
    const f = smoothstep((z - 10) / 22);
    return [sx + tux * a * k - nux * 1.5 * k + psx * 0.55 * f, sy + tuy * a * k - nuy * 1.5 * k - z * k + psy * 0.55 * f];
  };
  const step = Math.sin(player.walk) * 2.5 * m;
  const hp = P(0, 36), head = [hp[0] + psx * 0.35, hp[1] + psy * 0.35, 7.5 * k];
  const body = new Path2D();
  const pt = (f, a, z) => { const [x, y] = P(a, z); body[f](x, y); };
  const qt = (a1, z1, a2, z2) => { const [x1, y1] = P(a1, z1), [x2, y2] = P(a2, z2); body.quadraticCurveTo(x1, y1, x2, y2); };
  pt('moveTo', -8, 3); qt(-10.5, 16, -8, 29); pt('lineTo', 8, 29); qt(10.5, 16, 8, 3); qt(0, 0.5, -8, 3);
  body.closePath();
  const hand = s => P(s * 16, 23);
  return {
    body, head,
    samples: [P(0, 3), P(-6, 16), P(6, 16), P(0, 26), hand(-1), hand(1), [head[0], head[1]]],
    shadow() {
      ctx.beginPath(); ctx.ellipse(sx - nux * 2 * k, sy - nuy * 2 * k, 13 * k, 5.5 * k, Math.atan2(tuy, tux) * 0.35, 0, Math.PI * 2); ctx.fill();
    },
    paint() {
      ctx.fillStyle = '#231d18';
      for (const s of [-1, 1]) { const [x, y] = P(s * 5.5 + step * s, 0.5); ctx.beginPath(); ctx.ellipse(x, y, 3.4 * k, 2.1 * k, 0, 0, Math.PI * 2); ctx.fill(); }
      // arms spread flat along the wall
      for (const s of [-1, 1]) {
        const [x0, y0] = P(s * 6.5, 26), [x1, y1] = hand(s);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        ctx.strokeStyle = CLOAK_LINE; ctx.lineWidth = 5.2 * k; ctx.stroke();
        ctx.strokeStyle = CLOAK[1]; ctx.lineWidth = 3.2 * k; ctx.stroke();
        ctx.beginPath(); ctx.arc(x1, y1, 2.1 * k, 0, Math.PI * 2); ctx.fillStyle = '#c9a17c'; ctx.fill();
      }
      ctx.lineWidth = 1;
      const [g0x, g0y] = P(-10, 15), [g1x, g1y] = P(10, 15);
      paintCloak(body, g0x, g0y, g1x, g1y, 0.5 + (ux * tux + uy * tuy) * 0.3);
      const [b0x, b0y] = P(-9.8, 14), [bmx, bmy] = P(0, 12), [b1x, b1y] = P(9.8, 14);
      ctx.beginPath(); ctx.moveTo(b0x, b0y); ctx.quadraticCurveTo(bmx, bmy, b1x, b1y);
      ctx.strokeStyle = '#4a3624'; ctx.lineWidth = 2 * k; ctx.stroke(); ctx.lineWidth = 1;
      drawHead(head[0], head[1], head[2], ux, uy, k);
    },
  };
}

// Low on the ground, stretched out along the way the body points, on hands and knees
function crawlFigure(c) {
  const { sx, sy, k, ux, uy, m } = c;
  const dx = Math.cos(player.bodyDir), dy = Math.sin(player.bodyDir);
  const [fdx, fdy] = W2S(dx, dy), [pdx, pdy] = W2S(-dy, dx);
  const G = (a, b, z) => [sx + fdx * a + pdx * b, sy + fdy * a + pdy * b - z * zs];
  const outline = (z, sc) => {
    const p = new Path2D();
    for (let i = 0; i <= 24; i++) {
      const t = i / 24 * Math.PI * 2;
      const [x, y] = G((0.31 * Math.cos(t) - 0.05) * sc, 0.16 * Math.sin(t) * sc, z);
      i ? p.lineTo(x, y) : p.moveTo(x, y);
    }
    p.closePath(); return p;
  };
  const body = outline(0.15, 1), rim = outline(0.03, 0.96);
  const hp = G(0.33, 0, 0.14), head = [hp[0], hp[1], 5.6 * k];
  const cyc = Math.sin(player.walk) * 0.07 * m;
  const limbs = [[0.22 + cyc, 0.18], [0.22 - cyc, -0.18], [-0.28 - cyc, 0.16], [-0.28 + cyc, -0.16]];
  const headInFront = fdy > 0; // head nearer the camera than the body: draw it last
  return {
    body, head,
    samples: [G(0, 0, 0.1), G(0.18, 0, 0.1), G(-0.2, 0, 0.1), [head[0], head[1]]],
    shadow() { ctx.fill(outline(0, 1.15)); },
    paint() {
      ctx.fillStyle = '#231d18';
      for (const [a, b] of limbs) { const [x, y] = G(a, b, 0.01); ctx.beginPath(); ctx.ellipse(x, y, 3 * k, 1.9 * k, 0, 0, Math.PI * 2); ctx.fill(); }
      if (!headInFront) drawHead(head[0], head[1], head[2], ux, uy, k);
      ctx.fillStyle = CLOAK[2]; ctx.fill(rim); ctx.strokeStyle = CLOAK_LINE; ctx.lineWidth = 1.2; ctx.stroke(rim);
      const [g0x, g0y] = G(0, -0.16, 0.15), [g1x, g1y] = G(0, 0.16, 0.15);
      paintCloak(body, g0x, g0y, g1x, g1y, 0.5);
      const [b0x, b0y] = G(-0.06, -0.15, 0.15), [b1x, b1y] = G(-0.06, 0.15, 0.15);
      ctx.beginPath(); ctx.moveTo(b0x, b0y); ctx.lineTo(b1x, b1y);
      ctx.strokeStyle = '#4a3624'; ctx.lineWidth = 2 * k; ctx.stroke(); ctx.lineWidth = 1;
      if (headInFront) drawHead(head[0], head[1], head[2], ux, uy, k);
    },
  };
}

const W2S = (dx, dy) => [(dx - dy) * hw, (dx + dy) * hh]; // a world offset on the ground -> screen
function drawPlayer(ghost) {
  const k = TW / 64;
  const sx = PX(player.x, player.y), sy = PY(player.x, player.y, 0);
  const fx = Math.cos(player.facing), fy = Math.sin(player.facing);
  let ux = fx - fy, uy = (fx + fy) * 0.5;               // facing direction on screen
  const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
  const [psx, psy] = W2S(eye.x - player.x, eye.y - player.y); // head leaning out to peek
  const c = { sx, sy, k, ux, uy, m: player.moving, psx, psy };
  const fig = player.crawl ? crawlFigure(c) : player.hug ? hugFigure(c) : walkFigure(c);

  if (ghost) { // dashed outline, drawn on top of walls that hide the character
    ctx.save();
    ctx.globalAlpha = 0.7; ctx.setLineDash([3 * k, 2.5 * k]);
    ctx.strokeStyle = '#8fe3d2'; ctx.lineWidth = 1.5;
    ctx.stroke(fig.body);
    ctx.beginPath(); ctx.arc(fig.head[0], fig.head[1], fig.head[2], 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    return;
  }
  // Points used to tell whether a wall drawn later hides the character
  playerSamples = fig.samples;

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  fig.shadow();

  // gaze marker on the ground
  const tip = 0.62, base = 0.42, wdt = 0.1, pxv = -fy, pyv = fx;
  const T = [player.x + fx * tip, player.y + fy * tip];
  const L = [player.x + fx * base + pxv * wdt, player.y + fy * base + pyv * wdt];
  const Rr = [player.x + fx * base - pxv * wdt, player.y + fy * base - pyv * wdt];
  ctx.beginPath(); ctx.moveTo(PX(T[0], T[1]), PY(T[0], T[1], 0));
  ctx.lineTo(PX(L[0], L[1]), PY(L[0], L[1], 0)); ctx.lineTo(PX(Rr[0], Rr[1]), PY(Rr[0], Rr[1], 0)); ctx.closePath();
  ctx.fillStyle = 'rgba(236,214,170,0.75)'; ctx.fill();

  fig.paint();
}

// A soft line along the foot of the wall where the character is pressed against it. It
// fades in while you push into a wall, and fades out as you pull away.
function drawWallContact() {
  const h = player.hug;
  if (!h) return;
  const a = 0.6 * (1 - 0.75 * smoothstep(h.pull / S.unstickT));
  const tx = h.tx, ty = h.ty, L = 0.34;
  const cx = h.nx ? h.face : player.x, cy = h.nx ? player.y : h.face;
  const x0 = PX(cx - tx * L, cy - ty * L), y0 = PY(cx - tx * L, cy - ty * L, 0.02);
  const x1 = PX(cx + tx * L, cy + ty * L), y1 = PY(cx + tx * L, cy + ty * L, 0.02);
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, 'rgba(143,227,210,0)'); g.addColorStop(0.5, `rgba(143,227,210,${a})`); g.addColorStop(1, 'rgba(143,227,210,0)');
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  ctx.strokeStyle = g; ctx.lineWidth = 2.5 * TW / 64; ctx.stroke(); ctx.lineWidth = 1;
}

// ---------------------------------------------------------------- frame
function render(vis) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, cw, ch);

  drawFloor(vis);

  // Painter's order along the diagonals, interleaving walls and objects.
  const ents = [];
  for (const p of map.props) {
    if (!onScreen(Math.floor(p.x), Math.floor(p.y))) continue;
    if (!p.seen && !S.revealAll) continue;
    ents.push({ d: p.x + p.y, draw: () => drawBarrel(p, vis) });
  }
  ents.push({ d: player.x + player.y, draw: () => drawPlayer() });
  ents.sort((a, b) => a.d - b.d);
  playerSamples = null; playerHidden = false;
  let ei = 0;
  for (let s = 0; s <= map.W + map.H - 2; s++) {
    while (ei < ents.length && ents[ei].d < s + 1) ents[ei++].draw();
    for (let cx = Math.max(0, s - (map.H - 1)); cx <= Math.min(map.W - 1, s); cx++) {
      const cy = s - cx;
      if (map.isWall(cx, cy) && onScreen(cx, cy) && shouldDrawWall(cx, cy)) drawWall(cx, cy, vis);
    }
  }
  while (ei < ents.length) ents[ei++].draw();
  if (playerHidden) drawPlayer(true);
  drawWallContact();

  // Cursor reticle on the ground
  if (lookMode === 'mouse' && mouse.has) {
    const g = unproject(mouse.x, mouse.y);
    ctx.beginPath(); ctx.ellipse(PX(g.x, g.y), PY(g.x, g.y, 0), 0.2 * hw * Math.SQRT2, 0.2 * hh * Math.SQRT2, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(236,214,170,0.55)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
  }

  if (S.debug) {
    ctx.beginPath();
    vis.pts.forEach((p, i) => { const x = PX(p.x, p.y), y = PY(p.x, p.y, 0); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.strokeStyle = 'rgba(255,90,90,0.8)'; ctx.stroke();
  }
}

// ---------------------------------------------------------------- tuning panel
const SLIDERS = [
  { key: 'coneDeg', label: 'Cone width', min: 20, max: 180, step: 1, fmt: v => v + '°' },
  { key: 'range', label: 'Sight range', min: 3, max: 16, step: 0.5, fmt: v => v + ' tiles' },
  { key: 'periph', label: 'Close awareness', min: 0, max: 3, step: 0.1, fmt: v => v.toFixed(1) + ' tiles' },
  { key: 'turnDeg', label: 'Turn speed', min: 90, max: 1440, step: 10, fmt: v => v + '°/s' },
  { key: 'speed', label: 'Walk speed', min: 1, max: 8, step: 0.1, fmt: v => v.toFixed(1) + ' tiles/s' },
  { key: 'slideSpeed', label: 'Wall-slide speed', min: 0.5, max: 6, step: 0.1, fmt: v => v.toFixed(1) + ' tiles/s' },
  { key: 'crawlSpeed', label: 'Crawl speed', min: 0.3, max: 3, step: 0.1, fmt: v => v.toFixed(1) + ' tiles/s' },
  { key: 'unstickT', label: 'Pull to let go of wall', min: 0.05, max: 1, step: 0.05, fmt: v => v.toFixed(2) + ' s' },
  { key: 'peek', label: 'Corner peek reach', min: 0, max: 0.6, step: 0.02, fmt: v => v.toFixed(2) + ' tiles' },
  { key: 'wallH', label: 'Wall height', min: 0.3, max: 1.6, step: 0.05, fmt: v => v.toFixed(2) },
  { key: 'zoom', label: 'Zoom', min: 0.5, max: 2.2, step: 0.05, fmt: v => v.toFixed(2) + '×' },
];
const sliderEls = {};
(function buildPanel() {
  const box = document.getElementById('sliders');
  for (const d of SLIDERS) {
    const row = document.createElement('label'); row.className = 'row';
    row.innerHTML = `<span class="name">${d.label}</span><span class="val"></span>`;
    const inp = document.createElement('input');
    Object.assign(inp, { type: 'range', min: d.min, max: d.max, step: d.step, value: S[d.key] });
    inp.addEventListener('input', () => { S[d.key] = parseFloat(inp.value); syncSliders(); });
    inp.addEventListener('change', () => inp.blur());
    row.appendChild(inp); box.appendChild(row);
    sliderEls[d.key] = { inp, val: row.querySelector('.val'), d };
  }
  const rev = document.getElementById('reveal');
  rev.addEventListener('change', () => { S.revealAll = rev.checked; rev.blur(); });
  const dbg = document.getElementById('debug');
  dbg.addEventListener('change', () => { S.debug = dbg.checked; dbg.blur(); });
  for (const b of document.querySelectorAll('#cutmode button')) {
    b.addEventListener('click', () => { S.cutMode = b.dataset.mode; syncCutMode(); b.blur(); });
  }
  syncCutMode();
  document.getElementById('regen').addEventListener('click', e => { newDungeon((Math.random() * 1e9) | 0); e.target.blur(); });
  syncSliders();
})();
function syncCutMode() {
  for (const b of document.querySelectorAll('#cutmode button')) b.classList.toggle('on', b.dataset.mode === S.cutMode);
}
function cycleCutMode() {
  const modes = ['off', 'near', 'sight'];
  S.cutMode = modes[(modes.indexOf(S.cutMode) + 1) % modes.length];
  syncCutMode();
}
function syncSliders() {
  for (const key in sliderEls) {
    const { inp, val, d } = sliderEls[key];
    if (parseFloat(inp.value) !== S[key]) inp.value = S[key];
    val.textContent = d.fmt(S[key]);
  }
}

// ---------------------------------------------------------------- loop
let last = performance.now(), fpsAcc = 0, fpsN = 0;
const fpsEl = document.getElementById('fps');
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  setupView();
  update(dt);
  setupView();
  const vis = computeVision(map, eye.x, eye.y, player.facing, {
    half: S.coneDeg * Math.PI / 360, soft: SOFT, range: S.range, periph: Math.max(0.05, S.periph),
  });
  updateExplored(vis);
  updateCutaway(vis, dt);
  render(vis);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fpsEl.textContent = Math.round(fpsN / fpsAcc) + ' fps'; fpsAcc = 0; fpsN = 0; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
