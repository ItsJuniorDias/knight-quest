# Knight Quest — A Magic World Adventure

A Zelda-like top-down action game built with three.js. Uses the KayKit
Dungeon Remastered + Character Packs (dungeon interiors, hero, undead)
and the Synty POLYGON Adventure Pack (village overworld, foliage, props).

## The Story

The peaceful village of **Willowvale** is under siege by an ancient evil.
Deep beneath the earth, the **Skeleton Warrior** has risen — and with him,
an army of undead. Take up your sword and shield, cross the seven halls of
the Throne of Bones, and drive them back into the darkness.

## Playing

```
npx serve .          # or python3 -m http.server, or any static server
```

Open `http://localhost:3000` (or whatever port your server prints).

### Controls

**Desktop**

| Key           | Action           |
| ------------- | ---------------- |
| WASD / Arrows | Move             |
| J / Space / Z | Attack (combo x2 with input buffering) |
| K / X         | Dodge roll (i-frames) |
| Shift         | Raise shield (frontal block) |
| E / Enter     | Interact (chests, boss door) |

**Mobile**

Left thumbstick for movement, right side for actions:

- 🛡 Block (hold)
- ✋ Interact
- ⚔ Attack (big red)
- ↷ Dodge roll

## The Dungeon

The dungeon is 7 rooms arranged around a central Great Hall:

```
                  [Throne of Bones]   ← boss
                        |🔒
      [Treasury]---[Great Hall]---[Mage Den]
                        |
                   [Crossing]
                        |
[Armory]-------- ↑    (Armory here)
                        |
                   [Entrance]
                        |
                 [Willowvale Village]  ← you start here
```

Doors slam shut with a portcullis when you enter a room with enemies.
Clear the room to open them. The door **North of the Great Hall is locked** —
find the Boss Key in the golden chest of the Treasury.

## Building from source

```
npm install
npm run build        # produces bundle.js
npm run typecheck    # tsc --noEmit
npm test             # dungeon layout sanity tests
```

## Project layout

```
src/
  config.ts             all tunable numbers
  types.ts              shared game types
  main.ts               bootstrap + game loop
  engine/
    loader.ts           GLB loader + spawn(), auto-scales POLYGON assets
    anim.ts             animation state helpers
    input.ts            keyboard + shared InputState
    audio.ts            procedural SFX + dungeon music (no audio files)
  art/
    fx.ts               particle burst pool + heart/bolt/shockwave meshes
  world/
    dungeon.ts          ASCII room definitions (pure data, testable)
    builder.ts          builds meshes from RoomDefs (village + dungeon)
  systems/
    physics.ts          circle vs tile grid, entity separation
    camera.ts           3/4 top-down cam with room-slide transitions
    rooms.ts            current-room, transitions, combat lock, key doors
    player.ts           Knight state machine
    enemies.ts          3 skeleton AIs, awaken-from-floor spawns
    boss.ts             Skeleton Warrior — spin, jump-chop, enrage
    projectiles.ts      mage bolts + boss shockwaves
    pickups.ts          hearts, coins, keys with magnet
    props.ts            barrels, chests, spike traps, victory crystal
  ui/
    hud.ts              hearts / coins / key / boss bar / toast
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
