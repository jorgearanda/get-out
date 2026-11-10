'use strict';
// Guards. Each one stands at its post until the character steps into its cone of sight. Then
// it chases them, along the shortest path through the dungeon (guards know the layout), to
// wherever it last saw them. If they're not there, it keeps moving around looking for them.
// A guard that catches the character fights them: the guard ends up out cold on the floor,
// and the character comes away hurt.
// Uses the world state, settings and drawing helpers from game.js.

const ENEMY_R = 0.22;
const GUARD_TURN = { idle: 2.4, chase: 9, search: 5 }; // how fast they turn (rad/s)
const CATCH_D = 0.14;                                   // gap at which a chasing guard catches you
let enemies = [];

function makeEnemies(list) {
  return list.map((p, i) => ({
    x: p.x, y: p.y, r: ENEMY_R, facing: p.facing, post: { x: p.x, y: p.y, facing: p.facing },
    state: 'idle',   // 'idle' (at its post) | 'chase' | 'search' | 'down' (knocked out)
    dmg: 20,         // hit points a fight with it costs the character
    downT: -99, downDir: 0,          // when it was knocked out, and which way it fell
    path: [], goal: -1, repathT: 0, stuckT: 0,
    vx: 0, vy: 0, walk: 0, moving: 0, phase: i * 1.7 + 0.4,
    last: null, lastDir: null,       // where (and which way) it last saw the character going
    wait: 0, waitT: 0, look: p.facing, searchR: 0, visited: new Map(),
    shoutT: -99,                     // when it spotted the character
    shown: false, shownT: -99, memKnown: false, memX: p.x, memY: p.y, memFacing: p.facing, // what the player knows of it
    watch: makeWatch(p, i),
  }));
}

// How a guard at its post looks about. Each one has its own habit: sweeping its gaze smoothly
// back and forth, turning between two or three set headings in turn, or glancing about at
// random. Headings that would stare into a wall right in front of it are avoided.
function makeWatch(p, i) {
  const r = mulberry32(hash2(i, 911, seed));
  const view = a => { const h = castRay(map, p.x, p.y, Math.cos(a), Math.sin(a), 4); return h.cell < 0 ? 4 : Math.hypot(h.x - p.x, h.y - p.y); };
  // a heading between lo and hi radians either side of where it was posted to look, and at
  // least 40° from any in `others`
  const pick = (lo, hi, rnd, others = []) => {
    let best = p.facing, bd = -1;
    for (let k = 0; k < 12; k++) {
      const a = p.facing + (rnd() < 0.5 ? -1 : 1) * (lo + rnd() * (hi - lo)), d = view(a);
      if (others.some(o => Math.abs(wrapAngle(a - o)) < 0.7)) continue;
      if (d >= 2.5) return a;
      if (d > bd) { bd = d; best = a; }
    }
    return best;
  };
  const roll = r();
  if (roll < 0.35) return { kind: 'sweep', amp: 0.6 + r() * 0.5, period: 5 + r() * 4, ph: r() * Math.PI * 2 };
  if (roll < 0.7) {
    const heads = [p.facing];
    for (let k = r() < 0.5 ? 1 : 2; k > 0; k--) heads.push(pick(0.9, 2.0, r, heads));
    return { kind: 'turns', heads, at: 0, hold: 1.5 + r() * 1.5, t: 1 + r() * 2 };
  }
  return { kind: 'glance', target: p.facing, t: 1 + r() * 2, pick: () => pick(0, 1.4, Math.random) };
}
function idleLook(e, dt) {
  const w = e.watch;
  if (w.kind === 'sweep') return e.post.facing + w.amp * Math.sin(clock * 2 * Math.PI / w.period + w.ph);
  w.t -= dt;
  if (w.kind === 'turns') {
    if (w.t <= 0) { w.at = (w.at + 1) % w.heads.length; w.t = w.hold + Math.random() * 0.8; }
    return w.heads[w.at];
  }
  if (w.t <= 0) { w.target = w.pick(); w.t = 1.2 + Math.random() * 2.8; }
  return w.target;
}

// ---------------------------------------------------------------- sight
function enemyCanSee(e, x, y) {
  const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy);
  if (d < 1e-6) return true;
  if (d > S.enemyRange) return false;
  if (Math.abs(wrapAngle(Math.atan2(dy, dx) - e.facing)) > S.enemyConeDeg * Math.PI / 360) return false;
  return castRay(map, e.x, e.y, dx / d, dy / d, d).cell < 0;
}

// ---------------------------------------------------------------- pathfinding
// A* over the grid squares, 8-way, never cutting a corner. Squares with something standing in
// them (barrels, braziers, the stairs) are avoided, except as the destination.
const DIRS8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
let pfG = null, pfFrom, pfSeen, pfDone, pfRun = 0;
function walkable(x, y, goal) {
  if (map.isWall(x, y)) return false;
  const i = y * map.W + x;
  return !map.blocked[i] || i === goal;
}
function findPath(x0, y0, x1, y1) {
  const W = map.W, N = W * map.H;
  if (!pfG || pfG.length !== N) { pfG = new Float32Array(N); pfFrom = new Int32Array(N); pfSeen = new Uint32Array(N); pfDone = new Uint32Array(N); }
  const run = ++pfRun, start = y0 * W + x0, goal = y1 * W + x1;
  if (!walkable(x1, y1, goal)) return null;
  const hf = c => { const dx = Math.abs(c % W - x1), dy = Math.abs(((c / W) | 0) - y1); return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy); };
  // binary heap of cells keyed by f
  const hc = [], hk = [];
  const push = (c, k) => {
    let i = hc.length; hc.push(c); hk.push(k);
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hc[i] = hc[p]; hk[i] = hk[p]; i = p; }
    hc[i] = c; hk[i] = k;
  };
  const pop = () => {
    const top = hc[0], c = hc.pop(), k = hk.pop();
    if (hc.length) {
      let i = 0;
      for (;;) {
        let m = 2 * i + 1; if (m >= hc.length) break;
        if (m + 1 < hc.length && hk[m + 1] < hk[m]) m++;
        if (hk[m] >= k) break;
        hc[i] = hc[m]; hk[i] = hk[m]; i = m;
      }
      hc[i] = c; hk[i] = k;
    }
    return top;
  };
  pfG[start] = 0; pfSeen[start] = run; pfFrom[start] = -1; push(start, hf(start));
  while (hc.length) {
    const c = pop();
    if (pfDone[c] === run) continue;
    pfDone[c] = run;
    if (c === goal) {
      const out = [];
      for (let k = c; k >= 0; k = pfFrom[k]) out.push(k);
      return out.reverse();
    }
    const cx = c % W, cy = (c / W) | 0;
    for (const [dx, dy, cost] of DIRS8) {
      const nx = cx + dx, ny = cy + dy;
      if (!walkable(nx, ny, goal)) continue;
      if (dx && dy && (!walkable(cx + dx, cy, goal) || !walkable(cx, cy + dy, goal))) continue;
      const n = ny * W + nx, g = pfG[c] + cost;
      if (pfSeen[n] === run && g >= pfG[n]) continue;
      pfSeen[n] = run; pfG[n] = g; pfFrom[n] = c; push(n, g + hf(n));
    }
  }
  return null;
}
// Is there room for a body of radius r here? (walls, objects and the stairwell)
function roomFor(x, y, r) {
  for (let cy = Math.floor(y - r); cy <= Math.floor(y + r); cy++)
    for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
      const hole = map.exit && cx === map.exit.x && cy === map.exit.y;
      if (!hole && !map.isWall(cx, cy)) continue;
      const nx = Math.max(cx, Math.min(cx + 1, x)), ny = Math.max(cy, Math.min(cy + 1, y));
      if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return false;
    }
  for (const o of map.props) if (Math.hypot(x - o.x, y - o.y) < r + o.r) return false;
  return true;
}
function clearLine(x0, y0, x1, y1, r) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.12);
  for (let i = 1; i <= n; i++) if (!roomFor(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, r)) return false;
  return true;
}
function setPath(e, tx, ty) {
  const W = map.W, cells = findPath(Math.floor(e.x), Math.floor(e.y), Math.floor(tx), Math.floor(ty));
  e.goal = Math.floor(ty) * W + Math.floor(tx);
  e.repathT = 0.6; e.stuckT = 0;
  if (!cells) { e.path = []; return false; }
  e.path = cells.slice(1).map(c => ({ x: c % W + 0.5, y: ((c / W) | 0) + 0.5 }));
  if (e.path.length) e.path[e.path.length - 1] = { x: tx, y: ty }; else e.path = [{ x: tx, y: ty }];
  return true;
}
// Walk along the path, cutting straight across to later points whenever there's room.
// Returns true once at the end of it (or stuck just short of it).
function followPath(e, dt, speed) {
  const p = e.path;
  while (p.length > 1 && clearLine(e.x, e.y, p[1].x, p[1].y, e.r + 0.02)) p.shift();
  if (!p.length) { e.vx = e.vy = 0; return true; }
  const t = p[0], dx = t.x - e.x, dy = t.y - e.y, d = Math.hypot(dx, dy), end = p.length === 1;
  if (d < (end ? 0.08 : 0.25)) { p.shift(); if (!p.length) { e.vx = e.vy = 0; return true; } return false; }
  const want = end ? Math.min(speed, d * 8) : speed;
  const k = Math.min(1, dt * 12);
  e.vx += (dx / d * want - e.vx) * k; e.vy += (dy / d * want - e.vy) * k;
  const ox = e.x, oy = e.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(e.vx, e.vy) * dt / 0.08));
  for (let i = 0; i < steps; i++) {
    e.x += e.vx * dt / steps; resolveCollisions(e);
    e.y += e.vy * dt / steps; resolveCollisions(e);
  }
  // Barely moving although trying to? Give up on this stretch.
  const moved = Math.hypot(e.x - ox, e.y - oy);
  if (moved < want * dt * 0.25) e.stuckT += dt; else e.stuckT = 0;
  if (e.stuckT > 0.4) {
    e.stuckT = 0;
    if (end && d < 0.7) { p.length = 0; e.vx = e.vy = 0; return true; }
    e.repathT = 0;
  }
  return false;
}

// ---------------------------------------------------------------- behaviour
function startSearch(e) {
  e.state = 'search'; e.path = [];
  e.searchR = 5; e.wait = 0.9; e.waitT = 0;
  e.look = e.lastDir != null ? e.lastDir : e.facing; // first look the way they were heading
}
// Pick somewhere nearby to look next, preferring places it hasn't been lately, a bit further
// afield each time.
function pickSearchSpot(e) {
  const W = map.W, H = map.H, start = Math.floor(e.y) * W + Math.floor(e.x);
  const depth = new Map([[start, 0]]), q = [start];
  let best = -1, bestScore = -Infinity;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], d = depth.get(c), x = c % W, y = (c / W) | 0;
    if (d >= 3) {
      const ago = clock - (e.visited.has(c) ? e.visited.get(c) : -1e9);
      const score = Math.random() + Math.min(1, ago / 25) * 2;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (d >= e.searchR) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, n = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || depth.has(n) || !walkable(nx, ny, -1)) continue;
      depth.set(n, d + 1); q.push(n);
    }
  }
  e.searchR = Math.min(18, e.searchR + 2);
  if (best < 0 || !setPath(e, best % W + 0.5, ((best / W) | 0) + 0.5)) { e.wait = 0.8; e.waitT = 0; e.look = e.facing; }
}

let prevPX = null, prevPY = null;
// Returns the guards that caught the character this frame.
function updateEnemies(dt) {
  // Which way the character is going, for guards that lose sight of them
  const pdx = prevPX == null ? 0 : player.x - prevPX, pdy = prevPY == null ? 0 : player.y - prevPY;
  prevPX = player.x; prevPY = player.y;
  const pHeading = Math.hypot(pdx, pdy) > 0.2 * dt ? Math.atan2(pdy, pdx) : null;
  // Guards need light to see you by. Only the body counts: a head leaning out round a corner
  // while pressed to a wall isn't enough to give you away.
  const lit = playerLight() >= S.spotLight;
  const caught = [];

  for (const e of enemies) {
    if (e.state === 'down') continue;
    const sees = S.enemiesSee && lit && enemyCanSee(e, player.x, player.y);
    if (sees) {
      if (e.state !== 'chase') { e.shoutT = clock; e.path = []; }
      e.state = 'chase';
      e.last = { x: player.x, y: player.y };
      e.lastDir = pHeading;
    }
    let want = e.facing;
    const cell = Math.floor(e.y) * map.W + Math.floor(e.x);
    if (e.state === 'idle') {
      want = idleLook(e, dt);
      e.vx = e.vy = 0;
    } else if (e.state === 'chase') {
      e.repathT -= dt;
      const gc = Math.floor(e.last.y) * map.W + Math.floor(e.last.x);
      if (gc !== e.goal || e.repathT <= 0 || !e.path.length) setPath(e, e.last.x, e.last.y);
      else e.path[e.path.length - 1] = { x: e.last.x, y: e.last.y };
      const arrived = followPath(e, dt, S.enemySpeed);
      if (sees) want = Math.atan2(player.y - e.y, player.x - e.x);
      else if (Math.hypot(e.vx, e.vy) > 0.3) want = Math.atan2(e.vy, e.vx);
      if (arrived && !sees) startSearch(e);
    } else { // search
      e.visited.set(cell, clock);
      if (e.path.length) {
        e.repathT -= dt;
        const tgt = e.path[e.path.length - 1];
        if (e.repathT <= 0) setPath(e, tgt.x, tgt.y);
        const arrived = followPath(e, dt, S.enemySpeed);
        if (Math.hypot(e.vx, e.vy) > 0.3) want = Math.atan2(e.vy, e.vx) + 0.45 * Math.sin(clock * 2.2 + e.phase);
        if (arrived) { e.wait = 0.5 + Math.random() * 0.6; e.waitT = 0; e.look = e.facing; }
      } else if (e.wait > 0) {
        e.wait -= dt; e.waitT += dt;
        want = e.look + 1.1 * Math.sin(e.waitT * 2.4); // looking around
      } else pickSearchSpot(e);
    }
    const dd = wrapAngle(want - e.facing), m = GUARD_TURN[e.state] * dt;
    e.facing = wrapAngle(e.facing + Math.max(-m, Math.min(m, dd)));
    const sp = Math.hypot(e.vx, e.vy);
    e.moving = Math.min(1, sp / Math.max(0.3, S.enemySpeed));
    e.walk += sp * dt * 5.5;
    if (e.state === 'chase' && Math.hypot(e.x - player.x, e.y - player.y) < e.r + player.r + CATCH_D) caught.push(e);
  }
  return caught;
}

// The fight is over: the guard is out cold where it stood, fallen away from the character.
function knockOut(e) {
  e.state = 'down'; e.downT = clock; e.downDir = Math.atan2(e.y - player.y, e.x - player.x);
  e.path = []; e.vx = e.vy = 0; e.moving = 0; e.shoutT = -99;
}

// What the player knows of each guard: seen right now (lit, or close enough in the dark),
// or remembered where last seen until they look there again and find it gone.
function updateEnemyVisibility(vis) {
  for (const e of enemies) {
    const o = 0.18;
    const inView = vis.sees(e.x, e.y) || vis.sees(e.x + o, e.y) || vis.sees(e.x - o, e.y) || vis.sees(e.x, e.y + o) || vis.sees(e.x, e.y - o);
    e.lc = lightClarity(lum(lightRGB(e.x, e.y)));
    e.dc = darkClarity(e.x, e.y);
    e.shown = inView && Math.max(e.lc, e.dc) > 0.05;
    if (e.shown) { e.shownT = clock; e.memKnown = true; e.memX = e.x; e.memY = e.y; e.memFacing = e.facing; e.memDown = e.state === 'down'; }
    else if (e.memKnown && vis.sees(e.memX, e.memY) && discernible(e.memX, e.memY)) e.memKnown = false;
  }
}

// ---------------------------------------------------------------- drawing
const CONE_COL = { idle: '255,200,100', search: '255,140,60', chase: '255,70,55' };
// The cones of the guards you can see, on the floor you know
function drawEnemyCones(floorClip) {
  const half = S.enemyConeDeg * Math.PI / 360;
  let any = false;
  for (const e of enemies) {
    if (!e.shown || e.state === 'down') continue;
    if (!any) { ctx.save(); ctx.clip(floorClip); any = true; }
    const cv = computeVision(map, e.x, e.y, e.facing, { half, soft: 0.02, range: S.enemyRange, periph: 0.3 });
    const col = CONE_COL[e.state], a = e.state === 'chase' ? 1.4 : 1;
    const path = new Path2D();
    cv.pts.forEach((p, i) => { const x = PX(p.x, p.y), y = PY(p.x, p.y, 0); i ? path.lineTo(x, y) : path.moveTo(x, y); });
    path.closePath();
    const sx = PX(e.x, e.y), sy = PY(e.x, e.y, 0), rad = S.enemyRange * hw * Math.SQRT2;
    // brightest near the guard, fading with distance (a circle on the ground: squashed on screen)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    g.addColorStop(0, `rgba(${col},${0.2 * a})`); g.addColorStop(0.75, `rgba(${col},${0.09 * a})`); g.addColorStop(1, `rgba(${col},${0.03 * a})`);
    ctx.save();
    ctx.clip(path);
    ctx.translate(sx, sy); ctx.scale(1, 0.5);
    ctx.fillStyle = g; ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
    ctx.restore();
    ctx.strokeStyle = `rgba(${col},${0.28 * a})`; ctx.lineWidth = 1; ctx.stroke(path);
  }
  if (any) ctx.restore();
}

const GUARD = { mail: ['#4a5059', '#7d8590', '#3b4048'], tabard: ['#5e1f1a', '#a3413a', '#4c1814'], line: '#1a1414', steel: '#9aa2ad' };
function guardFigure(e, x, y, facing, k) {
  const sx = PX(x, y), sy = PY(x, y, 0);
  const fx = Math.cos(facing), fy = Math.sin(facing);
  let ux = fx - fy, uy = (fx + fy) * 0.5;
  const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
  const m = e.moving, bob = Math.abs(Math.sin(e.walk)) * 1.4 * k * m, top = sy - bob;
  const head = [sx + ux * 1.4 * k, top - 39 * k, 7 * k];
  const body = new Path2D();
  body.moveTo(sx - 10.5 * k, sy - 4 * k);
  body.bezierCurveTo(sx - 11 * k, sy - 16 * k, sx - 12.5 * k, top - 27 * k, sx - 10.5 * k, top - 31 * k);
  body.lineTo(sx + 10.5 * k, top - 31 * k);
  body.bezierCurveTo(sx + 12.5 * k, top - 27 * k, sx + 11 * k, sy - 16 * k, sx + 10.5 * k, sy - 4 * k);
  body.quadraticCurveTo(sx, sy + 1.5 * k, sx - 10.5 * k, sy - 4 * k);
  body.closePath();
  // The spear is held in the right hand; it's behind the body when that hand is further away
  const rx = -fy * 0.2, ry = fx * 0.2;
  const [hox, hoy] = W2S(rx, ry);
  const spearFront = rx + ry > 0;
  const spear = () => {
    const hx = sx + hox * 0.9, hy = top - 15 * k + hoy * 0.9;
    ctx.beginPath(); ctx.moveTo(hx, hy + 13 * k); ctx.lineTo(hx, hy - 46 * k);
    ctx.strokeStyle = '#4a3220'; ctx.lineWidth = 2.2 * k; ctx.stroke(); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx, hy - 56 * k); ctx.lineTo(hx - 2.6 * k, hy - 46 * k); ctx.lineTo(hx + 2.6 * k, hy - 46 * k); ctx.closePath();
    ctx.fillStyle = GUARD.steel; ctx.fill(); ctx.strokeStyle = GUARD.line; ctx.stroke();
    ctx.beginPath(); ctx.arc(hx, hy, 2.2 * k, 0, Math.PI * 2); ctx.fillStyle = '#b38b68'; ctx.fill();
  };
  return {
    body, head,
    shadow() { ctx.beginPath(); ctx.ellipse(sx, sy, 13 * k, 6.5 * k, 0, 0, Math.PI * 2); ctx.fill(); },
    paint() {
      if (!spearFront) spear();
      const swing = Math.sin(e.walk) * 5 * k * m;
      ctx.fillStyle = '#1c1714';
      for (const side of [-1, 1]) {
        const off = swing * side;
        ctx.beginPath(); ctx.ellipse(sx + side * 4.5 * k + ux * off, sy - 1 * k + uy * off * 0.5, 3.8 * k, 2.3 * k, 0, 0, Math.PI * 2); ctx.fill();
      }
      // mail coat
      let g = ctx.createLinearGradient(sx - 11 * k, 0, sx + 11 * k, 0);
      g.addColorStop(0, GUARD.mail[0]); g.addColorStop(0.5 + ux * 0.3, GUARD.mail[1]); g.addColorStop(1, GUARD.mail[2]);
      ctx.fillStyle = g; ctx.fill(body); ctx.strokeStyle = GUARD.line; ctx.lineWidth = 1.2; ctx.stroke(body);
      // tabard, on whichever side faces the camera
      const tf = Math.abs(uy) * 0.8 + 0.2, tcx = sx + ux * 3 * k;
      const tab = new Path2D();
      tab.moveTo(tcx - 6 * k * tf, top - 29 * k); tab.lineTo(tcx + 6 * k * tf, top - 29 * k);
      tab.lineTo(tcx + 5.5 * k * tf, sy - 4 * k); tab.lineTo(tcx - 5.5 * k * tf, sy - 4 * k); tab.closePath();
      g = ctx.createLinearGradient(tcx - 6 * k, 0, tcx + 6 * k, 0);
      g.addColorStop(0, GUARD.tabard[0]); g.addColorStop(0.45, GUARD.tabard[1]); g.addColorStop(1, GUARD.tabard[2]);
      ctx.fillStyle = g; ctx.fill(tab); ctx.strokeStyle = GUARD.line; ctx.stroke(tab);
      ctx.beginPath(); ctx.moveTo(sx - 10.8 * k, top - 14 * k); ctx.quadraticCurveTo(sx, top - 11 * k, sx + 10.8 * k, top - 14 * k);
      ctx.strokeStyle = '#2a1c12'; ctx.lineWidth = 2.2 * k; ctx.stroke(); ctx.lineWidth = 1;
      // shoulder plates
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(sx + s * 10 * k, top - 29 * k, 4.6 * k, 3.4 * k, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#6f7782'; ctx.fill(); ctx.strokeStyle = GUARD.line; ctx.stroke();
      }
      // head: face when turned toward the camera, then a kettle helmet with a wide brim
      const [hx, hy, hr] = head;
      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fillStyle = '#2a2320'; ctx.fill();
      const vf = smoothstep((uy + 0.2) / 0.5);
      if (vf > 0) {
        ctx.globalAlpha = vf;
        const fcx = hx + ux * 2.6 * k, fcy = hy + 1.6 * k;
        ctx.beginPath(); ctx.ellipse(fcx, fcy, 4.6 * k * (0.6 + 0.4 * Math.max(0, uy)), 4.4 * k, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#c99b78'; ctx.fill();
        ctx.fillStyle = '#1b1410';
        const es = 1.9 * k * (0.35 + 0.65 * Math.max(0, uy));
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(fcx + ux * 1.4 * k + s * es, fcy - 0.4 * k, 0.95 * k, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.ellipse(hx, hy - 2 * k, 10.5 * k, 3.6 * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#5f6670'; ctx.fill(); ctx.strokeStyle = GUARD.line; ctx.stroke();
      ctx.beginPath(); ctx.arc(hx, hy - 2.5 * k, 7 * k, Math.PI, 0); ctx.closePath();
      g = ctx.createLinearGradient(hx - 7 * k, 0, hx + 7 * k, 0);
      g.addColorStop(0, '#6c737d'); g.addColorStop(0.4 + ux * 0.2, '#b9c0c9'); g.addColorStop(1, '#565c65');
      ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = GUARD.line; ctx.stroke();
      if (spearFront) spear();
    },
  };
}
function drawEnemy(e) {
  const k = TW / 64;
  const fig = e.state === 'down' ? downedFigure(e, e.x, e.y, k) : guardFigure(e, e.x, e.y, e.facing, k);
  const a = Math.min(1, Math.max(e.lc, e.dc) * 1.6);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; fig.shadow();
  if ('filter' in ctx) ctx.filter = `brightness(${(0.12 + 0.88 * e.lc).toFixed(2)})`;
  fig.paint();
  ctx.restore();
  // Made out in the dark: cool contour lines
  const c = e.dc * (1 - e.lc);
  if (c > 0.02) {
    ctx.strokeStyle = `rgba(${CONTOUR},${(0.7 * c).toFixed(3)})`; ctx.lineWidth = 1.2;
    ctx.stroke(fig.body);
    ctx.beginPath(); ctx.arc(fig.head[0], fig.head[1] - 2 * k, fig.head[2], Math.PI, 0); ctx.stroke();
    ctx.lineWidth = 1;
  }
}

// A knocked-out guard, flat on its back with its helmet knocked off and its spear dropped.
// It falls over during the first moments after the fight.
function downedFigure(e, x, y, k) {
  const t = Math.min(1, Math.max(0, (clock - e.downT) / 0.35)), fall = t * t;
  const cd = Math.cos(e.downDir), sd = Math.sin(e.downDir);
  // a point on the body: `a` along it (head end positive), `c` across it, `z` above the floor
  const P = (a, c, z) => {
    const wx = x + (a * cd - c * sd) * fall, wy = y + (a * sd + c * cd) * fall;
    return [PX(wx, wy), PY(wx, wy, z * fall + (1 - fall) * (a + 0.38) * 1.2)];
  };
  const quad = pts => { const p = new Path2D(); pts.forEach(([a, c, z], i) => { const [X, Y] = P(a, c, z); i ? p.lineTo(X, Y) : p.moveTo(X, Y); }); p.closePath(); return p; };
  const body = quad([[-0.36, -0.13, 0.05], [-0.36, 0.13, 0.05], [0.2, 0.17, 0.09], [0.2, -0.17, 0.09]]);
  const tabard = quad([[-0.3, -0.06, 0.1], [-0.3, 0.06, 0.1], [0.17, 0.075, 0.13], [0.17, -0.075, 0.13]]);
  const [hx, hy] = P(0.3, 0, 0.08);
  const head = [hx, hy, 6.2 * k];
  const [mx, my] = P(0.42, 0.26, 0.03); // the helmet, rolled off to one side
  const [s0x, s0y] = P(-0.25, -0.32, 0.01), [s1x, s1y] = P(0.55, -0.12, 0.01);
  return {
    body, head,
    shadow() { const [cx, cy] = P(-0.05, 0, 0); ctx.beginPath(); ctx.ellipse(cx, cy, 20 * k, 9 * k, 0, 0, Math.PI * 2); ctx.fill(); },
    paint() {
      ctx.beginPath(); ctx.moveTo(s0x, s0y); ctx.lineTo(s1x, s1y);
      ctx.strokeStyle = '#4a3220'; ctx.lineWidth = 2.2 * k; ctx.stroke(); ctx.lineWidth = 1;
      const ang = Math.atan2(s1y - s0y, s1x - s0x);
      ctx.save(); ctx.translate(s1x, s1y); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(9 * k, 0); ctx.lineTo(0, -2.6 * k); ctx.lineTo(0, 2.6 * k); ctx.closePath();
      ctx.fillStyle = GUARD.steel; ctx.fill(); ctx.strokeStyle = GUARD.line; ctx.stroke();
      ctx.restore();
      ctx.fillStyle = GUARD.mail[1]; ctx.fill(body); ctx.strokeStyle = GUARD.line; ctx.lineWidth = 1.2; ctx.stroke(body);
      ctx.fillStyle = GUARD.tabard[1]; ctx.fill(tabard); ctx.strokeStyle = GUARD.line; ctx.stroke(tabard);
      for (const c of [-0.16, 0.16]) {
        const [px, py] = P(0.16, c, 0.1);
        ctx.beginPath(); ctx.ellipse(px, py, 4.2 * k, 3 * k, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#6f7782'; ctx.fill(); ctx.strokeStyle = GUARD.line; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(hx, hy, head[2], 0, Math.PI * 2); ctx.fillStyle = '#c99b78'; ctx.fill(); ctx.strokeStyle = GUARD.line; ctx.stroke();
      ctx.beginPath(); ctx.arc(hx, hy - 1.5 * k, head[2], Math.PI * 1.05, Math.PI * 1.95); ctx.strokeStyle = '#2a2320'; ctx.lineWidth = 2.5 * k; ctx.stroke(); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(mx, my, 9.5 * k, 3.4 * k, 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#5f6670'; ctx.fill(); ctx.strokeStyle = GUARD.line; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(mx, my - 1.5 * k, 6 * k, 4 * k, 0.5, Math.PI, 0); ctx.fillStyle = '#8e959f'; ctx.fill(); ctx.stroke();
    },
  };
}
// Remembered where last seen: a fading outline
function drawEnemyMemory(e, x, y, facing, a, down) {
  const k = TW / 64;
  if (down) { // out cold: just its outline
    const fig = downedFigure(e, x, y, k);
    ctx.save();
    ctx.setLineDash([3 * k, 3 * k]);
    ctx.strokeStyle = `rgba(200,120,105,${a.toFixed(3)})`; ctx.lineWidth = 1.2;
    ctx.stroke(fig.body);
    ctx.beginPath(); ctx.arc(fig.head[0], fig.head[1], fig.head[2], 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    return;
  }
  const fig = guardFigure({ walk: 0, moving: 0 }, x, y, facing, k);
  ctx.save();
  ctx.setLineDash([3 * k, 3 * k]);
  ctx.strokeStyle = `rgba(200,120,105,${a.toFixed(3)})`; ctx.lineWidth = 1.2;
  ctx.stroke(fig.body);
  ctx.beginPath(); ctx.arc(fig.head[0], fig.head[1] - 2.5 * k, 7 * k, Math.PI, 0); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(fig.head[0], fig.head[1] - 2 * k, 10.5 * k, 3.6 * k, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
// "!" over a guard that's after you, "?" over one searching. The moment a guard spots you,
// its shout gives it away even if you can't see it.
function drawEnemyAlerts() {
  const k = TW / 64;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `700 ${Math.round(17 * k)}px ui-sans-serif, -apple-system, sans-serif`;
  ctx.lineWidth = 3; ctx.lineJoin = 'round';
  for (const e of enemies) {
    if (e.state === 'down') continue;
    const shout = clock - e.shoutT < 1.2;
    if (!shout && (!e.shown || e.state === 'idle')) continue;
    const sym = e.state === 'search' ? '?' : '!';
    const pop = shout ? 1 + 0.35 * Math.max(0, 1 - (clock - e.shoutT) * 4) : 1;
    const sx = PX(e.x, e.y), sy = PY(e.x, e.y, 0) - 78 * k;
    ctx.save();
    ctx.translate(sx, sy); ctx.scale(pop, pop);
    ctx.globalAlpha = e.shown ? 1 : Math.max(0, 1 - (clock - e.shoutT) / 1.2);
    ctx.strokeStyle = 'rgba(10,6,5,0.85)'; ctx.strokeText(sym, 0, 0);
    ctx.fillStyle = sym === '!' ? '#ff5a46' : '#ffb04a'; ctx.fillText(sym, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
