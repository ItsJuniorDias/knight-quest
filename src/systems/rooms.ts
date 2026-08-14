import * as THREE from "three";
import { RENDER, ROOM_H, ROOM_W, TILE } from "../config";
import { sfx } from "../engine/audio";
import type { DoorDir, GameEvents, PlayerData, RoomRuntime } from "../types";
import { dirDelta, doorTile } from "../world/dungeon";

// ---------------------------------------------------------------------------
// Rooms — owns "which room are we in", door transitions, and the combat lock.
//
// Transition flow: player walks through a door cell past the shared wall
// line -> we switch currentRoom, start the camera slide, gently auto-walk the
// player a step into the new room, then (if the room has living enemies and
// isn't cleared) drop the portcullis on every door.
// ---------------------------------------------------------------------------

interface GateAnim {
  gate: THREE.Object3D;
  targetY: number;
}

export class RoomManager {
  rooms: Map<string, RoomRuntime>;
  current: RoomRuntime;
  private gateAnims: GateAnim[] = [];
  private events: GameEvents;
  /** while > 0, gameplay input is frozen (room slide in progress) */
  transitionLock = 0;
  private autoWalkDir: { x: number; z: number } | null = null;
  pendingSpawn: RoomRuntime | null = null;
  /**
   * v12: cache the room key we last computed visibility for. `updateRoomVisibility`
   * used to iterate every room every frame; now it only runs when we actually
   * move to a new room. Saves ~0.3ms/frame on mobile with 26 rooms.
   */
  private lastVisibilityRoom: string | null = null;

  constructor(
    rooms: Map<string, RoomRuntime>,
    startKey: string,
    events: GameEvents,
  ) {
    this.rooms = rooms;
    const start = rooms.get(startKey);
    if (!start) throw new Error(`missing start room ${startKey}`);
    this.current = start;
    this.current.visited = true;
    this.events = events;
  }

  /** Which door (if any) the player's position has crossed out of the room. */
  private crossedDoor(p: THREE.Vector3): DoorDir | null {
    const r = this.current;
    const minX = r.origin.x;
    const maxX = r.origin.x + ROOM_W * TILE;
    const minZ = r.origin.z;
    const maxZ = r.origin.z + ROOM_H * TILE;
    if (p.z < minZ) return "n";
    if (p.z > maxZ) return "s";
    if (p.x < minX) return "w";
    if (p.x > maxX) return "e";
    return null;
  }

  /** True if the door in that direction can be traversed right now. */
  doorPassable(dir: DoorDir): boolean {
    const door = this.current.doors.find((d) => d.dir === dir);
    if (!door) return false;
    if (door.gateClosed) return false;
    return true;
  }

  /**
   * Extra collision for door lines: when a door is gated/locked shut, the
   * door cell must act solid. We fake it by clamping the player inside.
   */
  clampAtClosedDoors(p: THREE.Vector3, radius: number): void {
    const r = this.current;
    const minX = r.origin.x + 0.5 + radius;
    const maxX = r.origin.x + ROOM_W * TILE - 0.5 - radius;
    const minZ = r.origin.z + 0.5 + radius;
    const maxZ = r.origin.z + ROOM_H * TILE - 0.5 - radius;
    for (const dir of ["n", "s", "w", "e"] as DoorDir[]) {
      if (this.doorPassable(dir)) continue;
      if (dir === "n" && p.z < minZ) p.z = minZ;
      if (dir === "s" && p.z > maxZ) p.z = maxZ;
      if (dir === "w" && p.x < minX) p.x = minX;
      if (dir === "e" && p.x > maxX) p.x = maxX;
    }
  }

  /**
   * v11: aggressive culling — hide every room farther than
   * RENDER.roomRenderDistance grid cells from the current one.
   * Shared perimeter walls stay in sharedStatics so nothing looks
   * broken; only interior props / enemies / decor stop being drawn.
   * This is the single biggest FPS win at 19+ rooms.
   */
  private updateRoomVisibility(): void {
    // v12: early-out when nothing has changed. Iterating 26 rooms + writing
    // their .visible field triggers world-matrix invalidations on every
    // group child. Only pay that cost the frame we actually cross a door.
    if (this.lastVisibilityRoom === this.current.key) return;
    this.lastVisibilityRoom = this.current.key;
    const cx = this.current.gx;
    const cy = this.current.gy;
    const d = RENDER.roomRenderDistance;
    for (const [, r] of this.rooms) {
      const dx = Math.abs(r.gx - cx);
      const dy = Math.abs(r.gy - cy);
      const inRange = dx <= d && dy <= d;
      // never hide rooms that have never been visited AND are inRange (they'll
      // just re-appear when the player crosses their door — same as before);
      // for visited rooms, use inRange as the sole visibility rule.
      if (r.visited) {
        r.group.visible = inRange;
      } else {
        r.group.visible = false;
      }
    }
  }

  update(
    dt: number,
    player: PlayerData,
    cam: { beginSlide(a: RoomRuntime, b: RoomRuntime, p: THREE.Vector3): void },
  ): void {
    this.updateRoomVisibility();
    // animate portcullises
    for (let i = this.gateAnims.length - 1; i >= 0; i--) {
      const g = this.gateAnims[i];
      const dy = g.targetY - g.gate.position.y;
      const step = 6.5 * dt;
      if (Math.abs(dy) <= step) {
        g.gate.position.y = g.targetY;
        this.gateAnims.splice(i, 1);
      } else {
        g.gate.position.y += Math.sign(dy) * step;
      }
    }

    // auto-walk during transition
    if (this.transitionLock > 0) {
      this.transitionLock -= dt;
      if (this.autoWalkDir) {
        player.pos.x += this.autoWalkDir.x * 4.4 * dt;
        player.pos.z += this.autoWalkDir.z * 4.4 * dt;
      }
      if (this.transitionLock <= 0) {
        this.autoWalkDir = null;
        this.maybeLockCombat();
      }
      return;
    }

    const crossed = this.crossedDoor(player.pos);
    if (crossed) {
      const d = dirDelta(crossed);
      const next = this.rooms.get(
        `${this.current.gx + d.dx},${this.current.gy + d.dy}`,
      );
      if (!next) {
        // safety: shove back inside
        player.pos.x -= d.dx * 0.5;
        player.pos.z -= d.dy * 0.5;
        return;
      }
      const prev = this.current;
      this.current = next;
      next.visited = true;
      // Reveal the room as we step into it. Villages/forest edges may already
      // be visible via startVisible; this makes the visibility rule uniform.
      next.group.visible = true;
      cam.beginSlide(prev, next, player.pos);
      this.transitionLock = 0.62;
      this.autoWalkDir = { x: d.dx, z: d.dy };
      this.pendingSpawn =
        !next.cleared && (next.enemySpawns.length > 0 || next.hasBoss)
          ? next
          : null;
      this.events.onRoomChanged(next.key);
    }
  }

  /** Called after the slide finishes: drop gates if a fight is pending. */
  private maybeLockCombat(): void {
    const r = this.current;
    if (r.cleared) return;
    if (r.enemySpawns.length === 0 && !r.hasBoss) return;
    for (const door of r.doors) {
      if (door.gate) {
        door.gateClosed = true;
        this.gateAnims.push({ gate: door.gate, targetY: 0 });
      }
    }
    sfx.gateClose();
  }

  /** Called by combat systems when the room's last enemy dies. */
  clearRoom(room: RoomRuntime): void {
    room.cleared = true;
    for (const door of room.doors) {
      if (door.kind === "locked" && !door.unlocked) continue; // stays shut
      if (door.gate) {
        door.gateClosed = false;
        this.gateAnims.push({ gate: door.gate, targetY: -4.05 });
      }
    }
    sfx.gateOpen();
    this.events.onToast("Room cleared!");
  }

  /** Player pressed interact near the locked boss door with the key. */
  tryUnlockNearbyDoor(player: PlayerData): boolean {
    const r = this.current;
    for (const door of r.doors) {
      if (door.kind !== "locked" || door.unlocked) continue;
      const t = doorTile(door.dir);
      const c = new THREE.Vector3(
        r.origin.x + (t.tx + 0.5) * TILE,
        0,
        r.origin.z + (t.tz + 0.5) * TILE,
      );
      if (c.distanceTo(player.pos) < TILE * 1.15) {
        if (!player.hasBossKey) {
          this.events.onToast("It's locked... find the Boss Key!");
          return false;
        }
        player.hasBossKey = false;
        door.unlocked = true;
        door.gateClosed = false;
        if (door.gate) this.gateAnims.push({ gate: door.gate, targetY: -4.05 });
        if (door.lockIcon) door.lockIcon.visible = false;
        sfx.doorUnlock();
        this.events.onToast("The Boss Door opens!");
        this.events.onGameEvent("unlocked:bossdoor");
        this.events.onHudDirty();
        return true;
      }
    }
    return false;
  }
}
