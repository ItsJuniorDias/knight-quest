// ---------------------------------------------------------------------------
// THE DUNGEON — pure data, no three.js. Testable in plain node.
//
// v4 layout: 15 rooms across 3 biomes (village + forest + dungeon) on a
// 15x13 tile grid. Compared to v3 the maps are now DENSELY composed with
// the full Synty POLYGON Adventure Pack:
//   • the village is a living market: carts, laundry lines, lanterns,
//     ground mounds, stumps, log piles, extra rocks and bush layering
//     around every house, plus the 8 named NPCs of v3.
//   • the forests get mushroom clusters, tree stumps and fallen logs,
//     variety in trees (birch/pine/dead), plants and reeds.
//   • the dungeon gets stalagmites, dropped books, fallen weapons, ice
//     crystals, and potion scatters flavored per room theme (mage rooms
//     get books+potions, treasury gets weapons+ice, throne gets stalagmites).
//
// Legend (shared):
//   W wall            . floor           D door cell (must sit on the edge,
//   P player start                        centered, and match `doors` below)
//   1 minion spawn    2 rogue spawn     3 mage spawn      Z boss spawn
//   b barrel small    B barrel large    x crates          o box
//   c chest (coins)   K gold chest (BOSS KEY)             h chest (heart)
//   s spike trap      p pillar          S stairs decor
//
// Village legend extras (biome=village|forest):
//   H house      U hut         L well       T tree       F fence
//   f flowers    g bushes/tall grass        R rock       O log
//   M hill (solid)     C campfire   ~ stream water        = bridge post
//   r roadsign         P player start   , dirt road   . grass floor
//
// v4 decorative chars (walkable, both biomes unless noted):
//   l lantern post    w washing line    $ cart (solid)     m ground mound
//   + tree stump      - fallen tree log  * mushroom cluster
//
// v4 dungeon flavor chars (walkable):
//   A stalagmite cluster    % books on the ground
//   X fallen weapon         i ice crystal
//   ? potions scatter       & book + potions (alchemist workspace)
//
// NPC chars (v3):
//   N villager   E elder      Q merchant   J guard      Y hermit
//   G ghost      k king-echo (Throne-room special)
//
// Doors are declared explicitly per room; the map's D cells are validated
// against them by test/dungeon.test.mjs so the two can never drift apart.
// ---------------------------------------------------------------------------

import { ROOM_H, ROOM_W } from "../config";
import type { DoorDir, EnemyKind, NpcKind } from "../types";

export type RoomBiome = "dungeon" | "village" | "forest";

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
  /** Reveal this room from the start (used for village + edge previews). */
  startVisible?: boolean;
}

// Every map is ROOM_W (15) chars wide and ROOM_H (13) chars tall.

export const ROOMS: RoomDef[] = [
  // ============================================================
  // ROW gy=5 — southern forest (hermit's clearing below the village)
  // ============================================================
  {
    key: "0,5",
    gx: 0,
    gy: 5,
    name: "Southern Woods",
    biome: "forest",
    startVisible: false,
    map: [
      "TTTTTTTDTTTTTTT",
      "T.gggT.+*....TT",
      "Tg.fgg.f.gg-.TT",
      "T.gggT.mfggg.TT",
      "T.f.**gT.....RT",
      "Tgg.g.fY..gg..T",
      "T.f.gg.g.g.f..T",
      "T.-g.f..g.f.g.T",
      "Tg..gg.gg.+gg.T",
      "T.fg.f..f.gg.mT",
      "TT..gg.g.*f..TT",
      "TT.f.-gg.gg..TT",
      "TTTTTTTTTTTTTTT",
    ],
    doors: [{ dir: "n", kind: "open" }],
  },

  // ============================================================
  // ROW gy=4 — the village hub (start) + adjacent groves
  // ============================================================
  {
    key: "-1,4",
    gx: -1,
    gy: 4,
    name: "Willowvale Grove",
    biome: "forest",
    startVisible: false,
    map: [
      "TTTTTTTTTTTTTTT",
      "T.fgg.f.gg.fg.T",
      "Tg.f.gg.f.+g.gT",
      "T.gg.f.gg.f.g.T",
      "T.f.-ggN.g.f.gT",
      "Tgg.f.gg.f.gg.T",
      "T.g..g*f.gg.f.D",
      "Tf.gg.f.gg.g.gT",
      "T.g.f.gg.gN.g.T",
      "Tg.gg.f.mgg.g.T",
      "T.f.gg.gg..f.gT",
      "Tg..f..g.gg-f.T",
      "TTTTTTTTTTTTTTT",
    ],
    doors: [{ dir: "e", kind: "open" }],
  },
  {
    key: "0,4",
    gx: 0,
    gy: 4,
    name: "Willowvale Village",
    biome: "village",
    startVisible: true,
    // v4 village — LIVING MARKET.
    //   Row 1: hanging cloth between houses (implicit — decor at house sides)
    //   Row 2: J blacksmith (x=2), stall lanterns (l), N tavern (x=11)
    //   Row 4: campfire C at 6, extra market items around
    //   Row 5: Q merchants flanking, lantern posts on the road
    //   Row 6: elder E at 8, P player start at 6
    //   Row 8: L well + N priestess at 9
    //   Row 10-11: farm huts, cart $, washing lines w
    map: [
      "TTTTTTTDTTTTTTT",
      "T.fg.H.,.H.gg.T",
      "T.Jlf.w,...N.wT",
      "T.gg.,,,,,.gg.T",
      "Tmf.,,C,,,Nmf.T",
      "T.Q.,,,,,,,.Q.T",
      "D,,,,,P,E,,,,,D",
      "T.f.,,,,,,,.fmT",
      "T.gg.,,L,N,.gwT",
      "T.f.$.,,,..fggT",
      "Tg.H..,,..H.f.T",
      "T.fgwU.,.gg.NgT",
      "TTTTTTTDTTTTTTT",
    ],
    doors: [
      { dir: "n", kind: "open" },
      { dir: "e", kind: "open" },
      { dir: "w", kind: "open" },
      { dir: "s", kind: "open" },
    ],
  },
  {
    key: "1,4",
    gx: 1,
    gy: 4,
    name: "Old Orchard",
    biome: "forest",
    startVisible: false,
    map: [
      "TTTTTTTTTTTTTTT",
      "T.gg.f.g.fg.g.T",
      "Tf..gg.f.-g.f.T",
      "T.gg.f.gg.fN.gT",
      "T.f.m.gg.f.gg.T",
      "Tgg.f.g..gg.f.T",
      "D.g..gg.f..g.gT",
      "Tf.gg.f.gg.f-.T",
      "T.gN.f..gg.g.gT",
      "Tg.gg.gg..f.f.T",
      "T.f.gg.g.gg+g.T",
      "Tg..f*.gg.mf..T",
      "TTTTTTTTTTTTTTT",
    ],
    doors: [{ dir: "w", kind: "open" }],
  },

  // ============================================================
  // ROW gy=3 — dungeon entrance corridor + side chambers
  // ============================================================
  {
    key: "-1,3",
    gx: -1,
    gy: 3,
    name: "Old Watchpost",
    biome: "dungeon",
    banner: "blue",
    startVisible: false,
    map: [
      "WWWWWWWWWWWWWWW",
      "W..b.......b..W",
      "W..1.X.....X1.W",
      "W.............W",
      "W.A..x.....x.AW",
      "W......G......W",
      "W..o1......c1.D",
      "W.............W",
      "W..bA......bA.W",
      "W..1..X..X.1..W",
      "W....S.....S..W",
      "W.......A.....W",
      "WWWWWWWWWWWWWWW",
    ],
    doors: [{ dir: "e", kind: "open" }],
  },
  {
    key: "0,3",
    gx: 0,
    gy: 3,
    name: "Dungeon Entrance",
    biome: "dungeon",
    banner: "blue",
    startVisible: false,
    map: [
      "WWWWWWWDWWWWWWW",
      "W.............W",
      "W..b...X...b..W",
      "W..1........1.W",
      "W...A......A..W",
      "W......P......W",
      "D....X.....X..D",
      "W......1......W",
      "W..1........1.W",
      "W..b...S...b..W",
      "W...A......A..W",
      "W.............W",
      "WWWWWWWDWWWWWWW",
    ],
    doors: [
      { dir: "n", kind: "open" },
      { dir: "s", kind: "open" },
      { dir: "e", kind: "open" },
      { dir: "w", kind: "open" },
    ],
  },
  {
    key: "1,3",
    gx: 1,
    gy: 3,
    name: "Guard Barracks",
    biome: "dungeon",
    banner: "blue",
    startVisible: false,
    map: [
      "WWWWWWWDWWWWWWW",
      "W..x.......x..W",
      "W..2.X.....X2.W",
      "W.......G.....W",
      "W..2.......2..W",
      "W....X.c.X....W",
      "D.............W",
      "W..2..X.X..2..W",
      "W..o.......o..W",
      "W..1.......1..W",
      "W..b.X.....X.bW",
      "W.....X.X.....W",
      "WWWWWWWWWWWWWWW",
    ],
    doors: [
      { dir: "n", kind: "open" },
      { dir: "w", kind: "open" },
    ],
  },

  // ============================================================
  // ROW gy=2 — main dungeon corridors + branch rooms
  // ============================================================
  {
    key: "-2,2",
    gx: -2,
    gy: 2,
    name: "Forgotten Cell",
    biome: "dungeon",
    banner: "blue",
    startVisible: false,
    map: [
      "WWWWWWWWWWWWWWW",
      "W..x...A...x..W",
      "W..1........1.W",
      "W..b.......b..W",
      "W..A.......A..W",
      "W......h......W",
      "W......G......D",
      "W..1.......1..W",
      "W..b.A...A.b..W",
      "W...X......X..W",
      "W..o...1...o..W",
      "W......A......W",
      "WWWWWWWWWWWWWWW",
    ],
    doors: [{ dir: "e", kind: "open" }],
  },
  {
    key: "-1,2",
    gx: -1,
    gy: 2,
    name: "Armory",
    biome: "dungeon",
    banner: "blue",
    startVisible: false,
    // The armory — LOADED with dropped weapons.
    map: [
      "WWWWWWWDWWWWWWW",
      "W..x...x...x..W",
      "W.2.X.....X.2.W",
      "W...X.....X...W",
      "W.2....X....2.W",
      "W..b.X.c.X.b..W",
      "D......G......D",
      "W..o.X...X.o..W",
      "W.2...Xs.X..2.W",
      "W...X..X..X...W",
      "W..X..1.1..X..W",
      "W..x.X...X.x..W",
      "WWWWWWWWWWWWWWW",
    ],
    doors: [
      { dir: "n", kind: "open" },
      { dir: "e", kind: "open" },
      { dir: "w", kind: "open" },
    ],
  },
  {
    key: "0,2",
    gx: 0,
    gy: 2,
    name: "The Crossing",
    biome: "dungeon",
    banner: "red",
    startVisible: false,
    map: [
      "WWWWWWWDWWWWWWW",
      "W.p.........p.W",
      "W...1.A...A.1.W",
      "W.............W",
      "W....2.....2..W",
      "W..A...1...A..W",
      "D.............D",
      "W..A...1...A..W",
      "W....2.....2..W",
      "W...1.A...A.1.W",
      "W.............W",
      "W.p...A...A.p.W",
      "WWWWWWWDWWWWWWW",
    ],
    doors: [
      { dir: "n", kind: "open" },
      { dir: "s", kind: "open" },
      { dir: "e", kind: "open" },
      { dir: "w", kind: "open" },
    ],
  },
  {
    key: "1,2",
    gx: 1,
    gy: 2,
    name: "Hall of Mages",
    biome: "dungeon",
    banner: "red",
    startVisible: false,
    // Mage hall — books and potions everywhere.
    map: [
      "WWWWWWWDWWWWWWW",
      "W..s.......s..W",
      "W...3.%...%.3.W",
      "W....?.....?..W",
      "W...s..G..s...W",
      "W.....&s&.....W",
      "D......3......W",
      "W.....&s&.....W",
      "W...s..%..s...W",
      "W...3.?...?.3.W",
      "W......&......W",
      "W..s.%.c.%.s..W",
      "WWWWWWWDWWWWWWW",
    ],
    doors: [
      { dir: "n", kind: "open" },
      { dir: "s", kind: "open" },
      { dir: "w", kind: "open" },
    ],
  },

  // ============================================================
  // ROW gy=1 — inner sanctum, treasury, boss-key vault
  // ============================================================
  {
    key: "-1,1",
    gx: -1,
    gy: 1,
    name: "The Treasury",
    biome: "dungeon",
    banner: "blue",
    startVisible: false,
    // Treasury — piled coins (barrels), fallen weapons of dead guards.
    map: [
      "WWWWWWWWWWWWWWW",
      "W..b.i.G.i.b..W",
      "W.X.........X.W",
      "W.....K.......W",
      "W..X.......X..W",
      "W..2.......2..W",
      "W...i..3..i...D",
      "W..2.......2..W",
      "W..2.X...X.2..W",
      "W..h.......c..W",
      "W..X.......X..W",
      "W..B..i.i..B..W",
      "WWWWWWWDWWWWWWW",
    ],
    doors: [
      { dir: "e", kind: "open" },
      { dir: "s", kind: "open" },
    ],
  },
  {
    key: "0,1",
    gx: 0,
    gy: 1,
    name: "Great Hall",
    biome: "dungeon",
    banner: "red",
    startVisible: false,
    map: [
      "WWWWWWWDWWWWWWW",
      "W.p...s...s.p.W",
      "W..2.X...X.2..W",
      "W...1.A.A.1...W",
      "W......3......W",
      "W.....Xs.X....W",
      "D......3......D",
      "W.....X.sX....W",
      "W......3......W",
      "W...1.A.A.1...W",
      "W..2.X...X.2..W",
      "W.p...s...s.p.W",
      "WWWWWWWDWWWWWWW",
    ],
    doors: [
      { dir: "n", kind: "locked" },
      { dir: "s", kind: "open" },
      { dir: "w", kind: "open" },
      { dir: "e", kind: "open" },
    ],
  },
  {
    key: "1,1",
    gx: 1,
    gy: 1,
    name: "Sorcerer's Den",
    biome: "dungeon",
    banner: "red",
    startVisible: false,
    // Sorcerer's den — ice crystals, potion tables, books stacked.
    map: [
      "WWWWWWWWWWWWWWW",
      "W..s.i.G.i.s..W",
      "W...3.....3...W",
      "W....?.&.?....W",
      "W......h......W",
      "W...i..c..i...W",
      "D......s......W",
      "W...3.&.&.3...W",
      "W......3......W",
      "W...s.?.?.s...W",
      "W..3.i...i.3..W",
      "W..s.%...%.s..W",
      "WWWWWWWDWWWWWWW",
    ],
    doors: [
      { dir: "w", kind: "open" },
      { dir: "s", kind: "open" },
    ],
  },

  // ============================================================
  // ROW gy=0 — boss antechamber + throne
  // ============================================================
  {
    key: "0,0",
    gx: 0,
    gy: 0,
    name: "Throne of Bones",
    biome: "dungeon",
    banner: "red",
    startVisible: false,
    // Throne room — pillars, stalagmites flanking a central aisle,
    // the boss dead center, king echo ghost by the throne base.
    map: [
      "WWWWWWWWWWWWWWW",
      "W.p.........p.W",
      "W.A.........A.W",
      "W.............W",
      "W..A.......A..W",
      "W......Z......W",
      "W.............W",
      "W..A.......A..W",
      "W.p....A....p.W",
      "W.............W",
      "W.A....k....A.W",
      "W.............W",
      "WWWWWWWDWWWWWWW",
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

// v4: NPC characters. The special "k" (king echo) is a ghost with a
// throne-room-only dialog, but the builder treats it as a "ghost" kind.
export const NPC_CHARS: Record<string, NpcKind> = {
  N: "villager",
  E: "elder",
  Q: "merchant",
  J: "guard",
  Y: "hermit",
  G: "ghost",
  k: "ghost", // king echo
};

/** Cells the movement system treats as solid (before doors/props are applied). */
export function isSolidChar(ch: string): boolean {
  return (
    ch === "W" || // dungeon wall
    ch === "T" || // tree
    ch === "H" || // house
    ch === "U" || // hut
    ch === "L" || // well
    ch === "M" || // market stall / hill
    ch === "F" || // fence
    ch === "R" || // rock
    ch === "=" || // bridge post
    ch === "$"    // v4: cart (solid)
  );
}
