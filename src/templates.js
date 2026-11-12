'use strict';
// The catalog of room templates levels are built from. Each is 25×25 tiles. Its outer ring is
// wall, except for connection points ('+'): one in the middle of every side, always (so any
// template can join any neighbour), and optionally more, which open only where the neighbour
// has one at the same spot. A template may be rotated or mirrored when it's placed.
//
// Legend
//   #  stone wall (also pillars)        +  connection point (outer ring only)
//   K  tall bookshelf (a wall)          X  tall stack of crates (a wall)
//   .  floor                            %  maze: carved into twisty passages anew each time
//   T  table      h  bench      =  bed      x  crate (low: you can see over it)
//   |  iron bars (see through them, can't pass)
//   b  barrel     B  brazier (a light)
//   ^ > v <  a guard's post, and which way it faces (filled at random, see guardP)
//   k  where the key may lie (one of them is picked)       S  a good spot for the stairs
//   @  where the character arrives (start templates only)
//
// Fields: torches (how many wall torches to hang), guardP (chance each post is manned),
// lock (side whose door is locked; its key is in the template), start (arrival template).
//
// Rows are 25-character strings, or [left, centre] pairs for rows that are mirror images
// left to right (the left 12 characters, then the middle one).

const TEMPLATES = (() => {
  const SWAP = { '<': '>', '>': '<' };
  const mir = (L, c) => L + c + [...L].reverse().map(ch => SWAP[ch] || ch).join('');
  const rowsOf = list => list.map(r => (Array.isArray(r) ? mir(r[0], r[1]) : r));
  const EDGE = '############+############';

  // Ring corridor around a round chamber with a great brazier, four spokes, corner vaults
  const rotunda = () => {
    const rows = [];
    for (let y = 0; y < 25; y++) {
      let s = '';
      for (let x = 0; x < 25; x++) {
        const dx = x - 12, dy = y - 12, d = Math.hypot(dx, dy), ax = Math.abs(dx), ay = Math.abs(dy);
        let c = '#';
        if (x === 0 || y === 0 || x === 24 || y === 24) c = ax === 0 || ay === 0 ? '+' : '#';
        else if (d <= 5.3) c = '.';                                 // the chamber
        else if (d >= 8.6 && d <= 10.9) c = '.';                    // the ring
        else if ((ax <= 1 || ay <= 1) && d < 8.6) c = '.';          // spokes, chamber to ring
        else if (ax === 0 || ay === 0) c = '.';                     // ring to the outside
        else if (ax >= 8 && ay >= 8 && ax <= 11 && ay <= 11) c = '.'; // vaults in the corners
        s += c;
      }
      rows.push(s);
    }
    const put = (x, y, c) => { rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1); };
    put(12, 12, 'B');
    for (const [x, y] of [[8, 8], [16, 8], [8, 16], [16, 16]]) put(x, y, '#'); // pillars round the chamber
    put(5, 5, '>'); put(19, 19, '<'); put(12, 8, 'v');
    put(1, 1, 'b'); put(2, 1, 'b'); put(23, 23, 'b'); put(23, 1, 'b'); put(1, 23, 'b');
    put(1, 3, 'S'); put(23, 21, 'S');
    return rows;
  };

  return [
    {
      id: 'landing', name: 'Landing', start: true, torches: 10, guardP: 0,
      rows: rowsOf([
        EDGE,
        '#bb...#####...#####...bb#',
        '#b....#####...#####....b#',
        '#.....#####...#####.....#',
        '###.#######...#######.###',
        '###.####.........####.###',
        '###.##.............##.###',
        '###....B.........B....###',
        '####.................####',
        '####...#.........#...####',
        '##.....................##',
        '#.......................#',
        '+...........@...........+',
        '#.......................#',
        '##.....................##',
        '####...#.........#...####',
        '####.................####',
        '###....B.........B....###',
        '###.##.............##.###',
        '###.####.........####.###',
        '###.#######...#######.###',
        '#.....#####...#####.....#',
        '#x....#####...#####....x#',
        '#xx...#####...#####...xx#',
        EDGE,
      ]),
    },
    {
      // Prison cells either side of a guarded hall; the key was dropped in a cell or left
      // by the warden's desk
      id: 'cells', name: 'Cell block', torches: 12, guardP: 0.75, lock: 'E',
      rows: rowsOf([
        EDGE,
        '###########...###########',
        '#....#....#...#....#....#',
        '#=...#=...#...#...=#...=#',
        '#=...#=...#...#...=#...=#',
        '#....#....#...#....#....#',
        '#.k..#.b..#...#..b.#..k.#',
        '#....#....#...#....#....#',
        '#b...#....#...#....#...b#',
        '#|.||#||||#...#||.|#||.|#',
        '#.......................#',
        '#.TT....................#',
        '+..k...>....B......<....+',
        '#.TT....................#',
        '#.......................#',
        '#||.|#|.||#...#||||#|.||#',
        '#b...#....#...#....#...b#',
        '#....#....#...#....#....#',
        '#..b.#.k..#...#..b.#....#',
        '#....#....#...#....#....#',
        '#=...#=...#...#...=#...=#',
        '#=...#=...#...#...=#...=#',
        '#....#....#...#....#....#',
        '###########...###########',
        EDGE,
      ]),
    },
    {
      // Two dormitories of cots, an armoury corridor between them
      id: 'barracks', name: 'Barracks', torches: 12, guardP: 0.6,
      rows: rowsOf([
        EDGE,
        '#.......................#',
        '#x.=.=.=.=.....=.=.=.=.x#',
        '#..=.=.=.=.....=.=.=.=..#',
        '#..........v............#',
        '#...........B...........#',
        '#..=.=.=.=.....=.=.=.=..#',
        '#x.=.=.=.=.....=.=.=.=.x#',
        '#.......................#',
        '#####.######...######.###',
        '#####.######...######.###',
        '#XXX...................b#',
        '+.......B.......B.....<.+',
        '#XXX...................b#',
        '###.######...######.#####',
        '###.######...######.#####',
        '#.......................#',
        '#x.=.=.=.=.....=.=.=.=.x#',
        '#..=.=.=.=.....=.=.=.=..#',
        '#...........^...........#',
        '#...........B...........#',
        '#..=.=.=.=.....=.=.=.=..#',
        '#x.=.=.=.=.....=.=.=.=.x#',
        '#.......................#',
        EDGE,
      ]),
    },
    {
      // A great hall of long tables and benches, the kitchen behind it
      id: 'mess', name: 'Mess hall', torches: 12, guardP: 0.6,
      rows: rowsOf([
        EDGE,
        '#.......................#',
        '#..B........v........B..#',
        '#...hhhhhhh...hhhhhhh...#',
        '#...TTTTTTT...TTTTTTT...#',
        '#...hhhhhhh...hhhhhhh...#',
        '#.......................#',
        '#...hhhhhhh...hhhhhhh...#',
        '#S..TTTTTTT...TTTTTTT...#',
        '#...hhhhhhh...hhhhhhh...#',
        '#.....................<.#',
        '#.......................#',
        '+.......................+',
        '#.......................#',
        '#...hhhhhhh...hhhhhhh...#',
        '#...TTTTTTT...TTTTTTT...#',
        '#...hhhhhhh...hhhhhhh...#',
        '#..B.................B..#',
        '######...###.###...######',
        '#bb.................xx..#',
        '#b.......TTTTT.........x#',
        '#.........B.............#',
        '#bb...................xx#',
        '###########...###########',
        EDGE,
      ]),
    },
    {
      // A dim forest of pillars
      id: 'colonnade', name: 'Colonnade', torches: 9, guardP: 0.7,
      rows: rowsOf([
        EDGE,
        '#.......................#',
        '#.......................#',
        '#..#..#..#..#..#..#..#..#',
        '#......v................#',
        '#.......................#',
        '#..#..#..#..#..#..B..#..#',
        '#.......................#',
        '#.......................#',
        '#..#..#..#..#..#..#..#..#',
        '#...................<...#',
        '#.......................#',
        '+..#..#..#..B..#..#..#..+',
        '#.......................#',
        '#.......................#',
        '#..#..#..#..#..#..#..#..#',
        '#.......................#',
        '#.......................#',
        '#..#..B..#..#..#..#..#..#',
        '#.......................#',
        '#................^......#',
        '#..#..#..#..#..#..#..#..#',
        '#S......................#',
        '#.......................#',
        EDGE,
      ]),
    },
    {
      // Twisting passages (new ones every time) round a crypt that holds the key
      id: 'catacombs', name: 'Catacombs', torches: 16, guardP: 0.7, lock: 'E',
      rows: rowsOf([
        EDGE,
        '#%%%%%%%%%%%.%%%%%%%%%%%#',
        '#%%%%%%%%%%%%%%%%%%%%%%%#',
        '#%%%%%%%%%%%%%%%%%%%%%%%#',
        '#%%%%%%%%%%%%%%%%%%%%%%%#',
        '#%%%%%%%%%%%%%%%%%%%%%%%#',
        '#%%%%%%%%%%%%%%%%%%%%%%%#',
        '#%%%%%%%%%%%%%%%%%%%%%%%#',
        '#%%%%%%%%%%%%%%%%%%%%%%%#',
        '#%%%%%%%%###.###%%%%%%%%#',
        '#%%%%%%%%#B....#%%%%%%%%#',
        '#%%%%%%%%#x>..x#%%%%%%%%#',
        '+.%%%%%%%...k...%%%%%%%.+',
        '#%%%%%%%%#x...x#%%%%%%%%#',
        '#%%%%%%%%#....B#%%%%%%%%#',
        '#%%%%%%%%###.###%%%%%%%%#',
        '#%%%%%%%%%%%%%%%%%%%%%%%#',
        '#%%%%%%%%%%%%%%%%%%%%%%%#',
        '#%%%%%%%%%%%%%%%%%%%%%%%#',
        '#%%%%%%%%%%%%%%%%%%%%%%%#',
        '#%%%%%%%%%%%%%%%%%%%%%%%#',
        '#%%%%%%%%%%%%%%%%%%%%%%%#',
        '#%%%%%%%%%%%%%%%%%%%%%%%#',
        '#%%%%%%%%%%%.%%%%%%%%%%%#',
        EDGE,
      ]),
    },
    {
      // Aisles between stacks of crates
      id: 'storehouse', name: 'Storehouse', torches: 12, guardP: 0.65,
      rows: rowsOf([
        EDGE,
        '#.......................#',
        '#..XX..XX.v.....XX..XX..#',
        '#..XX..XX.......XX..XX..#',
        '#..XX..Xb.......bX..XX..#',
        '#..X...XX.......XX...X..#',
        '#..XX..XX...B...XX..XX..#',
        '#..XX..bb.......XX..XX..#',
        '#..XX..XX.......XX...X..#',
        '#..bX..XX.......XX..Xb..#',
        '#.....................B.#',
        '#..x.x.............x.x..#',
        '+...>...............<...+',
        '#..x.x.............x.x..#',
        '#.......................#',
        '#..XX..XX.......XX..XX..#',
        '#..Xb..XX.......bb..XX..#',
        '#..XX..X........XX..XX..#',
        '#..XX..XX...B...XX..XX..#',
        '#..XX..XX.......XX..XX..#',
        '#..bb..XX.......Xb..XX..#',
        '#..XX..XX.......XX..bX..#',
        '#S..........B..........S#',
        '#.B.....................#',
        EDGE,
      ]),
    },
    {
      // Nave of pews up to an altar, side aisles behind pillars, a porch at the back
      id: 'chapel', name: 'Chapel', torches: 11, guardP: 0.6,
      rows: rowsOf([
        EDGE,
        ['#######.....', '.'],
        ['#######..B..', '.'],
        ['#######....T', 'T'],
        ['#######.....', 'v'],
        ['##..........', '.'],
        ['##.#.hhhhh..', '.'],
        ['##..........', '.'],
        ['##.#.hhhhh..', '.'],
        ['##..........', 'B'],
        ['##.#.hhhhh..', '.'],
        ['##..........', '.'],
        ['+..#.hhhhh..', '.'],
        ['##..........', '.'],
        ['##.#.hhhhh..', '.'],
        ['##..........', 'B'],
        ['##.#.hhhhh..', '.'],
        ['##..........', '.'],
        ['##.#.hhhhh..', '.'],
        ['##..........', '.'],
        ['##########..', '.'],
        ['#####b.^....', '.'],
        ['#####S......', '.'],
        ['###########.', '.'],
        EDGE,
      ]),
    },
    {
      id: 'rotunda', name: 'Rotunda', torches: 11, guardP: 0.65,
      rows: rotunda(),
    },
    {
      // A courtyard watched through barred windows from the guardhouse, whose far door is
      // locked; the captain keeps the key
      id: 'gatehouse', name: 'Gatehouse', torches: 12, guardP: 0.7, lock: 'E',
      rows: rowsOf([
        EDGE,
        '###########...###=.=.=.x#',
        '###########...###=.=.=..#',
        '###########.............#',
        '#...............#.......#',
        '#..B............#x.....x#',
        '#...............#.......#',
        '#...............####.####',
        '#...............#.......#',
        '#...............|..TT...#',
        '#...............|..TT.<.#',
        '#...............|.......#',
        '+.......B.......|.......+',
        '#...............|..<....#',
        '#...............|.......#',
        '#...............####.####',
        '#...............#x.....b#',
        '#..B............#..TT...#',
        '#...............#..TTk..#',
        '#...............#.......#',
        '#S..............#=.....k#',
        '###########...###=......#',
        '###########...###.......#',
        '###########...###b.....b#',
        EDGE,
      ]),
    },
    {
      // Rows of tall shelves round a reading room
      id: 'archive', name: 'Archive', torches: 12, guardP: 0.6,
      rows: rowsOf([
        EDGE,
        ['#...........', '.'],
        ['#.KKKKKKKK..', '.'],
        ['#.....B.....', '.'],
        ['#.KKKK.KKKK.', '.'],
        '#.....>.................#',
        ['#.KKKKKKKK..', '.'],
        ['#...........', '.'],
        ['#.KKKK.KKKK.', '.'],
        ['#...........', '.'],
        ['#...........', '.'],
        ['#..TT...TT..', '.'],
        ['+...........', 'B'],
        ['#..TT...TT..', '.'],
        ['#...........', '.'],
        ['#.KKKK.KKKK.', '.'],
        ['#.....B.....', '.'],
        ['#.KKKKKKKK..', '.'],
        '#.................<.....#',
        ['#.KKKK.KKKK.', '.'],
        ['#...........', '.'],
        ['#.KKKKKKKK..', '.'],
        ['#S..........', '.'],
        ['#...........', '.'],
        EDGE,
      ]),
    },
  ];
})();
