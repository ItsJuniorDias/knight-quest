# Knight Quest — A Magic World Adventure (v4)

A Zelda-like top-down action game built with three.js. Uses the KayKit
Dungeon Remastered + Character Packs (dungeon interiors, hero, undead)
and the **FULL Synty POLYGON Adventure Pack** (village overworld, foliage,
weapons, decor — 220 assets loaded from OBJ + shared atlas texture).

## The Story

The peaceful village of **Willowvale** is under siege by an ancient evil.
Deep beneath the earth, the **Skeleton King Malric** — once a good king,
now a Skeleton Warrior — has risen. His mind is gone. His axe is not.

## Playing

    npm install
    npx serve -l 3000 .        # or python3 -m http.server, or any static server

Open http://localhost:3000.

### Controls (desktop)

| Key           | Action           |
| ------------- | ---------------- |
| WASD / Arrows | Move             |
| J / Space / Z | Attack (2-hit combo, input-buffered) |
| K / X         | Dodge roll (i-frames) |
| Shift         | Raise shield (frontal block) |
| E / Enter     | Interact — talk to NPCs, open chests, unlock the boss door |

### Controls (mobile)

Left thumbstick for movement, right side for actions:
Block (hold), Interact, Attack (big red), Dodge roll.

## The World

15 rooms across 3 biomes on 15x13-tile grids, BOTW-style chase cam.

                     [Throne of Bones]   <- boss (Skeleton King Malric)
                            |LOCKED
       [Treasury]------[Great Hall]------[Sorcerer's Den]
            |               |                 |
       [Armory]---[The Crossing]---[Hall of Mages]
       /                    |                 \
    [Forgotten Cell]   [Entrance]         [Guard Barracks]
                            |
                       [Village]---[Old Orchard]
                          /   \
              [Grove]---/     \---[Southern Woods]

### v4: full-pack composition

- 220 Synty POLYGON assets loaded from OBJ files with a single shared
  atlas texture (24 KB) - dramatically cheaper than 220 GLBs each
  embedding the same texture.
- Village: 8 named NPCs walking around a central campfire + lanterns,
  laundry lines, laden cart, ground mounds, mushroom clusters, 10 flower
  variants, 22-item market stalls with awnings and sacks at the base.
- Forest rooms: tree stumps, fallen logs with moss, mushroom clusters,
  30+ tree variants (birches, pines, dead trees), plants, reeds, 18 rock
  variants, extra bush layering under every tree.
- Dungeon rooms: stalagmites lining walls, fallen weapons (dropped by
  the ghosts of dead guards), scattered books, ice crystals for the
  sorcerer's den, potion tables, ordered by room theme:
  * Armory: fallen swords/axes/shields between the rogues
  * Treasury: coin barrels, ice, weapons dropped by dying stewards
  * Hall of Mages: books + potions + spike traps
  * Sorcerer's Den: books, potions, ice on every tile
  * Throne of Bones: pillars + stalagmites flanking the aisle
- Total v4 decor: 391 flavor props + 72 enemies + 21 NPCs.

## Combat feel

- Sword arc trail on every swing (white -> amber for the 2-hit combo).
- Camera shake scaled to what was hit (barrel < enemy < boss).
- Combo counter badge (yellow -> orange -> red) with floating popups.
- Combo resets after ~1.6s without a hit.

## Narrative

Every room has a narrator beat the first time you enter, italic-styled
at the bottom. Every NPC and ghost has 2-5 lines of dialog that cycles
when you press E. Elder Alden and Elric the Hermit are the main quest
sources; the ghosts give tactical hints on how to fight the king.
Boss-key pickup, boss door unlock, boss awakening, boss enrage, and
boss death each fire dedicated story beats.

## Building from source

    npm install
    npm run build        # produces bundle.js
    npm run typecheck    # tsc --noEmit
    npm test             # dungeon layout sanity tests (109 assertions)

## Project layout

    src/
      config.ts             all tunable numbers
      types.ts              shared game types
      main.ts               bootstrap + game loop + event wiring
      engine/
        loader.ts           GLB + OBJ loader with shared POLYGON atlas
        anim.ts             animation state helpers
        input.ts            keyboard + shared InputState
        audio.ts            procedural SFX + dungeon music
      art/
        fx.ts               particle pool + procedural heart/bolt/shockwave
        sword-fx.ts         slash arcs + floating combo popups
      world/
        dungeon.ts          ASCII room definitions (pure data, testable)
        builder.ts          room composer with 391 decor objects
      systems/
        physics.ts, camera.ts (with shake), rooms.ts, player.ts,
        enemies.ts, boss.ts, projectiles.ts, pickups.ts, props.ts,
        npcs.ts, story.ts
      ui/
        hud.ts, minimap.ts, touch.ts, screens.ts
    assets/
      characters/           KayKit hero + skeleton pack
      dungeon/              KayKit Dungeon Remastered modules
      polygon/              Synty POLYGON — 75 legacy GLBs (kept)
      polygon-obj/          Synty POLYGON — 220 OBJs + shared atlas.png (v4)

See CREDITS.md and DEPLOY.md.
