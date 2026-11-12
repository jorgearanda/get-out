# Get Out: vision prototype

A first look at the core feel of a stealth roguelike: a diagonal (isometric) view of a
grid-based dungeon, free movement within the grid, and a **cone of sight** you aim
separately from where you walk. Each level is put together from a catalog of hand-made
**room templates** (cell blocks, barracks, a mess hall, catacombs…), with a flight of
**stairs down** at the far end, **guards** at their posts, and at least one **locked door**
whose key you have to find; reach the stairs before the guards wear you down. Sight and light are separate: the cone decides what you
see *now* (versus what you remember), while torches, braziers and an optional lantern
decide how much there is to see. Places they've explored but can't see right now are
drawn in outline. Places they've never seen aren't drawn at all.

## Run it

Open `index.html` in a browser. There's no build step and nothing to install.

Or serve the folder (handy for live-reloading while editing):

```bash
python3 -m http.server 8765
```

and visit http://localhost:8765.

### On an iPad (or anywhere else)

The game is just static files, so any web host will serve it:

- **Same Wi-Fi, for a quick try:** run
  `python3 -m http.server 8765 --bind 0.0.0.0` in this folder, find the Mac's address with
  `ipconfig getifaddr en0`, and open `http://<that address>:8765` on the iPad.
- **A link to share:** push the repo to GitHub and turn on Pages (Settings → Pages, deploy
  from `main`, root folder), drag the folder onto Netlify Drop, or zip it up as an HTML game
  on itch.io.

It plays on an iPad with a keyboard and trackpad attached: the keys work as on a Mac,
hovering the trackpad pointer aims your gaze (so does touching the screen), and a
two-finger scroll or a pinch zooms the game. A paired game controller works too. In Safari,
Share → Add to Home Screen gives it an icon and opens it full screen, like an app. Without a
keyboard there's no way to move yet.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move (screen-relative: W is up the screen) |
| Mouse or trackpad (or touching the screen) | Aim your gaze |
| `Q`/`E` or `←`/`→` | Turn your gaze with the keyboard |
| Scroll wheel, two-finger scroll or pinch | Zoom |
| `X` | Press against the nearest wall bordering your square, or let go |
| `C` | Crawl, or stand back up |
| `L` | Light or put out your lantern |
| `V` | Cycle wall cutaway mode (Off / Near you / In sight) |
| `Enter` | Once dead: start over from level 1. On the stairs: go straight to the next level |
| `R` | Generate a new dungeon (you get back the health you had when you arrived on this level) |
| `H` | Hide/show the panels |
| `T` | Fold/unfold the settings panel |
| Gamepad | Left stick moves, right stick looks (twin-stick) |

**Three ways to move**, each with its own pose:

- **Walking** (5 tiles/s): upright, long strides.
- **Crawling** (`C`, 1 tile/s): stretched out low on the ground, pointing the way you're
  going. `C` again stands back up.
- **Pressed against a wall** (`X`, 3 tiles/s): back flat to the wall, arms spread along
  it. `X` only works when a wall borders the square you're in; the character steps over to
  the nearest one. While pressed:
  - You slide along the wall. Pushing diagonally works too.
  - At the end of a wall the body stops just short of the corner, still behind it. Keep
    pushing that way and the head leans out 0.4 tiles past the corner, and the view is
    taken from there. Without pressing against the wall, you'd have to step half your
    body out into the opening to see as much.
  - Slide into a wall that runs across yours (the inside corner of a room) and keep
    pushing, and you switch to pressing against that one.
  - `X` lets go. Moving straight away from the wall also lets go, but only after 0.3 s of
    resistance (the body eases off the wall a little meanwhile).

**Light and sight.** The dungeon is dark apart from its light sources: braziers placed by
the templates (they reach 8 tiles), torches along the walls (6.5 tiles; each template asks
for 10 to 16, hung where they're furthest from the lights already up), and a lantern you
can carry (`L`). About two thirds of the floor is well lit; the catacombs are the dimmest,
at a bit under half. What you see depends on both:

| | In your sight | Out of sight |
|---|---|---|
| **Lit** | Full colour and detail, live | Remembered outline |
| **Dark, close** (within 2.6 tiles) | Cool contour lines of edges and shapes, no colour | Remembered outline |
| **Dark, further away** | Nothing new; remembered outlines stay | Remembered outline |

So a lit doorway at the far end of a dark corridor shows up clearly, while the corridor in
between stays blank until you're close. Things only count as explored once you could
actually make them out: lit well enough, or close enough to see in the dark. Torches and
braziers light themselves, so you notice them whenever they're in view. The character is
lit like everything else, and keeps a faint cool outline so you can always find them. The
lantern lights a warm pool about 4 tiles across around you.

**Levels.** Each level is 6 to 8 templates (9 from level 3 on), each 25×25 tiles, laid out
on a 4×3 or 3×4 grid. They grow from one another like a branching tree, so the level
winds; neighbours share a wall with a doorway in the middle (and sometimes more doorways,
where both templates offer one at the same spot), and a few extra doorways make loops. You
arrive in the Landing at one end of the longest route through the level, and the stairs are
in the template at the other end. The templates are turned and mirrored at random, so the
same one looks different from level to level.

| Template | What's in it |
|---|---|
| Landing | Where you arrive: a quiet hall with storerooms, no guards |
| Cell block | Barred cells either side of a guarded hall. **Locked**: the key is in an open cell or by the warden's desk |
| Barracks | Two dormitories of beds, an armoury corridor between them |
| Mess hall | Long tables and benches, a kitchen at the back |
| Colonnade | A dim hall full of pillars to slip between |
| Catacombs | Twisting 1-wide passages, new every time, round a crypt. **Locked**: the key is in the crypt |
| Storehouse | Aisles between tall stacks of crates |
| Chapel | Pews up to an altar, side aisles behind pillars, a porch |
| Rotunda | A ring corridor round a chamber with a great brazier, vaults in the corners |
| Gatehouse | A courtyard watched through barred windows from a guardhouse. **Locked**: the captain keeps the key |
| Archive | Rows of tall bookshelves round a reading room |

**Locked doors and keys.** One template on the route to the stairs (two, sometimes, from
level 3) has a locked side, and it's turned so that side faces onward. Its key lies
somewhere inside that same template. Walk over a key to pick it up (it glints when there's
light on it, and shows at the top of the screen); walk up to its door with it and the door
opens for good. A locked door has a lock on top in its key's colour. The extra doorways
never lead round a lock.

**Furniture.** Tables, benches, beds and low crates block your way but not anyone's view.
Iron bars block the way too, but you and the guards can see through them. Bookshelves and
stacks of crates are as tall as walls and block both.

**Stairs and guards.** The stairs are in the template at the far end of the level, sunk into
the floor with a torch over them when there's a wall to hang one on. Step onto them and the
level is done; a new, deeper level starts after a moment. Once you've seen the stairs they
keep a gold outline.

Guards stand at the posts the templates mark. Each post is manned at random (60–75% of the
time, depending on the template, and 5 points more for each level down), never near the
start; about 12 guards per level.

- Each guard has its own cone of sight (80° wide, 8 tiles long). At its post it doesn't
  stare in one direction: each guard has a habit of its own, either sweeping its gaze
  smoothly back and forth, turning between two or three set headings in turn, or glancing
  about at random.
- A guard only spots you inside its cone, with a clear line of sight to your body, and only
  if enough light falls on you (10% by default, about what a torch gives within 4.5 tiles; a
  lit lantern always gives you away). Your head doesn't count: leaning out round a corner
  while pressed to a wall is safe. Crawling doesn't matter to them yet. The banner at the
  top shows whether you're "in the light" (visible to guards) or "in shadow".
- Once it spots you it shouts ("!", which you see even when you can't see the guard) and
  chases you at 3 tiles/s. Guards know the layout: they take the shortest path (A* over the
  grid) to where they last saw you, following you for as long as they can see you.
- If you're not there when it arrives, it searches ("?"): it first looks the way you were
  heading, then keeps walking to nearby spots it hasn't checked lately, at the same speed,
  looking around at each, ranging further each time. It never goes back to its post.
- A chasing guard that reaches you catches you, and you fight. You don't see the fight,
  only a cloud of dust for a moment, during which you can't move. The guard always loses
  and stays out cold on the floor for the rest of the level (no cone, no sight, and you
  can step over it). You always come away hurt: these guards cost exactly 20 hp each.
  Other guards can catch you during a fight too.
- Standing guards are solid to you; guards walk through each other.

**Health.** You start with 100 hp, shown by the bar at the top, and it carries over from
one level to the next with no healing yet. So you can survive four fights; the fifth kills
you. Dead, you start over from level 1 at full health (`Enter`). Each guard has its own
damage value (`dmg`, 20 for now), so tougher kinds can cost more later.

You see a guard the way you see anything else: in your sight and lit, or up close in the
dark (as a dim silhouette with cool contours). You also see the cone of a guard you can
see, drawn on floor you know: amber at its post, orange searching, red chasing. A guard you
saw is remembered as a dashed red outline where you last saw it, until you look at that
spot again and find it gone.

The panel on the right has live sliders for cone width, sight range, close-awareness
radius, turn speed, walk, wall-slide and crawl speeds, the let-go time, corner peek reach,
ambient light, sight in the dark, the guards' cone width, sight range, speed and how much
light they need to spot you, wall height
and zoom. It also has a lantern toggle, a wall-cutaway switch, a "Guards can spot you"
toggle (turn it off to look around freely), a "Reveal unexplored areas" toggle (shows the
whole map in outline, and every guard, for comparison) and a debug outline of the vision
polygon. Click its title bar (or press `T`) to fold it down out of the way; it
remembers that choice.

## How it works

- **`src/templates.js`**: the catalog of room templates, drawn as 25 rows of 25
  characters (the legend is at the top of the file). Rows that mirror left to right can be
  given as half a row. A template can mark connection points on its outer ring, guard
  posts with their facing, key spots, good spots for the stairs, and a maze area that's
  carved afresh each time. Adding a template is adding an entry here.
- **`src/dungeon.js`**: the seeded level builder. It grows a tree of slots on the coarse
  grid, picks the longest route through it (Landing at one end, stairs at the other), puts
  a locked template on that route turned to face onward, fills the other slots with
  different templates in random orientations, adds a few loops that don't get round a
  lock, and stamps everything onto the tile grid: walls (stone, shelves, crates), locked
  doors, furniture (with the boxes you bump into), barrels, braziers, posts and keys. Then
  torches go on stone wall faces the camera sees, as many as the template asks for, each
  where it's furthest from the lights already up (about 110 lights per level in all; only
  those near enough to light anything in sight are worked out each frame), and guards fill posts from their own random stream.
- **`src/enemies.js`**: the guards: their sight test (cone, range, then a ray), A* path
  finding (8-way, no corner cutting, avoiding furniture, barrels, braziers and the
  stairwell), path
  following that cuts straight across whenever there's room, the chase and search
  behaviour, and drawing them, their cones and their alerts.
- **`src/vision.js`**: casts rays from the character through the grid, densely inside the
  cone and sparsely outside it, plus one just past each wall corner so shadows are crisp.
  The reach of each ray depends on its angle: long inside the cone, a short "close
  awareness" radius outside it, with a soft blend between. This produces:
  - a visibility polygon on the ground, used to clip the lit floor;
  - the exact stretch of each wall face that rays landed on, so walls are lit only
    where they're actually seen.

  The same code, run as a full circle from each light source, gives each light's
  shadow-cast pool. Fixed lights work it out once per dungeon; the lantern every frame.
- **`src/game.js`**: input, movement and collision (a circle of radius 0.22 tiles against
  wall squares and furniture boxes, so you can hug walls or walk down the middle of a
  corridor), keys and locked doors, furniture drawing, the three
  movement modes (`toggleHug`, `toggleCrawl`, `updateHug`), lighting, and rendering.
  The level's flow (playing, dead, done), health and the fights live here too.
  Everything is drawn in two layers: an outline layer for what's been explored, and a
  live layer limited to the visibility polygon and the seen wall stretches. On the live
  layer, the floor is drawn at full brightness and then multiplied by a light map (ambient
  light plus every light's pool). Walls, barrels and the character are shaded by the light
  at their spot (`lightRGB`). On top go the dark-adapted contours and, wherever nothing can
  be made out right now, the remembered outlines. Walls and objects are painted back to
  front along the diagonals.
- **Exploration memory**: a floor square counts as explored once any part of it has been
  seen and could be made out, a wall square once a sight ray struck it at such a spot, and
  a barrel the same way. The memory resets when a new dungeon is generated.
- **Cutaway walls**: in a diagonal view, a wall hides the floor just behind it on screen.
  There are three modes to compare (key `V`):
  - **Off**: walls always stand at full height. When a wall hides the character, a
    dashed outline shows where they are.
  - **Near you** (default): walls sink to a stub only where they would hide the floor
    within about 2.5 tiles of the character. It changes as you move, never as you look
    around.
  - **In sight**: walls sink wherever they would hide floor the character can see. This
    shows the most, but walls rise and fall as you sweep your gaze.
