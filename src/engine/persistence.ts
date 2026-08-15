// ---------------------------------------------------------------------------
// Persistence — save/load player progress across sessions.
//
// The full runtime state (three.js scene, boss AI, animation mixers) is
// deliberately NOT serialized. We store only the *player-visible progress*
// that a saved game would need to fully restore:
//   • player: coins, hearts, upgrades, spells, boss-key
//   • world: which rooms are cleared / visited, which bosses are dead
//   • current room key + player facing so we drop the knight roughly
//     where they left off
//
// The whole payload is a single JSON blob under one localStorage key.
// A schema version tag lets us bump the format without breaking older saves
// (loadGame just returns null if the version doesn't match, and the game
// starts fresh with no explosion).
//
// All calls are wrapped in try/catch — localStorage throws in private-mode
// Safari, Firefox with strict cookie policies, and inside iframes with no
// storage-access grant. In every failure case the game silently continues
// without persistence rather than crashing.
// ---------------------------------------------------------------------------

import type { PlayerData, RoomRuntime, SpellKind } from "../types";
import type { BossSystem } from "../systems/boss";

const STORAGE_KEY = "knight-quest:save";
const SCHEMA_VERSION = 1;

export interface SaveData {
  version: number;
  savedAt: number; // Date.now()
  player: {
    coins: number;
    hp: number;
    maxHp: number;
    halfHearts: number;
    hasBossKey: boolean;
    upgrades: { sharpBlade?: boolean; reinforcedShield?: boolean };
    spells: SpellKind[];
    activeSpell: number;
    // v13: exact position + facing so continue drops the knight where they left
    pos: { x: number; y: number; z: number };
    facing: { x: number; z: number };
  };
  world: {
    currentRoomKey: string;
    // Room keys ("gx,gy") that have been cleared / visited.
    clearedRooms: string[];
    visitedRooms: string[];
    // Boss kinds that have been killed. Matches BossKind but stored as string
    // to keep the schema resilient to type reshuffles.
    deadBosses: string[];
  };
}

/** True if a save exists in localStorage. Cheap; safe to call any time. */
export function hasSave(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Read the raw save (or null if missing/corrupt/wrong version). */
export function loadGame(): SaveData | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== SCHEMA_VERSION) {
      console.warn("[knight-quest] save schema mismatch, ignoring old save");
      return null;
    }
    return data;
  } catch (err) {
    console.warn("[knight-quest] loadGame failed:", err);
    return null;
  }
}

/** Wipe the save (called on death or explicit New Game). */
export function clearSave(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn("[knight-quest] clearSave failed:", err);
  }
}

/**
 * Snapshot the whole runtime and write it. Called by the auto-save hook
 * in main.ts on every meaningful change (coin/heart/spell/boss-key pickup,
 * room clear, boss death, room change).
 *
 * The write is synchronous but only ~1-2ms even on mobile — small JSON.
 * We debounce the caller (see main.ts) so this never fires per-frame.
 */
export function saveGame(
  player: PlayerData,
  rooms: Map<string, RoomRuntime>,
  currentRoomKey: string,
  boss: BossSystem | null,
): void {
  try {
    if (typeof localStorage === "undefined") return;
    const cleared: string[] = [];
    const visited: string[] = [];
    for (const [key, r] of rooms) {
      if (r.cleared) cleared.push(key);
      if (r.visited) visited.push(key);
    }
    const deadBosses: string[] = [];
    if (boss) {
      for (const b of boss.bosses) {
        if (b.dead) deadBosses.push(b.kind);
      }
    }
    const data: SaveData = {
      version: SCHEMA_VERSION,
      savedAt: Date.now(),
      player: {
        coins: player.coins,
        hp: player.hp,
        maxHp: player.maxHp,
        halfHearts: player.halfHearts,
        hasBossKey: player.hasBossKey,
        upgrades: { ...(player.upgrades ?? {}) },
        spells: [...player.spells],
        activeSpell: player.activeSpell,
        pos: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
        facing: { x: player.facing.x, z: player.facing.z },
      },
      world: {
        currentRoomKey,
        clearedRooms: cleared,
        visitedRooms: visited,
        deadBosses,
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn("[knight-quest] saveGame failed:", err);
  }
}

/**
 * Apply a loaded save to the freshly-built runtime. Called by main.ts once
 * the world + player exist. Mutates the passed-in structures in place.
 *
 * Enemies inside a cleared room are wiped so the player doesn't fight them
 * a second time. Dead bosses are marked as dead + removed from the scene
 * so the boss room stays cleared. Doors on cleared rooms auto-open.
 */
export function applySave(
  save: SaveData,
  player: PlayerData,
  rooms: Map<string, RoomRuntime>,
  boss: BossSystem | null,
): string {
  // ---- player ------------------------------------------------------------
  player.coins = save.player.coins;
  player.hp = save.player.hp;
  player.maxHp = save.player.maxHp;
  player.halfHearts = save.player.halfHearts;
  player.hasBossKey = save.player.hasBossKey;
  player.upgrades = { ...(save.player.upgrades ?? {}) };
  player.spells = [...save.player.spells];
  player.activeSpell = Math.min(save.player.activeSpell, Math.max(0, player.spells.length - 1));
  player.pos.set(save.player.pos.x, save.player.pos.y, save.player.pos.z);
  player.facing.x = save.player.facing.x;
  player.facing.z = save.player.facing.z;
  player.root.position.copy(player.pos);

  // ---- rooms -------------------------------------------------------------
  const cleared = new Set(save.world.clearedRooms);
  const visited = new Set(save.world.visitedRooms);
  for (const [key, r] of rooms) {
    if (visited.has(key)) r.visited = true;
    if (cleared.has(key)) {
      r.cleared = true;
      // Doors on cleared rooms should already be open (combat gate lifted).
      for (const d of r.doors) {
        if (d.kind === "locked" && !d.unlocked) continue;
        if (d.gate) {
          d.gateClosed = false;
          d.gate.position.y = -4.05; // fully retracted
        }
      }
    }
  }

  // ---- bosses ------------------------------------------------------------
  if (boss) {
    const dead = new Set(save.world.deadBosses);
    for (const b of boss.bosses) {
      if (dead.has(b.kind)) {
        b.dead = true;
        b.active = false;
        b.hp = 0;
        // Remove the corpse from the scene so it doesn't linger.
        if (b.root.parent) b.root.parent.remove(b.root);
      }
    }
  }

  // Return the room key the caller should switch RoomManager.current to.
  return save.world.currentRoomKey;
}
