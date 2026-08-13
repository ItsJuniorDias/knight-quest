# Credits

## Game

**Knight Quest — A Magic World Adventure**
Built with three.js by Alexandre Junior for the Magic World iOS app.
Vendor ID: 93799798 · Team ID: 9337P26ZJ6

## 3D Assets

### KayKit — Kay Lousberg (CC0 / Public Domain)
- **Dungeon Remastered 1.0** — walls, floors, torches, chests, portcullises,
  spike traps, barrels, banners
- **Character Pack: Adventures 1.0** — Knight (76 animations)
- **Character Pack: Skeletons 1.0** — Skeleton Minion / Rogue / Mage / Warrior
  (95 animations each), Skeleton_Blade / Axe / Staff weapons

Kay's packs are CC0, no attribution required, but he deserves it anyway.
https://kaylousberg.com/game-assets

### Synty Studios — POLYGON Adventure Pack
- 97 environment props: village houses, market stalls, well, hut, campfire,
  fences, trees (regular / pine / birch / dead / stump / log), bushes,
  grass, flowers, mushrooms, rocks, pebbles, ground tiles, roads, streams,
  bridge, lily pads, chests, barrels, crates, baskets, pots, sacks,
  cheese / meat / pumpkins, potions, lanterns, clouds

Licensed under the Synty Studios EULA (purchased for commercial use).
Character models from this pack are NOT used — they ship without usable
skeletal animations in the FBX files.

Conversion pipeline: FBX → glTF 2.0 via assimp 5.3.1, with the
`PolyAdventureTexture_01.png` (or `_Snow_01.png` for snow variants) atlas
embedded as a `bufferView` in each GLB's binary chunk.

## Audio

All SFX and music are procedurally generated at runtime with the WebAudio
API (`src/engine/audio.ts`). No audio files are shipped or licensed.

## Fonts

System UI stack (`-apple-system`, `Segoe UI`, `Roboto`, ...). No font
files are shipped.
