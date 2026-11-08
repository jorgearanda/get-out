# Get Out: vision prototype

A first look at the core feel of a stealth roguelike: a diagonal (isometric) view of a
grid-based dungeon, free movement within the grid, and a **cone of sight** you aim
separately from where you walk. Each level has a flight of **stairs down** somewhere, and
**guards** in some rooms; reach the stairs without getting caught. Sight and light are separate: the cone decides what you
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

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move (screen-relative: W is up the screen) |
| Mouse | Aim your gaze |
| `Q`/`E` or `←`/`→` | Turn your gaze with the keyboard |
| Scroll wheel | Zoom |
| `X` | Press against the nearest wall bordering your square, or let go |
| `C` | Crawl, or stand back up |
| `L` | Light or put out your lantern |
| `V` | Cycle wall cutaway mode (Off / Near you / In sight) |
| `Enter` | Once caught: try the level again. On the stairs: go straight to the next level |
| `R` | Generate a new dungeon |
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

**Light and sight.** The dungeon is dark apart from its light sources: braziers in some
rooms, torches on many walls, and a lantern you can carry (`L`). About one room in fourteen
has no light at all. What you see depends on both:

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

**Stairs and guards.** The stairs are in the room farthest from where you start, sunk into
the floor with a torch over them when there's a wall to hang one on. Step onto them and the
level is done; a new, deeper level starts after a moment. Once you've seen the stairs they
keep a gold outline.

Guards stand at posts in about half the rooms (most likely by the stairs) and the odd wide
corridor, never in a doorway or a 1-wide corridor, and never near the start.

- Each guard has its own cone of sight (80° wide, 8 tiles long). At its post it doesn't
  stare in one direction: each guard has a habit of its own, either sweeping its gaze
  smoothly back and forth, turning between two or three set headings in turn, or glancing
  about at random.
- A guard only spots you inside its cone, with a clear line of sight to your body, and only
  if enough light falls on you (10% by default, about what a torch gives within 3 tiles; a
  lit lantern always gives you away). Your head doesn't count: leaning out round a corner
  while pressed to a wall is safe. Crawling doesn't matter to them yet. The banner at the
  top shows whether you're "in the light" (visible to guards) or "in shadow".
- Once it spots you it shouts ("!", which you see even when you can't see the guard) and
  chases you at 3 tiles/s. Guards know the layout: they take the shortest path (A* over the
  grid) to where they last saw you, following you for as long as they can see you.
- If you're not there when it arrives, it searches ("?"): it first looks the way you were
  heading, then keeps walking to nearby spots it hasn't checked lately, at the same speed,
  looking around at each, ranging further each time. It never goes back to its post.
- A chasing guard that reaches you catches you, and the level is over (`Enter` to retry).
  Guards are solid to you but walk through each other.

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

- **`src/dungeon.js`**: seeded generator. It places rooms, joins them with a minimum
  spanning tree of 1-wide (sometimes 2-wide) corridors plus a few loops, then furnishes
  some rooms with pillars, partition walls or barrels. Furniture never touches a room's
  outer ring of floor, so every layout stays fully connected. It puts the stairs in the
  room farthest (in steps) from the start. Light sources come from their own random
  stream: most rooms get torches (up to five, on any wall face the camera sees), one or two
  braziers (with open floor all round them), or a mix; about one room in fourteen stays
  dark. Corridors get torches too, about 49 lights per level in all. Guard posts come from a
  third stream.
- **`src/enemies.js`**: the guards: their sight test (cone, range, then a ray), A* path
  finding (8-way, no corner cutting, avoiding barrels, braziers and the stairwell), path
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
  wall squares, so you can hug walls or walk down the middle of a corridor), the three
  movement modes (`toggleHug`, `toggleCrawl`, `updateHug`), lighting, and rendering.
  The level's flow (playing, caught, done) lives here too.
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
