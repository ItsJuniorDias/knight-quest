# Knight Quest — A Magic World Adventure

A Zelda-like top-down action game built with three.js. Uses the KayKit
Dungeon Remastered + Character Packs (dungeon interiors, hero, undead)
and the Synty POLYGON Adventure Pack (village overworld, foliage, props).

## The Story

The peaceful village of **Willowvale** is under siege by an ancient evil.
Deep beneath the earth, the **Skeleton King Malric** — once a good king,
now a Skeleton Warrior — has risen. His mind is gone. His axe is not.

Talk to the villagers. Listen to the ghosts. Find the Boss Key in the
Treasury, unlock the Great Hall's northern door, and end him — for his
sake as much as theirs.

## Playing

```
npm install
npx serve -l 3000 .        # or python3 -m http.server, or any static server
```

Open `http://localhost:3000` (or whatever port your server prints).

### Controls

**Desktop**

| Key           | Action           |
| ------------- | ---------------- |
| WASD / Arrows | Move             |
| J / Space / Z | Attack (2-hit combo with input buffering) |
| K / X         | Dodge roll (i-frames) |
| Shift         | Raise shield (frontal block) |
| E / Enter     | Interact — talk to NPCs, open chests, unlock the boss door |

**Mobile**

Left thumbstick for movement, right side for actions:

- 🛡 Block (hold)
- ✋ Interact / Talk
- ⚔ Attack (big red)
- ↷ Dodge roll

## The World (v3)

**15 rooms across 3 biomes**, on 15×13-tile grids, with a BOTW-flavored
third-person chase cam. Unvisited rooms stay hidden until you step in.

```
                     [Throne of Bones]   ← boss (Skeleton King Malric)
                            |🔒
       [Treasury]------[Great Hall]------[Sorcerer's Den]
            |               |                 |
       [Armory]---[The Crossing]---[Hall of Mages]
       /                    |                 \
[Forgotten Cell]       [Entrance]         [Guard Barracks]
                            |
                       [Village]---[Old Orchard]
                          /   \
              [Grove]---/     \---[Southern Woods]
```

### Overworld

- **Willowvale Village** (start) — 8 named NPCs walking around a central
  campfire: Bram the Blacksmith, Mira the Tavern Keeper, Little Wren,
  Osric the Merchant, Yara the Fruit-Seller, Elder Alden (quest giver),
  Sister Ivy the priestess, Old Harl the farmer.
- **Forest rooms** on three sides — 5 more NPCs: Elric the Hermit
  (ex-court-sorcerer with dungeon lore), Weeping Elin and Tomas the
  Woodcutter in the west grove, Nell the Picker and Grandfather Row in
  the east orchard.

### Dungeon

10 stone halls, each haunted by a **Ghost of ___** who was once part of
the court: Sir Adric, Captain Roswin, the Prisoner, Fenn the Armorer,
Archmage Cyn, Steward Bael, the Court Sorcerer, and finally an Echo of
King Malric himself in the throne room. Listen to them — they remember
more than the living.

Doors slam shut with a portcullis when you enter a room with enemies.
Clear the room to open them. The Great Hall's northern door is
**locked** — find the Boss Key in the golden chest of the Treasury.

Enemy density is thick: ~7 skeletons per dungeon room (mixed minions,
rogues, mages), 10-11 in the Crossing and Great Hall for the mid-game
crescendo, plus the boss himself in the throne room.

## Combat feel

- **Sword arc trail** — every swing draws a crescent in front of the
  knight. Combo 1 is cool white; combo 2 is amber-hot.
- **Screen shake** — every hit shakes the camera, scaled to what you hit
  (barrel < enemy < boss). Boss ground-slam is heavy.
- **Combo counter** — a floating badge shows your rolling streak; the
  color ramps yellow → orange → red as it grows. Miss for ~1.6s and it
  resets.
- **Floating combo popups** — every enemy hit pops a `2×`/`3×`/... sprite
  above the target so you can feel the streak building.

## Narrative

Every room has a **narrator beat** the first time you enter, italic-styled
at the bottom of the screen. Every NPC and ghost has 2-5 lines of dialog
that cycles when you press E. Elder Alden and Elric the Hermit are the
main quest sources; the ghosts give tactical hints on how to fight the
king. Boss-key pickup, boss door unlock, boss awakening, boss enrage, and
boss death each fire dedicated story beats.

## Building from source

```
npm install
npm run build        # produces bundle.js
npm run typecheck    # tsc --noEmit
npm test             # dungeon layout sanity tests (109 assertions)
```

## Project layout

```
src/
  config.ts             all tunable numbers
  types.ts              shared game types
  main.ts               bootstrap + game loop + event wiring
  engine/
    loader.ts           GLB loader + spawn(), auto-scales POLYGON assets
    anim.ts             animation state helpers
    input.ts            keyboard + shared InputState
    audio.ts            procedural SFX + dungeon music (no audio files)
  art/
    fx.ts               particle burst pool + heart/bolt/shockwave meshes
    sword-fx.ts         v3: slash arcs + floating combo popups
  world/
    dungeon.ts          ASCII room definitions (pure data, testable)
    builder.ts          builds meshes from RoomDefs (village + dungeon + NPCs)
  systems/
    physics.ts          circle vs tile grid, entity separation
    camera.ts           BOTW-style third-person chase cam + shake + room-slide
    rooms.ts            current-room, transitions, combat lock, key doors
    player.ts           Knight state machine (with combo counter)
    enemies.ts          3 skeleton AIs, awaken-from-floor spawns
    boss.ts             Skeleton King — spin, jump-chop, enrage, dedicated beat
    projectiles.ts      mage bolts + boss shockwaves
    pickups.ts          hearts, coins, keys with magnet
    props.ts            barrels, chests, spike traps, victory crystal
    npcs.ts             v3: 21 NPCs with dialog rosters + wander behavior
    story.ts            v3: narrator director (room beats, NPC & event beats)
  ui/
    hud.ts              hearts / coins / key / boss bar / narrator panel /
                        interact prompt / combo badge
    minimap.ts          canvas grid of visited rooms
    touch.ts            virtual joystick + action buttons
    screens.ts          title / loading / game over / victory
assets/
  characters/           KayKit hero + skeleton pack (skinned + animated)
  dungeon/              KayKit Dungeon Remastered modules
  polygon/              Synty POLYGON Adventure Pack overworld props
```

See `CREDITS.md` for asset attribution and `DEPLOY.md` for how to publish
this to Vercel/Netlify/Cloudflare and link it from the Magic World app via
`expo-web-browser`.
