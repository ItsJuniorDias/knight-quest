// ---------------------------------------------------------------------------
// THE DUNGEON — pure data, no three.js. Testable in plain node.
//
// Each room is an ASCII map (ROOM_W x ROOM_H). First row = north edge.
// Same idea as Spell Storm's world/rooms.ts: readable, hand-editable levels.
//
// Legend:
//   W wall            . floor           D door cell (must sit on the edge,
//   P player start                        centered, and match `doors` below)
//   1 minion spawn    2 rogue spawn     3 mage spawn      Z boss spawn
//   b barrel small    B barrel large    x crates          o box
//   c chest (coins)   K gold chest (BOSS KEY)             h chest (heart)
//   s spike trap      p pillar          t torch (floor-standing marker;
//   S stairs decor                        torches also auto-mount on walls)
//
// Doors are declared explicitly per room; the map's D cells are validated
// against them by test/dungeon.test.mjs so the two can never drift apart.
// ---------------------------------------------------------------------------

import { ROOM_H, ROOM_W } from "../config";
import type { DoorDir, EnemyKind } from "../types";

export type RoomBiome = "dungeon" | "village";

export interface RoomDef {
  key: string;
  gx: number;
  gy: number; // gy grows SOUTH (screen-down); north neighbor is gy-1
  name: string;
  biome: RoomBiome;
  map: string[];
  doors: { dir: DoorDir; kind: "open" | "locked" }[];
  /** decorative banner color for dungeon rooms */
  banner?: "red" | "blue";
}

// Village legend extras (only meaningful in biome=village rooms):
//   H house      U hut         L well       T tree       F fence
//   f flowers    g grass       R rock       O log        M market stall
//   C campfire   ~ stream      = bridge     r roadsign
//   . grass floor (walkable)   , dirt road (walkable)
//   The player starts at P in the village and heads north through the door
//   into the KayKit dungeon's Entrance room.
export const ROOMS: RoomDef[] = [
  {
    key: "0,4",
    gx: 0,
    gy: 4,
    name: "Willowvale Village",
    biome: "village",
    map: [
      "TTTTDTTTT",
      "T.HgH.f.T",
      "Tg..P..gT",
      "T,,,C,,,T",
      "T.M.L.M.T",
      "T.HgUgH.T",
      "TTTTTTTTT",
    ],
    doors: [{ dir: "n", kind: "open" }],
  },
  {
    key: "0,3",
    gx: 0,
    gy: 3,
    name: "Entrance",
    biome: "dungeon",
    banner: "blue",
    map: [
      "WWWWDWWWW",
      "W.......W",
      "W.......W",
      "W...P...W",
      "W.b...b.W",
      "W...S...W",
      "WWWWDWWWW",
    ],
    doors: [
      { dir: "n", kind: "open" },
      { dir: "s", kind: "open" },
    ],
  },
  {
    key: "0,2",
    gx: 0,
    gy: 2,
    name: "Crossing",
    biome: "dungeon",
    banner: "red",
    map: [
      "WWWWDWWWW",
      "W.......W",
      "W.1...1.W",
      "D...1...W",
      "W.p...p.W",
      "W.......W",
      "WWWWDWWWW",
    ],
    doors: [
      { dir: "n", kind: "open" },
      { dir: "s", kind: "open" },
      { dir: "w", kind: "open" },
    ],
  },
  {
    key: "-1,2",
    gx: -1,
    gy: 2,
    name: "Armory",
    biome: "dungeon",
    banner: "blue",
    map: [
      "WWWWWWWWW",
      "W.x...x.W",
      "W..2.2..W",
      "W...c...D",
      "W.b...b.W",
      "W.o...o.W",
      "WWWWWWWWW",
    ],
    doors: [{ dir: "e", kind: "open" }],
  },
  {
    key: "0,1",
    gx: 0,
    gy: 1,
    name: "Great Hall",
    biome: "dungeon",
    banner: "red",
    map: [
      "WWWWDWWWW",
      "W..s.s..W",
      "W.1...1.W",
      "D...3...D",
      "W.......W",
      "W..s.s..W",
      "WWWWDWWWW",
    ],
    doors: [
      { dir: "n", kind: "locked" },
      { dir: "s", kind: "open" },
      { dir: "w", kind: "open" },
      { dir: "e", kind: "open" },
    ],
  },
  {
    key: "-1,1",
    gx: -1,
    gy: 1,
    name: "Treasury",
    biome: "dungeon",
    banner: "blue",
    map: [
      "WWWWWWWWW",
      "W...K...W",
      "W.......W",
      "W.2.3.2.D",
      "W.......W",
      "W.b.B.b.W",
      "WWWWWWWWW",
    ],
    doors: [{ dir: "e", kind: "open" }],
  },
  {
    key: "1,1",
    gx: 1,
    gy: 1,
    name: "Mage Den",
    biome: "dungeon",
    banner: "red",
    map: [
      "WWWWWWWWW",
      "W.s...s.W",
      "W..3.3..W",
      "D...s...W",
      "W..c.h..W",
      "W.s...s.W",
      "WWWWWWWWW",
    ],
    doors: [{ dir: "w", kind: "open" }],
  },
  {
    key: "0,0",
    gx: 0,
    gy: 0,
    name: "Throne of Bones",
    biome: "dungeon",
    banner: "red",
    map: [
      "WWWWWWWWW",
      "W.......W",
      "W...Z...W",
      "W.p...p.W",
      "W.......W",
      "W.......W",
      "WWWWDWWWW",
    ],
    doors: [{ dir: "s", kind: "open" }],
  },
];

export const START_ROOM_KEY = "0,4";
export const BOSS_ROOM_KEY = "0,0";

// ------------------------------ helpers --------------------------------------

export function roomAt(gx: number, gy: number): RoomDef | undefined {
  return ROOMS.find((r) => r.gx === gx && r.gy === gy);
}

export function neighborOf(room: RoomDef, dir: DoorDir): RoomDef | undefined {
  const d = dirDelta(dir);
  return roomAt(room.gx + d.dx, room.gy + d.dy);
}

export function dirDelta(dir: DoorDir): { dx: number; dy: number } {
  switch (dir) {
    case "n": return { dx: 0, dy: -1 };
    case "s": return { dx: 0, dy: 1 };
    case "w": return { dx: -1, dy: 0 };
    case "e": return { dx: 1, dy: 0 };
  }
}

export function opposite(dir: DoorDir): DoorDir {
  switch (dir) {
    case "n": return "s";
    case "s": return "n";
    case "w": return "e";
    case "e": return "w";
  }
}

/** The edge tile a door of `dir` occupies (doors are centered). */
export function doorTile(dir: DoorDir): { tx: number; tz: number } {
  const cx = Math.floor(ROOM_W / 2);
  const cz = Math.floor(ROOM_H / 2);
  switch (dir) {
    case "n": return { tx: cx, tz: 0 };
    case "s": return { tx: cx, tz: ROOM_H - 1 };
    case "w": return { tx: 0, tz: cz };
    case "e": return { tx: ROOM_W - 1, tz: cz };
  }
}

export function charAt(room: RoomDef, tx: number, tz: number): string {
  return room.map[tz]?.[tx] ?? "W";
}

export const ENEMY_CHARS: Record<string, EnemyKind> = {
  "1": "minion",
  "2": "rogue",
  "3": "mage",
};

/** Cells the movement system treats as solid (before doors/props are applied). */
export function isSolidChar(ch: string): boolean {
  return (
    ch === "W" || // dungeon wall
    ch === "T" || // tree
    ch === "H" || // house
    ch === "U" || // hut
    ch === "L" || // well
    ch === "M" || // market stall
    ch === "F" || // fence
    ch === "R" || // rock
    ch === "="    // bridge post
  );
}
