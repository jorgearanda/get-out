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
  ambient: 0.05,   // light everywhere, with no light source (0 = pitch black)
  darkSight: 2.6,  // how far the character can make out shapes in the dark (tiles)
  lantern: false,  // carrying a lit lantern
  wallH: 0.9,      // wall height (tiles)
  enemyConeDeg: 80, // full width of a guard's cone of sight
  enemyRange: 8,   // how far guards see (tiles)
  spotLight: 0.1,  // how much light must fall on you for a guard to spot you
  enemySpeed: 3.0, // guards' speed when chasing or searching (tiles/s)
  enemiesSee: true, // guards can spot you (off: wander about unseen, for testing)
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
let level = 1;          // how many flights of stairs down
let state = 'play';     // 'play' | 'caught' | 'done' (made it to the stairs)
let stateT = 0;         // time since the state changed

// ---------------------------------------------------------------- exploration memory
// Something counts as explored once it's been in view AND you could actually make it out:
// either it was lit well enough, or it was close enough to see in the dark. A floor square
// needs any part of it seen; a wall square a sight ray striking it; an object to be in view.
// Light fixtures light themselves, so they're noticed whenever they're in view. Only
// explored things are drawn (in outline when not currently seen).
const DISCERN = 0.1; // light level at which things can be made out from afar
function discernible(x, y) {
  return Math.hypot(x - eye.x, y - eye.y) <= S.darkSight || lum(lightRGB(x, y)) >= DISCERN;
}
function updateExplored(vis) {
  const W = map.W, R = Math.ceil(S.range + 1);
  const pcx = Math.floor(player.x), pcy = Math.floor(player.y);
  const SAMPLES = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];
  for (let cy = Math.max(0, pcy - R); cy <= Math.min(map.H - 1, pcy + R); cy++)
    for (let cx = Math.max(0, pcx - R); cx <= Math.min(W - 1, pcx + R); cx++) {
      const idx = cy * W + cx;
      if (explored[idx] || map.isWall(cx, cy)) continue;
      for (const [u, v] of SAMPLES)
        if (vis.sees(cx + u, cy + v) && discernible(cx + u, cy + v)) { explored[idx] = 1; break; }
    }
  for (const p of vis.pts) {
    if (p.cell < 0 || explored[p.cell]) continue;
    // a point just in front of where the ray struck the wall
    const dx = p.x - eye.x, dy = p.y - eye.y, d = Math.hypot(dx, dy) || 1;
    if (discernible(p.x - dx / d * 0.03, p.y - dy / d * 0.03)) explored[p.cell] = 1;
  }
  for (const p of map.props)
    if (!p.seen && Math.abs(p.x - player.x) <= R && Math.abs(p.y - player.y) <= R &&
        (vis.sees(p.x, p.y) || vis.sees(p.x + 0.2, p.y + 0.2)) &&
        (p.type === 'brazier' || discernible(p.x, p.y))) p.seen = true;
  for (const l of map.lights)
    if (!l.seen && Math.abs(l.x - player.x) <= R && Math.abs(l.y - player.y) <= R && vis.sees(l.x, l.y)) {
      l.seen = true;
      if (l.kind === 'torch') explored[l.wy * W + l.wx] = 1;
    }
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
  map.torchWalls = new Set();
  map.lights.forEach((l, i) => {
    l.seen = false; l.vis = null; l.phase = i * 2.39; l.flick = 1;
    if (l.kind === 'torch') map.torchWalls.add(l.wy * map.W + l.wx);
  });
  enemies = makeEnemies(map.enemies);
  prevPX = prevPY = null;
  setState('play');
  const el = document.getElementById('seed');
  if (el) el.textContent = seed;
  const lv = document.getElementById('level');
  if (lv) lv.textContent = level;
}
function setState(s) {
  state = s; stateT = 0;
  const b = document.getElementById('banner');
  if (!b) return;
  b.hidden = s === 'play';
  b.className = 'banner ' + s;
  if (s === 'caught') {
    b.querySelector('.b-title').textContent = 'Caught!';
    b.querySelector('.b-sub').innerHTML = '<kbd>Enter</kbd> try this level again &nbsp; <kbd>R</kbd> a new one';
  } else if (s === 'done') {
    b.querySelector('.b-title').textContent = `Level ${level} done`;
    b.querySelector('.b-sub').innerHTML = 'Down the stairs… <kbd>Enter</kbd>';
  }
}
function nextLevel() { level++; newDungeon((Math.random() * 1e9) | 0); }
// Made it onto the stairs?
function checkExit() {
  const x = map.exit;
  if (x && Math.hypot(player.x - x.x - 0.5, player.y - x.y - 0.5) < 0.32) setState('done');
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
  if (k === 'enter' && !e.repeat) { if (state === 'caught') newDungeon(seed); else if (state === 'done') nextLevel(); }
  if (k === 'h' && !e.repeat) document.body.classList.toggle('hide-ui');
  if (k === 't' && !e.repeat) toggleTune();
  if (k === 'x' && !e.repeat) toggleHug();
  if (k === 'c' && !e.repeat) toggleCrawl();
  if (k === 'v' && !e.repeat) cycleCutMode();
  if (k === 'l' && !e.repeat) { S.lantern = !S.lantern; syncLantern(); }
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
    // objects, and the character and the guards bump into each other (guards don't get in
    // each other's way)
    for (const o of map.props) pushOff(p, o);
    if (p === player) { for (const o of enemies) pushOff(p, o); } else pushOff(p, player);
  }
}

function pushOff(p, o) { // move circle p out of circle o
  const dx = p.x - o.x, dy = p.y - o.y, rr = p.r + o.r;
  const d2 = dx * dx + dy * dy;
  if (d2 < rr * rr && d2 > 1e-10) { const d = Math.sqrt(d2); p.x += dx / d * (rr - d); p.y += dy / d * (rr - d); }
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
// Light comes only from light sources (plus a little ambient). The character's sight decides
// what is shown live rather than from memory, not how bright it is.
const LIGHT_COL = { torch: [1.0, 0.6, 0.3], brazier: [1.0, 0.56, 0.26], lantern: [1.0, 0.8, 0.52] };
const AMBIENT_TINT = [0.62, 0.74, 1.0];   // what little ambient light there is, is cool
const CONTOUR = '150,182,222';            // colour of shapes made out in the dark
const MEMORY = '85,100,127';              // colour of remembered outlines (= COL.wallLine)
const LANTERN_R = 4.2;
let litList = [];                          // lights in play this frame
const falloff = t => (t >= 1 ? 0 : Math.pow(1 - t, 1.8));
const lum = L => 0.3 * L[0] + 0.55 * L[1] + 0.15 * L[2];
function shine(l, x, y) { // shadow-cast area of a light: a full-circle "vision" from it
  return computeVision(map, x, y, 0, { half: Math.PI, soft: 0.01, range: l.r, periph: l.r });
}
function prepareLights(t) {
  litList = [];
  for (const l of map.lights) {
    if (!l.vis) { l.col = LIGHT_COL[l.kind]; l.vis = shine(l, l.x, l.y); }
    l.flick = 1 + 0.06 * Math.sin(t * 7.3 + l.phase) + 0.04 * Math.sin(t * 17.9 + l.phase * 2.1) + 0.025 * Math.sin(t * 31 + l.phase * 0.7);
    litList.push(l);
  }
  if (S.lantern) {
    const l = { kind: 'lantern', x: player.x, y: player.y, r: LANTERN_R, I: 1.3, col: LIGHT_COL.lantern };
    l.flick = 1 + 0.025 * Math.sin(t * 11.3) + 0.015 * Math.sin(t * 23.7);
    l.vis = shine(l, l.x, l.y);
    litList.push(l);
  }
}
// The light (per colour channel, 1 = full) falling on a point on the ground
function lightRGB(x, y) {
  const a = S.ambient;
  let r = a * AMBIENT_TINT[0], g = a * AMBIENT_TINT[1], b = a * AMBIENT_TINT[2];
  for (const l of litList) {
    const dx = x - l.x, dy = y - l.y, d2 = dx * dx + dy * dy;
    if (d2 >= l.r * l.r) continue;
    const w = l.I * l.flick * falloff(Math.sqrt(d2) / l.r);
    if (w < 0.003 || !l.vis.sees(x, y)) continue;
    r += l.col[0] * w; g += l.col[1] * w; b += l.col[2] * w;
  }
  return [r, g, b];
}
// How much light falls on the character (what guards need to see them by)
const playerLight = () => lum(lightRGB(player.x, player.y));
let gemLit = null;
function updateLightGem() {
  const lit = playerLight() >= S.spotLight;
  if (lit === gemLit) return;
  gemLit = lit;
  const el = document.getElementById('gem');
  if (!el) return;
  el.className = 'gem ' + (lit ? 'lit' : 'dark');
  el.textContent = lit ? 'in the light' : 'in shadow';
}
// How clearly light lets you make something out (0..1), from its light level
const lightClarity = lvl => smoothstep((lvl - 0.03) / 0.22);
// How clearly the character makes out shapes in the dark at a point (0..1): only up close
function darkClarity(x, y) {
  const D = S.darkSight;
  if (D <= 0) return 0;
  const d = Math.hypot(x - eye.x, y - eye.y);
  return 1 - smoothstep((d - D * 0.45) / (D * 0.55));
}
// For a point in view: how strongly to draw dark-adapted contours, and how strongly to keep
// the remembered outline (when it can't really be made out right now)
function seeing(x, y, known) {
  const lc = lightClarity(lum(lightRGB(x, y))), dc = darkClarity(x, y);
  return { contour: dc * (1 - lc), memory: known ? 1 - Math.max(lc, dc) : 0, light: lc };
}
const rgbL = (c, L, f = 1) =>
  `rgb(${Math.min(255, c[0] * L[0] * f) | 0},${Math.min(255, c[1] * L[1] * f) | 0},${Math.min(255, c[2] * L[2] * f) | 0})`;

// Light map: ambient plus each light's shadow-cast pool, added up; multiplied over the floor
const lightCanvas = document.createElement('canvas');
const lctx = lightCanvas.getContext('2d');
function buildLightMap() {
  if (lightCanvas.width !== canvas.width || lightCanvas.height !== canvas.height) {
    lightCanvas.width = canvas.width; lightCanvas.height = canvas.height;
  }
  lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  lctx.globalCompositeOperation = 'source-over';
  const a = S.ambient * 255;
  lctx.fillStyle = `rgb(${a * AMBIENT_TINT[0] | 0},${a * AMBIENT_TINT[1] | 0},${a * AMBIENT_TINT[2] | 0})`;
  lctx.fillRect(0, 0, cw, ch);
  lctx.globalCompositeOperation = 'lighter';
  for (const l of litList) {
    const sx = PX(l.x, l.y), sy = PY(l.x, l.y, 0), rad = l.r * hw * Math.SQRT2;
    if (sx < -rad || sx > cw + rad || sy < -rad || sy > ch + rad) continue;
    lctx.save();
    lctx.beginPath();
    l.vis.pts.forEach((p, i) => { const x = PX(p.x, p.y), y = PY(p.x, p.y, 0); i ? lctx.lineTo(x, y) : lctx.moveTo(x, y); });
    lctx.closePath();
    lctx.translate(sx, sy); lctx.scale(1, 0.5); // a circle on the ground is an ellipse on screen
    const g = lctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    for (let i = 0; i <= 10; i++) {
      const w = l.I * l.flick * falloff(i / 10) * 255;
      g.addColorStop(i / 10, `rgb(${Math.min(255, l.col[0] * w) | 0},${Math.min(255, l.col[1] * w) | 0},${Math.min(255, l.col[2] * w) | 0})`);
    }
    lctx.fillStyle = g; lctx.fill();
    lctx.restore();
  }
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

// The stairs down: a stairwell sunk into the floor square, its steps leading down to the
// north-west (away from the camera, under the wall when there's one there) and on into the
// dark. The steps are shallow: from this camera angle steep ones would be seen edge-on.
const STEPS = 5, STEP_DZ = 0.06;
function drawStairs() {
  const x0 = map.exit.x, y0 = map.exit.y, w = 1 / STEPS;
  const poly = (pts, fill) => {
    ctx.beginPath();
    pts.forEach(([x, y, z], i) => i ? ctx.lineTo(PX(x, y), PY(x, y, z)) : ctx.moveTo(PX(x, y), PY(x, y, z)));
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  };
  ctx.save();
  ctx.beginPath(); diamond(x0, y0); ctx.clip(); // seen only through the opening
  ctx.fillStyle = '#060505'; ctx.fill();
  const deep = -1.2, bottom = -STEPS * STEP_DZ;
  // far end: a dark drop where the stairs carry on down
  const fx = PX(x0, y0 + 0.5), g = ctx.createLinearGradient(fx, PY(x0, y0 + 0.5, bottom), fx, PY(x0, y0 + 0.5, deep));
  g.addColorStop(0, rgb(COL.wallE, 0.3)); g.addColorStop(1, 'rgb(6,5,5)');
  poly([[x0, y0, 0], [x0, y0 + 1, 0], [x0, y0 + 1, deep], [x0, y0, deep]], g);
  const side = [[x0, y0, 0], [x0 + 1, y0, 0]];                                  // stepped side wall
  for (let i = 0; i < STEPS; i++) {
    const z = -(i + 1) * STEP_DZ;
    side.push([x0 + 1 - i * w, y0, z], [x0 + 1 - (i + 1) * w, y0, z]);
  }
  side.push([x0, y0, deep]);
  poly(side, rgb(COL.wallS, 0.45));
  for (let i = STEPS - 1; i >= 0; i--) { // treads, deepest first, darker the deeper they go
    const z = -(i + 1) * STEP_DZ, xa = x0 + 1 - i * w, xb = x0 + 1 - (i + 1) * w;
    poly([[xb, y0, z], [xa, y0, z], [xa, y0 + 1, z], [xb, y0 + 1, z]], rgb(COL.wallTop, 1.05 - i * 0.17));
    ctx.beginPath(); ctx.moveTo(PX(xb, y0), PY(xb, y0, z)); ctx.lineTo(PX(xb, y0 + 1), PY(xb, y0 + 1, z));
    ctx.strokeStyle = 'rgba(12,9,7,0.9)'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
  }
  ctx.restore();
  // the rim of the opening
  ctx.beginPath(); diamond(x0, y0); ctx.strokeStyle = 'rgba(20,15,11,0.8)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
}
// Once found, the stairs keep a gold outline (strongest when not lit and in view)
const EXIT_COL = '222,190,110';
function drawStairsMarker(vis) {
  const x0 = map.exit.x, y0 = map.exit.y, cx = x0 + 0.5, cy = y0 + 0.5;
  const v = seeing(cx, cy, true);
  const a = 0.3 + 0.5 * (vis.sees(cx, cy) ? v.memory : 1);
  ctx.beginPath(); diamond(x0, y0);
  for (let i = 1; i < STEPS; i++) {
    const x = x0 + 1 - i / STEPS;
    ctx.moveTo(PX(x, y0), PY(x, y0, 0)); ctx.lineTo(PX(x, y0 + 1), PY(x, y0 + 1, 0));
  }
  ctx.strokeStyle = `rgba(${EXIT_COL},${a.toFixed(3)})`; ctx.lineWidth = 1.4; ctx.stroke(); ctx.lineWidth = 1;
}

// Draws the floor; returns the outline of all the explored floor on screen
function drawFloor(vis) {
  // Memory layer: faint grid over every explored square
  const known = new Path2D();
  for (let cy = 0; cy < map.H; cy++)
    for (let cx = 0; cx < map.W; cx++)
      if (!map.isWall(cx, cy) && isExplored(cx, cy) && onScreen(cx, cy)) {
        known.moveTo(PX(cx, cy), PY(cx, cy, 0)); known.lineTo(PX(cx + 1, cy), PY(cx + 1, cy, 0));
        known.lineTo(PX(cx + 1, cy + 1), PY(cx + 1, cy + 1, 0)); known.lineTo(PX(cx, cy + 1), PY(cx, cy + 1, 0)); known.closePath();
      }
  ctx.strokeStyle = COL.grid; ctx.lineWidth = 1; ctx.stroke(known);

  // Live layer, clipped to what the character can see
  ctx.save();
  ctx.beginPath();
  vis.pts.forEach((p, i) => { const x = PX(p.x, p.y), y = PY(p.x, p.y, 0); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.closePath();
  ctx.clip();

  // The floor as it is (fully lit)... Squares you can't make out yet stay blank: their
  // shape mustn't give away what's there.
  const R = Math.ceil(S.range + 1);
  const x0 = Math.max(0, Math.floor(eye.x - R)), x1 = Math.min(map.W - 1, Math.floor(eye.x + R));
  const y0 = Math.max(0, Math.floor(eye.y - R)), y1 = Math.min(map.H - 1, Math.floor(eye.y + R));
  const seams = new Path2D();
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (map.isWall(cx, cy) || !onScreen(cx, cy) || !isExplored(cx, cy)) continue;
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
  if (map.exit && isExplored(map.exit.x, map.exit.y) && onScreen(map.exit.x, map.exit.y)) drawStairs();

  // ...times the light falling on it
  buildLightMap();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(lightCanvas, 0, 0);
  ctx.globalCompositeOperation = 'lighten'; // pitch-dark floor looks like the void, not darker
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  // Dark-adapted eyes: a faint cool sense of the floor up close...
  if (S.darkSight > 0) {
    const sx = PX(eye.x, eye.y), sy = PY(eye.x, eye.y, 0), rad = S.darkSight * hw * Math.SQRT2;
    ctx.save();
    ctx.translate(sx, sy); ctx.scale(1, 0.5);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    g.addColorStop(0, `rgba(${CONTOUR},0.07)`); g.addColorStop(0.5, `rgba(${CONTOUR},0.045)`); g.addColorStop(1, `rgba(${CONTOUR},0)`);
    ctx.fillStyle = g; ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
    ctx.restore();
  }
  // ...the edges of the flagstones made out in the dark, and remembered outlines kept
  // wherever nothing can be made out right now
  const cont = [], mem = [];
  for (let i = 0; i <= 8; i++) { cont.push(new Path2D()); mem.push(new Path2D()); }
  const edgePath = (P, cx, cy) => {
    P.moveTo(PX(cx, cy), PY(cx, cy, 0)); P.lineTo(PX(cx + 1, cy), PY(cx + 1, cy, 0));
    P.lineTo(PX(cx + 1, cy + 1), PY(cx + 1, cy + 1, 0)); P.lineTo(PX(cx, cy + 1), PY(cx, cy + 1, 0)); P.closePath();
  };
  for (let cy = y0; cy <= y1; cy++)
    for (let cx = x0; cx <= x1; cx++) {
      if (map.isWall(cx, cy) || !onScreen(cx, cy)) continue;
      const v = seeing(cx + 0.5, cy + 0.5, isExplored(cx, cy));
      const qc = Math.round(v.contour * 8), qm = Math.round(v.memory * 8);
      if (qc > 0) edgePath(cont[qc], cx, cy);
      if (qm > 0) edgePath(mem[qm], cx, cy);
    }
  for (let q = 1; q <= 8; q++) {
    ctx.strokeStyle = `rgba(78,96,126,${0.2 * q / 8})`; ctx.stroke(mem[q]);
    ctx.strokeStyle = `rgba(${CONTOUR},${0.3 * q / 8})`; ctx.stroke(cont[q]);
  }
  ctx.restore();
  return known;
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
      if (!map.torchWalls.has(idx) && Math.abs(cx - pcx) <= R + 3 && Math.abs(cy - pcy) <= R + 3) {
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

// A stretch of a south (bricksAlongX) or east wall face that the character sees, lit by the
// light falling just in front of it. `known` = the wall square is explored.
function litFace(x0, y0, x1, y1, base, hz, bricksAlongX, known) {
  const ax = PX(x0, y0), ay = PY(x0, y0, 0), bx = PX(x1, y1), by = PY(x1, y1, 0);
  const nx = bricksAlongX ? 0 : 0.03, ny = bricksAlongX ? 0.03 : 0;     // just in front
  const ix = bricksAlongX ? 0.03 : 0, iy = bricksAlongX ? 0 : 0.03;     // just inside the ends
  const p0 = [x0 + nx + ix, y0 + ny + iy], p1 = [x1 + nx - ix, y1 + ny - iy];
  const L0 = lightRGB(p0[0], p0[1]), L1 = lightRGB(p1[0], p1[1]);
  const g = ctx.createLinearGradient(ax, ay, bx, by);
  g.addColorStop(0, rgbL(base, L0)); g.addColorStop(1, rgbL(base, L1));
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
  const lc = Math.max(lightClarity(lum(L0)), lightClarity(lum(L1)));
  ctx.beginPath(); ctx.moveTo(ax, ay - hz); ctx.lineTo(bx, by - hz);
  ctx.strokeStyle = `rgba(255,240,215,${0.25 * lc})`; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
  ctx.strokeStyle = 'rgba(15,12,9,0.6)'; ctx.stroke();

  // Edges made out in the dark, and remembered edges where nothing can be made out
  const v0 = seeing(p0[0], p0[1], known), v1 = seeing(p1[0], p1[1], known);
  const edge = (col, a0, a1) => {
    if (a0 < 0.02 && a1 < 0.02) return;
    const eg = ctx.createLinearGradient(ax, ay, bx, by);
    eg.addColorStop(0, `rgba(${col},${a0})`); eg.addColorStop(1, `rgba(${col},${a1})`);
    ctx.beginPath(); ctx.moveTo(ax, ay - hz); ctx.lineTo(bx, by - hz); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    ctx.strokeStyle = eg; ctx.stroke();
  };
  edge(MEMORY, v0.memory, v1.memory);
  edge(CONTOUR, v0.contour * 0.55, v1.contour * 0.55);
}

// Walls drawn after the character (so in front of them) whose outlines on screen overlap
// the character's: the character's outline is dashed in again only inside these.
let playerBox = null, occluders = [];

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
  const known = isExplored(cx, cy);
  const ivS = hS === 0 && vis.faces.get(idx * 4 + FACE_S);
  if (ivS) for (const [t0, t1] of ivS) litFace(cx + t0, cy + 1, cx + t1, cy + 1, COL.wallS, hz, true, known);
  const ivE = hE === 0 && vis.faces.get(idx * 4 + FACE_E);
  if (ivE) for (const [t0, t1] of ivE) litFace(cx + 1, cy + t0, cx + 1, cy + t1, COL.wallE, hz, false, known);
  // Drawn after the character, so in front: does it overlap them on screen?
  if (playerBox && h > 0.3) {
    const b = playerBox;
    if (Dx < b[2] && Bx > b[0] && Ay - hz < b[3] && Cy > b[1])
      occluders.push([Ax, Ay - hz, Bx, By - hz, Bx, By, Cx, Cy, Dx, Dy, Dx, Dy - hz]);
  }
  if (vis.litCells.has(idx)) {
    // The top catches about as much light as the floor right next to it
    let L = [0, 0, 0], best = -1, at = [cx + 0.5, cy + 0.5];
    for (const [x, y, fx, fy] of [[cx, cy + 1, cx + 0.5, cy + 1.03], [cx + 1, cy, cx + 1.03, cy + 0.5],
                                  [cx, cy - 1, cx + 0.5, cy - 0.03], [cx - 1, cy, cx - 0.03, cy + 0.5]]) {
      if (map.isWall(x, y)) continue;
      const l = lightRGB(fx, fy), v = lum(l);
      if (v > best) { best = v; L = l; at = [fx, fy]; }
    }
    quad(Ax, Ay - hz, Bx, By - hz, Cx, Cy - hz, Dx, Dy - hz);
    ctx.fillStyle = rgbL(COL.wallTop, L, 0.9); ctx.fill();
    const v = seeing(at[0], at[1], known);
    edges();
    ctx.strokeStyle = `rgba(255,240,215,${0.6 * v.light})`; ctx.stroke();
    if (v.memory > 0.02) { ctx.strokeStyle = `rgba(${MEMORY},${v.memory})`; ctx.stroke(); }
    if (v.contour > 0.02) { ctx.strokeStyle = `rgba(${CONTOUR},${v.contour * 0.55})`; ctx.stroke(); }
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
  const L = lightRGB(b.x, b.y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(cx + rx * 0.15, by + ry * 0.2, rx * 1.15, ry * 1.15, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
  g.addColorStop(0, rgbL(COL.wood, L, 0.65)); g.addColorStop(0.4, rgbL(COL.wood, L, 1.05)); g.addColorStop(1, rgbL(COL.wood, L, 0.55));
  body(); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = rgbL(COL.hoop, L, 1.2); ctx.lineWidth = Math.max(1, TW / 40);
  for (const z of [0.12, 0.43]) {
    const y = PY(b.x, b.y, z);
    ctx.beginPath(); ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI, false); ctx.stroke();
  }
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(cx, ty, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = rgbL([150, 108, 68], L); ctx.fill(); ctx.strokeStyle = rgbL(COL.hoop, L, 1.2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, ty, rx * 0.6, ry * 0.6, 0, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(60,40,24,0.35)'; ctx.stroke();
  // Made out in the dark / remembered
  const v = seeing(b.x, b.y, b.seen);
  for (const [col, a] of [[MEMORY, v.memory], [CONTOUR, v.contour * 0.6]]) {
    if (a < 0.02) continue;
    ctx.strokeStyle = `rgba(${col},${a})`;
    body(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, ty, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  }
}

// ---------------------------------------------------------------- light fixtures
// Braziers and wall torches. They light themselves, so they're seen whenever they're in
// view; out of view they're remembered in outline.
function flamePath(x, y, w, h, t, ph) { // a flickering tongue of flame, base at (x,y)
  const sway = Math.sin(t * 9 + ph) * w * 0.35 + Math.sin(t * 23 + ph * 2) * w * 0.15;
  const p = new Path2D();
  p.moveTo(x - w, y);
  p.quadraticCurveTo(x - w * 1.1, y - h * 0.55, x + sway, y - h);
  p.quadraticCurveTo(x + w * 1.1, y - h * 0.55, x + w, y);
  p.quadraticCurveTo(x, y + w * 0.5, x - w, y);
  return p;
}
function drawGlow(x, y, r, a) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,170,80,${0.32 * a})`); g.addColorStop(0.35, `rgba(255,120,40,${0.12 * a})`); g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}
function drawFixture(l, vis, t) {
  const k = TW / 64;
  const live = vis.sees(l.x, l.y);
  const iron = live ? '#2a2420' : COL.wallSOut;
  const line = live ? '#120e0b' : COL.wallLine;
  if (l.kind === 'brazier') {
    const cx = PX(l.x, l.y), by = PY(l.x, l.y, 0), bowl = PY(l.x, l.y, 0.36);
    const rx = 0.24 * hw * Math.SQRT2, ry = 0.24 * hh * Math.SQRT2;
    if (live) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(cx, by, rx * 1.1, ry * 1.1, 0, 0, Math.PI * 2); ctx.fill(); }
    // tripod legs
    ctx.beginPath();
    for (const a of [0.6, 2.7, 4.8]) {
      const fx = l.x + Math.cos(a) * 0.2, fy = l.y + Math.sin(a) * 0.2;
      ctx.moveTo(PX(fx, fy), PY(fx, fy, 0)); ctx.lineTo(cx + Math.cos(a) * rx * 0.4, bowl + ry * 0.6);
    }
    ctx.strokeStyle = live ? '#3a322b' : COL.wallLine; ctx.lineWidth = 2.2 * k; ctx.stroke(); ctx.lineWidth = 1;
    // bowl
    ctx.beginPath(); ctx.ellipse(cx, bowl, rx, ry, 0, 0, Math.PI, false);
    ctx.lineTo(cx - rx, bowl); ctx.closePath();
    ctx.fillStyle = iron; ctx.fill(); ctx.strokeStyle = line; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, bowl, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = live ? '#8a3a12' : COL.bg; ctx.fill(); ctx.strokeStyle = live ? '#4a3a2c' : COL.wallLine; ctx.stroke();
    if (!live) return;
    // coals and flames
    ctx.fillStyle = '#ffb347';
    for (let i = 0; i < 5; i++) { const a = i * 1.3 + l.phase; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rx * 0.5, bowl + Math.sin(a) * ry * 0.45, 1.6 * k, 0, Math.PI * 2); ctx.fill(); }
    const fl = l.flick;
    ctx.fillStyle = 'rgba(255,120,30,0.9)'; ctx.fill(flamePath(cx, bowl, rx * 0.75, 22 * k * fl, t, l.phase));
    ctx.fillStyle = 'rgba(255,200,90,0.95)'; ctx.fill(flamePath(cx + rx * 0.1, bowl, rx * 0.42, 14 * k * fl, t * 1.3, l.phase + 1));
    drawGlow(cx, bowl - 8 * k, 46 * k * fl, 1);
  } else { // torch in a bracket on the wall
    const wx = l.face === 'S' ? l.x : l.x - 0.14, wy = l.face === 'S' ? l.y - 0.14 : l.y; // where it meets the wall
    const bx = PX(wx, wy), byy = PY(wx, wy, 0.42);
    const hx = PX(l.x, l.y), hy = PY(l.x, l.y, 0.6);
    ctx.beginPath(); ctx.moveTo(bx, byy); ctx.lineTo(hx, hy);
    ctx.strokeStyle = live ? '#5a3d22' : COL.wallLine; ctx.lineWidth = 2.6 * k; ctx.stroke(); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(bx, byy, 2.2 * k, 0, Math.PI * 2); ctx.fillStyle = iron; ctx.fill(); ctx.strokeStyle = line; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(hx, hy, 3 * k, 1.8 * k, 0, 0, Math.PI * 2); ctx.fillStyle = iron; ctx.fill(); ctx.stroke();
    if (!live) return;
    const fl = l.flick;
    ctx.fillStyle = 'rgba(255,120,30,0.9)'; ctx.fill(flamePath(hx, hy, 3.6 * k, 15 * k * fl, t, l.phase));
    ctx.fillStyle = 'rgba(255,205,100,0.95)'; ctx.fill(flamePath(hx, hy, 2 * k, 9 * k * fl, t * 1.3, l.phase + 1));
    drawGlow(hx, hy - 6 * k, 34 * k * fl, 1);
  }
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

  if (ghost) { // dashed outline, drawn on top of the walls in front, only where they cover
    ctx.save();
    ctx.beginPath();
    for (const p of ghost) {
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.closePath();
    }
    ctx.clip(); // same winding for every wall, so this is their union
    ctx.globalAlpha = 0.7; ctx.setLineDash([3 * k, 2.5 * k]);
    ctx.strokeStyle = '#8fe3d2'; ctx.lineWidth = 1.5;
    ctx.stroke(fig.body);
    ctx.beginPath(); ctx.arc(fig.head[0], fig.head[1], fig.head[2], 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    return;
  }
  // The character's extent on screen, to find walls drawn later that may cover them
  playerBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of fig.samples) {
    playerBox[0] = Math.min(playerBox[0], x - 12 * k); playerBox[1] = Math.min(playerBox[1], y - 10 * k);
    playerBox[2] = Math.max(playerBox[2], x + 12 * k); playerBox[3] = Math.max(playerBox[3], y + 6 * k);
  }

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

  // The character is lit like everything else, but always keeps a faint cool outline so you
  // can find yourself in the dark.
  const lc = lightClarity(lum(lightRGB(player.x, player.y)));
  const lanternAt = S.lantern && lanternSpot(fx, fy);
  if (lanternAt && !lanternAt.front) drawLantern(lanternAt, k);
  ctx.save();
  if ('filter' in ctx) ctx.filter = `brightness(${(0.4 + 0.6 * lc).toFixed(2)})`;
  fig.paint();
  ctx.restore();
  if (lc < 0.97) {
    ctx.strokeStyle = `rgba(${CONTOUR},${(0.5 * (1 - lc)).toFixed(3)})`; ctx.lineWidth = 1.2;
    ctx.stroke(fig.body);
    ctx.beginPath(); ctx.arc(fig.head[0], fig.head[1], fig.head[2], 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
  }
  if (lanternAt && lanternAt.front) drawLantern(lanternAt, k);
}
// Where the lantern hangs: at the hip on the side the character faces (low when crawling)
function lanternSpot(fx, fy) {
  const x = player.x + fx * 0.2, y = player.y + fy * 0.2, z = player.crawl ? 0.07 : 0.3;
  return { sx: PX(x, y), sy: PY(x, y, z), front: x + y > player.x + player.y };
}
function drawLantern(p, k) {
  const { sx, sy } = p;
  ctx.beginPath(); ctx.moveTo(sx, sy - 6 * k); ctx.lineTo(sx, sy - 9 * k);
  ctx.strokeStyle = '#2a2420'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(sx - 3 * k, sy - 6 * k, 6 * k, 8 * k, 1.5 * k) : ctx.rect(sx - 3 * k, sy - 6 * k, 6 * k, 8 * k);
  ctx.fillStyle = '#ffd27a'; ctx.fill(); ctx.strokeStyle = '#3a2c1c'; ctx.stroke();
  drawGlow(sx, sy - 2 * k, 26 * k, 0.8);
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

  const known = drawFloor(vis);
  if (map.exit && isExplored(map.exit.x, map.exit.y)) drawStairsMarker(vis);
  drawEnemyCones(known);

  // Painter's order along the diagonals, interleaving walls and objects.
  const ents = [];
  for (const e of enemies) {
    if (e.shown) ents.push({ d: e.x + e.y, draw: () => drawEnemy(e) });
    else if (S.revealAll) ents.push({ d: e.x + e.y, draw: () => drawEnemyMemory(e, e.x, e.y, e.facing, 0.55) });
    else if (e.memKnown) {
      const a = 0.22 + 0.4 * Math.exp(-(clock - e.shownT) / 6);
      ents.push({ d: e.memX + e.memY, draw: () => drawEnemyMemory(e, e.memX, e.memY, e.memFacing, a) });
    }
  }
  for (const p of map.props) {
    if (!onScreen(Math.floor(p.x), Math.floor(p.y))) continue;
    if (p.type !== 'barrel' || (!p.seen && !S.revealAll)) continue;
    ents.push({ d: p.x + p.y, draw: () => drawBarrel(p, vis) });
  }
  for (const l of map.lights) {
    if (!onScreen(Math.floor(l.x), Math.floor(l.y)) || (!l.seen && !S.revealAll)) continue;
    ents.push({ d: l.x + l.y, draw: () => drawFixture(l, vis, clock) });
  }
  ents.push({ d: player.x + player.y, draw: () => drawPlayer() });
  ents.sort((a, b) => a.d - b.d);
  playerBox = null; occluders = [];
  let ei = 0;
  for (let s = 0; s <= map.W + map.H - 2; s++) {
    while (ei < ents.length && ents[ei].d < s + 1) ents[ei++].draw();
    for (let cx = Math.max(0, s - (map.H - 1)); cx <= Math.min(map.W - 1, s); cx++) {
      const cy = s - cx;
      if (map.isWall(cx, cy) && onScreen(cx, cy) && shouldDrawWall(cx, cy)) drawWall(cx, cy, vis);
    }
  }
  while (ei < ents.length) ents[ei++].draw();
  if (occluders.length) drawPlayer(occluders);
  drawWallContact();
  drawEnemyAlerts();

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
  { key: 'ambient', label: 'Ambient light', min: 0, max: 0.6, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
  { key: 'darkSight', label: 'Sight in the dark', min: 0, max: 6, step: 0.1, fmt: v => v.toFixed(1) + ' tiles' },
  { key: 'enemyConeDeg', label: 'Guard cone width', min: 20, max: 180, step: 1, fmt: v => v + '°' },
  { key: 'enemyRange', label: 'Guard sight range', min: 2, max: 14, step: 0.5, fmt: v => v + ' tiles' },
  { key: 'spotLight', label: 'Light guards need to see you', min: 0, max: 0.6, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
  { key: 'enemySpeed', label: 'Guard speed', min: 1, max: 8, step: 0.1, fmt: v => v.toFixed(1) + ' tiles/s' },
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
  const lan = document.getElementById('lantern');
  lan.addEventListener('change', () => { S.lantern = lan.checked; lan.blur(); });
  const gs = document.getElementById('guards-see');
  gs.addEventListener('change', () => { S.enemiesSee = gs.checked; gs.blur(); });
  const rev = document.getElementById('reveal');
  rev.addEventListener('change', () => { S.revealAll = rev.checked; rev.blur(); });
  const dbg = document.getElementById('debug');
  dbg.addEventListener('change', () => { S.debug = dbg.checked; dbg.blur(); });
  for (const b of document.querySelectorAll('#cutmode button')) {
    b.addEventListener('click', () => { S.cutMode = b.dataset.mode; syncCutMode(); b.blur(); });
  }
  syncCutMode();
  document.getElementById('tune-toggle').addEventListener('click', e => { toggleTune(); e.currentTarget.blur(); });
  let collapsed = false;
  try { collapsed = localStorage.getItem('tuneCollapsed') === '1'; } catch (err) {}
  setTuneCollapsed(collapsed);
  document.getElementById('regen').addEventListener('click', e => { newDungeon((Math.random() * 1e9) | 0); e.target.blur(); });
  syncSliders();
})();
// The settings panel folds down to its title bar (T or a click); remembered per browser.
function setTuneCollapsed(c) {
  document.getElementById('tune').classList.toggle('collapsed', c);
  document.getElementById('tune-toggle').setAttribute('aria-expanded', String(!c));
  try { localStorage.setItem('tuneCollapsed', c ? '1' : '0'); } catch (err) {}
}
function toggleTune() { setTuneCollapsed(!document.getElementById('tune').classList.contains('collapsed')); }
function syncLantern() { document.getElementById('lantern').checked = S.lantern; }
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
let last = performance.now(), fpsAcc = 0, fpsN = 0, clock = 0;
const fpsEl = document.getElementById('fps');
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  setupView();
  stateT += dt;
  if (state === 'play') {
    clock += dt;
    update(dt);
    if (updateEnemies(dt)) setState('caught');
    else checkExit();
  } else if (state === 'done' && stateT > 2.5) nextLevel();
  setupView();
  prepareLights(clock);
  const vis = computeVision(map, eye.x, eye.y, player.facing, {
    half: S.coneDeg * Math.PI / 360, soft: SOFT, range: S.range, periph: Math.max(0.05, S.periph),
  });
  updateExplored(vis);
  updateEnemyVisibility(vis);
  updateLightGem();
  updateCutaway(vis, dt);
  render(vis);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fpsEl.textContent = Math.round(fpsN / fpsAcc) + ' fps'; fpsAcc = 0; fpsN = 0; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
