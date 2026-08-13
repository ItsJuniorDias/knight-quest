import type * as THREE from "three";
import { ROOM_H, ROOM_W, TILE } from "../config";
import type { RoomRuntime } from "../types";

// ---------------------------------------------------------------------------
// Physics — deliberately boring. Circle vs. solid tile grid, resolved per
// axis, plus circle-circle pushes for dynamic blockers (barrels). No physics
// engine: deterministic, cheap, and impossible to explode.
// ---------------------------------------------------------------------------

function solidAtWorld(room: RoomRuntime, x: number, z: number): boolean {
  const tx = Math.floor((x - room.origin.x) / TILE);
  const tz = Math.floor((z - room.origin.z) / TILE);
  if (tx < 0 || tz < 0 || tx >= ROOM_W || tz >= ROOM_H) return true;
  return room.solid[tz][tx];
}

function circleHitsGrid(room: RoomRuntime, x: number, z: number, r: number): boolean {
  // sample the circle's extremes + center; tiles are 4 units so this is plenty
  return (
    solidAtWorld(room, x - r, z) ||
    solidAtWorld(room, x + r, z) ||
    solidAtWorld(room, x, z - r) ||
    solidAtWorld(room, x, z + r) ||
    solidAtWorld(room, x - r * 0.71, z - r * 0.71) ||
    solidAtWorld(room, x + r * 0.71, z - r * 0.71) ||
    solidAtWorld(room, x - r * 0.71, z + r * 0.71) ||
    solidAtWorld(room, x + r * 0.71, z + r * 0.71)
  );
}

/**
 * Moves pos by vel*dt, sliding along solid tiles. Also pushes out of barrel
 * colliders. Mutates pos. Returns true if any wall contact happened.
 */
export function moveCircle(
  pos: THREE.Vector3,
  vel: THREE.Vector3,
  dt: number,
  radius: number,
  room: RoomRuntime,
  blockers?: { pos: THREE.Vector3; radius: number }[],
): boolean {
  let hit = false;

  const nx = pos.x + vel.x * dt;
  if (!circleHitsGrid(room, nx, pos.z, radius)) {
    pos.x = nx;
  } else {
    hit = true;
  }

  const nz = pos.z + vel.z * dt;
  if (!circleHitsGrid(room, pos.x, nz, radius)) {
    pos.z = nz;
  } else {
    hit = true;
  }

  if (blockers) {
    for (const b of blockers) {
      const dx = pos.x - b.pos.x;
      const dz = pos.z - b.pos.z;
      const min = radius + b.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-6 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = (min - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
        hit = true;
      }
    }
  }
  return hit;
}

/** Soft push between two entities so they don't overlap. Mutates both. */
export function separate(
  a: { pos: THREE.Vector3; radius: number },
  b: { pos: THREE.Vector3; radius: number },
  strengthA = 0.5,
): void {
  const dx = a.pos.x - b.pos.x;
  const dz = a.pos.z - b.pos.z;
  const min = a.radius + b.radius;
  const d2 = dx * dx + dz * dz;
  if (d2 < 1e-6 || d2 >= min * min) return;
  const d = Math.sqrt(d2);
  const overlap = min - d;
  const px = (dx / d) * overlap;
  const pz = (dz / d) * overlap;
  a.pos.x += px * strengthA;
  a.pos.z += pz * strengthA;
  b.pos.x -= px * (1 - strengthA);
  b.pos.z -= pz * (1 - strengthA);
}

export function dist2(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
