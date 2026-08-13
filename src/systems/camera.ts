import * as THREE from "three";
import { RENDER, ROOM_H, ROOM_W, TILE } from "../config";
import type { RoomRuntime } from "../types";

// ---------------------------------------------------------------------------
// Camera — 3/4 top-down, follows the player but never shows past the walls
// of the current room. Crossing a door glides the view to the next room
// (the classic Zelda room-slide) while gameplay is frozen by rooms.ts.
// ---------------------------------------------------------------------------

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private slideFrom = new THREE.Vector3();
  private slideTo = new THREE.Vector3();
  private slideT = -1; // <0 = not sliding

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(RENDER.camFov, aspect, 0.5, 220);
  }

  private clampToRoom(p: THREE.Vector3, room: RoomRuntime, out: THREE.Vector3): void {
    // keep the look-at point inside a margin so walls hug the screen edges
    const marginX = ROOM_W * TILE * 0.24;
    const marginZ = ROOM_H * TILE * 0.2;
    const minX = room.origin.x + marginX;
    const maxX = room.origin.x + ROOM_W * TILE - marginX;
    const minZ = room.origin.z + marginZ;
    const maxZ = room.origin.z + ROOM_H * TILE - marginZ;
    out.set(
      Math.min(Math.max(p.x, minX), maxX),
      0,
      Math.min(Math.max(p.z, minZ), maxZ),
    );
  }

  snap(playerPos: THREE.Vector3, room: RoomRuntime): void {
    this.clampToRoom(playerPos, room, this.lookAt);
    this.target.copy(this.lookAt);
    this.place(1);
  }

  beginSlide(fromRoom: RoomRuntime, toRoom: RoomRuntime, playerPos: THREE.Vector3): void {
    this.clampToRoom(playerPos, fromRoom, this.slideFrom);
    this.clampToRoom(playerPos, toRoom, this.slideTo);
    this.slideFrom.copy(this.lookAt);
    this.slideT = 0;
  }

  get sliding(): boolean {
    return this.slideT >= 0;
  }

  update(dt: number, playerPos: THREE.Vector3, room: RoomRuntime): void {
    if (this.slideT >= 0) {
      this.slideT += dt / RENDER.roomSlideTime;
      const t = Math.min(1, this.slideT);
      const e = t * t * (3 - 2 * t); // smoothstep
      this.clampToRoom(playerPos, room, this.slideTo);
      this.lookAt.lerpVectors(this.slideFrom, this.slideTo, e);
      if (t >= 1) this.slideT = -1;
    } else {
      this.clampToRoom(playerPos, room, this.target);
      const k = 1 - Math.exp(-RENDER.camLerp * dt);
      this.lookAt.lerp(this.target, k);
    }
    this.place(1);
  }

  private place(_scale: number): void {
    const el = RENDER.camElevation;
    const d = RENDER.camDistance;
    this.camera.position.set(
      this.lookAt.x,
      Math.sin(el) * d,
      this.lookAt.z + Math.cos(el) * d,
    );
    this.camera.lookAt(this.lookAt.x, 0, this.lookAt.z);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
