import * as THREE from "three";
import { RENDER, ROOM_H, ROOM_W, TILE } from "../config";
import type { RoomRuntime } from "../types";

// ---------------------------------------------------------------------------
// Camera — BOTW-flavored third-person chase cam.
//
// The camera sits BEHIND and ABOVE the knight and looks slightly ahead of
// him, so the horizon fills the frame and the knight rides the lower third.
// It doesn't rotate with the player (WASD/joystick stays intuitive) — the
// world is always oriented with north = up-screen. Room transitions get a
// soft slide via beginSlide(); day-to-day movement is a plain lerp.
//
// Compared to the previous version, this cam:
//   • uses a fixed world-aligned rig (no per-room clamp — the room is now
//     big enough to breathe, and the visibility system in rooms.ts hides
//     unvisited rooms so nothing leaks in from the north);
//   • looks slightly ahead of the player (RENDER.camLookAhead) so what's
//     in front of the knight gets more screen than what's behind him;
//   • uses a shallower elevation, so vertical walls read as walls (not
//     patterned squares) and give the game a proper 3D feel.
// ---------------------------------------------------------------------------

export class CameraRig {
  camera: THREE.PerspectiveCamera;

  /** The point we currently look at. */
  private lookAt = new THREE.Vector3();
  /** The point we want to look at (based on player position + look-ahead). */
  private target = new THREE.Vector3();

  /** Room-slide interpolation. */
  private slideFrom = new THREE.Vector3();
  private slideTo = new THREE.Vector3();
  private slideT = -1; // <0 = not sliding

  /** Smoothed facing (so look-ahead doesn't snap when the knight turns). */
  private facing = new THREE.Vector3(0, 0, -1);

  /** Screen-shake amplitude (world units). Decays exponentially. */
  private shakeAmp = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(RENDER.camFov, aspect, 0.5, 260);
  }

  /**
   * Add a burst of screen-shake. Called by combat systems on sword hits,
   * boss chop landing, etc. Higher `strength` = more violent.
   */
  shake(strength: number): void {
    // additive but capped so a hit-storm doesn't turn the screen into porridge
    this.shakeAmp = Math.min(1.6, this.shakeAmp + strength);
  }

  /**
   * Where the camera would like the "look at" point to be, given the player's
   * position and facing. We push the point slightly in the direction the
   * player is heading so more of the world ahead is visible.
   */
  private computeTarget(playerPos: THREE.Vector3, facing: THREE.Vector3, out: THREE.Vector3): void {
    out.set(
      playerPos.x + facing.x * RENDER.camLookAhead,
      0,
      playerPos.z + facing.z * RENDER.camLookAhead,
    );
  }

  snap(playerPos: THREE.Vector3, _room: RoomRuntime, facing?: { x: number; z: number }): void {
    if (facing) this.facing.set(facing.x, 0, facing.z).normalize();
    this.computeTarget(playerPos, this.facing, this.lookAt);
    this.target.copy(this.lookAt);
    this.place();
  }

  beginSlide(_fromRoom: RoomRuntime, toRoom: RoomRuntime, playerPos: THREE.Vector3): void {
    // For the slide we bias the destination toward the room center a bit,
    // so the camera glides into the new space instead of hugging the door.
    this.computeTarget(playerPos, this.facing, this.slideFrom);
    this.slideFrom.copy(this.lookAt);

    const cx = toRoom.origin.x + (ROOM_W * TILE) / 2;
    const cz = toRoom.origin.z + (ROOM_H * TILE) / 2;
    this.slideTo.set(
      THREE.MathUtils.lerp(playerPos.x, cx, 0.35),
      0,
      THREE.MathUtils.lerp(playerPos.z, cz, 0.35),
    );
    this.slideT = 0;
  }

  get sliding(): boolean {
    return this.slideT >= 0;
  }

  update(dt: number, playerPos: THREE.Vector3, room: RoomRuntime, facing?: { x: number; z: number }): void {
    // smooth the facing so quick 180s don't snap the look-ahead
    if (facing && (facing.x !== 0 || facing.z !== 0)) {
      const desired = new THREE.Vector3(facing.x, 0, facing.z);
      if (desired.lengthSq() > 1e-6) {
        desired.normalize();
        const k = 1 - Math.exp(-6 * dt);
        this.facing.lerp(desired, k).normalize();
      }
    }

    if (this.slideT >= 0) {
      this.slideT += dt / RENDER.roomSlideTime;
      const t = Math.min(1, this.slideT);
      const e = t * t * (3 - 2 * t); // smoothstep
      // keep the destination target updated as the player walks in
      this.computeTarget(playerPos, this.facing, this.slideTo);
      this.lookAt.lerpVectors(this.slideFrom, this.slideTo, e);
      if (t >= 1) this.slideT = -1;
    } else {
      this.computeTarget(playerPos, this.facing, this.target);
      const k = 1 - Math.exp(-RENDER.camLerp * dt);
      this.lookAt.lerp(this.target, k);
    }
    // decay screen shake (~8 half-lives / second — punchy but doesn't linger)
    this.shakeAmp *= Math.exp(-6 * dt);
    if (this.shakeAmp < 0.005) this.shakeAmp = 0;
    void room;
    this.place();
  }

  private place(): void {
    const el = RENDER.camElevation;
    const d = RENDER.camDistance;
    // shake — random offset around the look-at + a matching lookAt jitter.
    // We use fresh Math.random per axis so the offset is truly noisy, not
    // sinusoidal (a rotation would swim, a jitter feels like impact).
    const s = this.shakeAmp;
    const jx = s ? (Math.random() - 0.5) * s : 0;
    const jz = s ? (Math.random() - 0.5) * s : 0;
    const jy = s ? (Math.random() - 0.5) * s * 0.5 : 0;
    // World-axis-aligned: camera sits south of the look-at point and above.
    this.camera.position.set(
      this.lookAt.x + jx,
      Math.sin(el) * d + jy,
      this.lookAt.z + Math.cos(el) * d + jz,
    );
    this.camera.lookAt(this.lookAt.x + jx * 0.3, 0.5 + jy * 0.3, this.lookAt.z + jz * 0.3);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
