// ---------------------------------------------------------------------------
// THE DUNGEON — pure data, no three.js. Testable in plain node.
//
// v3 layout: 17 rooms across 3 biomes (village + forest + dungeon) on a
// 15x13 tile grid. Compared to v2 this version:
//   • lays out the village as a rich hub with 8 named NPCs (blacksmith,
//     tavern keeper, elder, priestess, merchants, farmer, child) so the
//     first minutes of the game are a busy overworld, not an empty park;
//   • sprinkles hermit / villager NPCs across the surrounding forest rooms;
//   • fills every dungeon room with a "ghost of ___" NPC — flavor for the
//     story director and one-shot narrative beats;
//   • roughly triples the enemy density in the dungeon (Zelda-ish waves of
//     3-6 per room, mixed kinds, with rogues + mages guarding key rooms).
//
// Legend (shared):
//   W wall            . floor           D door cell (must sit on the edge,
//   P player start                        centered, and match `doors` below)
//   1 minion spawn    2 rogue spawn     3 mage spawn      Z boss spawn
//   b barrel small    B barrel large    x crates          o box
//   c chest (coins)   K gold chest (BOSS KEY)             h chest (heart)
//   s spike trap      p pillar          t torch (unused; auto-mount)
//   S stairs decor
//
// Village legend extras (biome=village|forest):
//   H house      U hut         L well       T tree       F fence
//   f flowers    g bushes/tall grass        R rock       O log
//   M market stall     C campfire   ~ stream water        = bridge post
//   r roadsign         P player start   , dirt road   . grass floor
//
// NPC chars (added v3 — same for village/forest/dungeon):
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
// Doors sit exactly in the middle of each edge (tile 7 horizontally,
// tile 6 vertically).

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
      "T.gggT.......TT",
      "Tg..fgg.f.gg.TT",
      "T.gggT..fggg.TT",
      "T.f...gT......T",
      "Tgg.g.fY..gg..T",
      "T.f.gg.g.g.f..T",
      "T..g.f..g.f.g.T",
      "Tg..gg.gg..gg.T",
      "T.fg.f..f.gg..T",
      "TT..gg.g..f..TT",
      "TT.f..gg.gg..TT",
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
      "Tg.f.gg.f..g.gT",
      "T.gg.f.gg.f.g.T",
      "T.f..ggN.g.f.gT",
      "Tgg.f.gg.f.gg.T",
      "T.g..g.f.gg.f.D",
      "Tf.gg.f.gg.g.gT",
      "T.g.f.gg.gN.g.T",
      "Tg.gg.f..gg.g.T",
      "T.f.gg.gg..f.gT",
      "Tg..f..g.gg.f.T",
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
    // v3 village layout — 8 NPCs total, arranged so the elder is dead
    // center and the merchants flank the east/west roads.
    //   J = blacksmith at west edge         N = tavern keeper east
    //   Q = west merchant     Q = east fruit-seller
    //   E = Elder Alden (center-south of the campfire)
    //   N = child running near the road
    //   N = priestess by the well
    //   N = farmer at the SE corner
    map: [
      "TTTTTTTDTTTTTTT",
      "T.fg.H.,.H.gg.T",
      "T.J.f..,...N..T",
      "T.gg.,,,,,.gg.T",
      "T.f.,,C,,,N.f.T",
      "T.Q.,,,,,,,.Q.T",
      "D,,,,,P,E,,,,,D",
      "T.f.,,,,,,,.f.T",
      "T.gg.,,L,N,.g.T",
      "T.f...,,,..fggT",
      "Tg.H..,,..H.f.T",
      "T.fg.U.,.gg.NgT",
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
      "Tf..gg.f..g.f.T",
      "T.gg.f.gg.fN.gT",
      "T.f...gg.f.gg.T",
      "Tgg.f.g..gg.f.T",
      "D.g..gg.f..g.gT",
      "Tf.gg.f.gg.f..T",
      "T.gN.f..gg.g.gT",
      "Tg.gg.gg..f.f.T",
      "T.f.gg.g.gg.g.T",
      "Tg..f..gg..f..T",
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
      "W..1........1.W",
      "W.............W",
      "W....x.....x..W",
      "W......G......W",
      "W..o1......c1.D",
      "W.............W",
      "W..b...1...b..W",
      "W..1.......1..W",
      "W....S.....S..W",
      "W.............W",
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
      "W..b.......b..W",
      "W..1........1.W",
      "W.............W",
      "W......P......W",
      "D.............D",
      "W......1......W",
      "W..1........1.W",
      "W..b...S...b..W",
      "W.............W",
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
      "W..2........2.W",
      "W.......G.....W",
      "W..2.......2..W",
      "W......c......W",
      "D.............W",
      "W..2.......2..W",
      "W..o.......o..W",
      "W..1.......1..W",
      "W..b.......b..W",
      "W.............W",
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
      "W..x.......x..W",
      "W..1........1.W",
      "W..b.......b..W",
      "W.............W",
      "W......h......W",
      "W......G......D",
      "W..1.......1..W",
      "W..b.......b..W",
      "W.............W",
      "W..o...1...o..W",
      "W.............W",
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
    map: [
      "WWWWWWWDWWWWWWW",
      "W..x...x...x..W",
      "W.2.........2.W",
      "W.............W",
      "W.2.........2.W",
      "W..b...c...b..W",
      "D......G......D",
      "W..o.......o..W",
      "W.2....s....2.W",
      "W.............W",
      "W.....1.1.....W",
      "W..x.......x..W",
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
      "W...1.....1...W",
      "W.............W",
      "W....2.....2..W",
      "W......1......W",
      "D.............D",
      "W......1......W",
      "W....2.....2..W",
      "W...1.....1...W",
      "W.............W",
      "W.p.........p.W",
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
    map: [
      "WWWWWWWDWWWWWWW",
      "W..s.......s..W",
      "W...3.....3...W",
      "W.............W",
      "W...s..G..s...W",
      "W......s......W",
      "D......3......W",
      "W......s......W",
      "W...s.....s...W",
      "W...3.....3...W",
      "W.............W",
      "W..s...c...s..W",
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
    map: [
      "WWWWWWWWWWWWWWW",
      "W..b...G...b..W",
      "W.............W",
      "W.....K.......W",
      "W.............W",
      "W..2.......2..W",
      "W......3......D",
      "W..2.......2..W",
      "W..2.......2..W",
      "W..h.......c..W",
      "W.............W",
      "W..B.......B..W",
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
      "W..2.......2..W",
      "W...1.....1...W",
      "W......3......W",
      "W......s......W",
      "D......3......D",
      "W......s......W",
      "W......3......W",
      "W...1.....1...W",
      "W..2.......2..W",
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
    map: [
      "WWWWWWWWWWWWWWW",
      "W..s...G...s..W",
      "W...3.....3...W",
      "W.............W",
      "W......h......W",
      "W......c......W",
      "D......s......W",
      "W...3.....3...W",
      "W......3......W",
      "W...s.....s...W",
      "W..3.......3..W",
      "W..s.......s..W",
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
    map: [
      "WWWWWWWWWWWWWWW",
      "W.p.........p.W",
      "W.............W",
      "W.............W",
      "W.............W",
      "W......Z......W",
      "W.............W",
      "W.............W",
      "W.p.........p.W",
      "W.............W",
      "W......k......W",
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

// v3: NPC characters. The special "k" (king echo) is a ghost with a
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
    ch === "M" || // market stall
    ch === "F" || // fence
    ch === "R" || // rock
    ch === "="    // bridge post
  );
}
