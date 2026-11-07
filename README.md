# Get Out: vision prototype

A first look at the core feel of a stealth roguelike: a diagonal (isometric) view of a
grid-based dungeon, free movement within the grid, and a **cone of sight** you aim
separately from where you walk. Only what the character is looking at is drawn in full.
Places they've explored but can't see right now are drawn in outline. Places they've
never seen aren't drawn at all.

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
| `V` | Cycle wall cutaway mode (Off / Near you / In sight) |
| `R` | Generate a new dungeon |
| `H` | Hide/show the panels |
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

The panel on the right has live sliders for cone width, sight range, close-awareness
radius, turn speed, walk, wall-slide and crawl speeds, the let-go time, corner peek reach,
wall height and zoom. It also has a wall-cutaway switch, a "Reveal unexplored areas"
toggle (shows the whole map in outline, for comparison) and a debug outline of the vision
polygon.

## How it works

- **`src/dungeon.js`**: seeded generator. It places rooms, joins them with a minimum
  spanning tree of 1-wide (sometimes 2-wide) corridors plus a few loops, then furnishes
  some rooms with pillars, partition walls or barrels. Furniture never touches a room's
  outer ring of floor, so every layout stays fully connected.
- **`src/vision.js`**: casts rays from the character through the grid, densely inside the
  cone and sparsely outside it, plus one just past each wall corner so shadows are crisp.
  The reach of each ray depends on its angle: long inside the cone, a short "close
  awareness" radius outside it, with a soft blend between. This produces:
  - a visibility polygon on the ground, used to clip the lit floor;
  - the exact stretch of each wall face that rays landed on, so walls are lit only
    where they're actually seen.
- **`src/game.js`**: input, movement and collision (a circle of radius 0.22 tiles against
  wall squares, so you can hug walls or walk down the middle of a corridor), the three
  movement modes (`toggleHug`, `toggleCrawl`, `updateHug`), and rendering. Everything is drawn twice: an outline layer for what's been explored, and a
  lit layer limited to the visibility polygon and the seen wall stretches.
- **Exploration memory**: a floor square counts as explored once any part of it has been
  in view, a wall square once a sight ray has struck it, and a barrel once it's been seen.
  Close awareness counts too. The memory resets when a new dungeon is generated. Walls and objects
  are painted back to front along the diagonals.
- **Cutaway walls**: in a diagonal view, a wall hides the floor just behind it on screen.
  There are three modes to compare (key `V`):
  - **Off**: walls always stand at full height. When a wall hides the character, a
    dashed outline shows where they are.
  - **Near you** (default): walls sink to a stub only where they would hide the floor
    within about 2.5 tiles of the character. It changes as you move, never as you look
    around.
  - **In sight**: walls sink wherever they would hide floor the character can see. This
    shows the most, but walls rise and fall as you sweep your gaze.
