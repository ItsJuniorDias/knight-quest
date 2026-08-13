import * as THREE from "three";
import { PLAYER } from "../config";
import { findNode } from "../engine/loader";
import type { PlayerData } from "../types";

// ---------------------------------------------------------------------------
// SWORD FX — trail + slash arc + hit sparks.
//
// The KayKit knight already carries a "1H_Sword" mesh in his right hand.
// On every attack we:
//   1. Spawn a soft, fanning arc mesh in front of the knight (a horizontal
//      cone slice, colored by combo index — silver on hit 1, gold on hit 2).
//      Fades out over the swing duration. Zero allocation after warmup.
//   2. Track the tip of the sword through the swing and connect the last N
//      positions with a triangle-strip ribbon — a classic sword trail. The
//      ribbon uses transparent additive blending so it reads on both light
//      and dark backgrounds.
//   3. On confirmed hit (called externally by enemies.ts and boss.ts), we
//      burst chunky bright sparks + a small ring so impacts feel meaty.
//
// The trail and arc live in the same THREE.Group as the knight so they
// inherit his transform; sparks are world-space in the FxSystem.
// ---------------------------------------------------------------------------

const TRAIL_STEPS = 14;
const ARC_SEGMENTS = 22;

interface ArcInstance {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  active: boolean;
}

interface TrailPoint {
  x: number;
  y: number;
  z: number;
  time: number;
}

export class SwordFx {
  private scene: THREE.Scene;
  private arcs: ArcInstance[] = [];
  private trailPoints: TrailPoint[] = [];
  private trailMesh: THREE.Mesh;
  private trailGeom: THREE.BufferGeometry;
  private trailPositions: Float32Array;
  private trailIndices: Uint16Array;
  private trailColors: Float32Array;
  private trailActive = false;
  private trailUntil = 0;
  /** cached ref to the knight's sword mesh (right hand); found on first attack */
  private swordTip: THREE.Object3D | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // pre-allocate a small pool of arc meshes so we never allocate mid-attack
    for (let i = 0; i < 6; i++) {
      const geom = this.buildArcGeometry();
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.arcs.push({ mesh, material: mat, life: 0, maxLife: 1, active: false });
    }

    // trail: a triangle-strip ribbon of TRAIL_STEPS quads (so TRAIL_STEPS*2
    // vertices, 6 indices per quad).
    const vertCount = TRAIL_STEPS * 2;
    this.trailPositions = new Float32Array(vertCount * 3);
    this.trailColors = new Float32Array(vertCount * 4);
    const idxCount = (TRAIL_STEPS - 1) * 6;
    this.trailIndices = new Uint16Array(idxCount);
    for (let i = 0; i < TRAIL_STEPS - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      const off = i * 6;
      this.trailIndices[off + 0] = a;
      this.trailIndices[off + 1] = b;
      this.trailIndices[off + 2] = c;
      this.trailIndices[off + 3] = b;
      this.trailIndices[off + 4] = d;
      this.trailIndices[off + 5] = c;
    }

    this.trailGeom = new THREE.BufferGeometry();
    this.trailGeom.setAttribute("position", new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailGeom.setAttribute("color", new THREE.BufferAttribute(this.trailColors, 4));
    this.trailGeom.setIndex(new THREE.BufferAttribute(this.trailIndices, 1));

    const trailMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.trailMesh = new THREE.Mesh(this.trailGeom, trailMat);
    this.trailMesh.visible = false;
    this.trailMesh.frustumCulled = false;
    scene.add(this.trailMesh);
  }

  /** Build a fan geometry — a wedge that opens along +Z (in front of caster). */
  private buildArcGeometry(): THREE.BufferGeometry {
    const inner = 0.6;
    const outer = PLAYER.attackRange;
    const arc = PLAYER.attackArc;
    const half = arc / 2;
    const positions: number[] = [];
    const indices: number[] = [];

    // build a fan with ARC_SEGMENTS quads across the arc
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
      const t = i / ARC_SEGMENTS;
      const ang = -half + arc * t;
      const cx = Math.sin(ang);
      const cz = Math.cos(ang);
      positions.push(cx * inner, 0.05, cz * inner);
      positions.push(cx * outer, 0.05, cz * outer);
    }
    for (let i = 0; i < ARC_SEGMENTS; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    return geom;
  }

  /**
   * Trigger a swing. `player` provides position + facing. `comboIdx` picks the
   * color: 0 = cold silver-blue, 1 = warm gold. Called from player.startAttack.
   */
  swing(player: PlayerData, comboIdx: 0 | 1): void {
    const arc = this.arcs.find((a) => !a.active);
    if (!arc) return;
    arc.active = true;
    arc.life = 0;
    arc.maxLife = PLAYER.attackDuration * 0.9;
    arc.mesh.visible = true;
    const angle = Math.atan2(player.facing.x, player.facing.z);
    arc.mesh.position.set(player.pos.x, 0.05, player.pos.z);
    arc.mesh.rotation.set(0, angle, 0);
    arc.material.color.setHex(comboIdx === 0 ? 0xa8d8ff : 0xffe08a);
    arc.material.opacity = 0.85;

    // begin tracking the sword tip for this swing
    this.trailPoints.length = 0;
    this.trailActive = true;
    this.trailUntil = performance.now() / 1000 + PLAYER.attackDuration * 1.1;
    (this.trailMesh.material as THREE.MeshBasicMaterial).color.setHex(
      comboIdx === 0 ? 0xa8d8ff : 0xffe08a,
    );
  }

  /**
   * Update per frame. Advances arc fades and rebuilds the trail ribbon from
   * the recent sword-tip positions. `player` is needed to (a) find the sword
   * bone the first time and (b) fall back to a synthesized "in front of the
   * knight" point if the sword mesh isn't reachable.
   */
  update(dt: number, player: PlayerData): void {
    // arcs
    for (const a of this.arcs) {
      if (!a.active) continue;
      a.life += dt;
      const t = a.life / a.maxLife;
      if (t >= 1) {
        a.active = false;
        a.mesh.visible = false;
        continue;
      }
      // fade + slight forward stretch as the arc expands
      a.material.opacity = (1 - t) * 0.85;
      const scale = 0.7 + t * 0.4;
      a.mesh.scale.set(scale, 1, scale);
    }

    // trail
    if (this.trailActive) {
      // find the sword tip. KayKit names the mesh "1H_Sword"; if it's on
      // the knight, its world position sits at the pommel — good enough
      // for the ribbon since the ribbon widens perpendicular.
      if (!this.swordTip || !this.swordTip.parent) {
        this.swordTip = findNode(player.root, "1H_Sword") ?? findNode(player.root, "handslot.r");
      }
      const now = performance.now() / 1000;
      const tip = new THREE.Vector3();
      if (this.swordTip) {
        this.swordTip.getWorldPosition(tip);
        // push the point a little higher up along the blade so the trail
        // reads as coming from the tip, not the wrist
        tip.y += 0.9;
      } else {
        tip.set(
          player.pos.x + player.facing.x * 1.8,
          1.4,
          player.pos.z + player.facing.z * 1.8,
        );
      }
      this.trailPoints.push({ x: tip.x, y: tip.y, z: tip.z, time: now });
      // drop oldest points beyond TRAIL_STEPS
      while (this.trailPoints.length > TRAIL_STEPS) this.trailPoints.shift();

      this.rebuildTrail(player);

      if (now > this.trailUntil) {
        this.trailActive = false;
        // keep the ribbon rendering for one extra frame while it fades out
        window.setTimeout(() => { this.trailMesh.visible = false; }, 120);
      } else {
        this.trailMesh.visible = true;
      }
    }
  }

  private rebuildTrail(player: PlayerData): void {
    const n = this.trailPoints.length;
    if (n < 2) {
      this.trailMesh.visible = false;
      return;
    }
    // width perpendicular to the swing plane — we approximate the swing
    // normal as the horizontal facing direction (rotated 90°)
    const perpX = -player.facing.z;
    const perpZ = player.facing.x;

    // zero out unused verts so we don't render garbage from previous frames
    for (let i = 0; i < TRAIL_STEPS; i++) {
      const off = i * 2 * 3;
      if (i >= n) {
        this.trailPositions[off + 0] = 0;
        this.trailPositions[off + 1] = -100;
        this.trailPositions[off + 2] = 0;
        this.trailPositions[off + 3] = 0;
        this.trailPositions[off + 4] = -100;
        this.trailPositions[off + 5] = 0;
        continue;
      }
      const p = this.trailPoints[i];
      // width tapers from 0.55 at newest → 0.08 at oldest
      const t = i / (TRAIL_STEPS - 1);
      const width = 0.55 * (0.15 + t * 0.85);
      this.trailPositions[off + 0] = p.x - perpX * width;
      this.trailPositions[off + 1] = p.y;
      this.trailPositions[off + 2] = p.z - perpZ * width;
      this.trailPositions[off + 3] = p.x + perpX * width;
      this.trailPositions[off + 4] = p.y;
      this.trailPositions[off + 5] = p.z + perpZ * width;

      // opacity fades from 1 (newest) to 0 (oldest)
      const alpha = t;
      const colOff = i * 2 * 4;
      // color is a pale yellow-white; alpha does the fading
      this.trailColors[colOff + 0] = 1;
      this.trailColors[colOff + 1] = 1;
      this.trailColors[colOff + 2] = 1;
      this.trailColors[colOff + 3] = alpha * 0.85;
      this.trailColors[colOff + 4] = 1;
      this.trailColors[colOff + 5] = 1;
      this.trailColors[colOff + 6] = 1;
      this.trailColors[colOff + 7] = alpha * 0.85;
    }
    (this.trailGeom.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.trailGeom.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    this.trailGeom.computeBoundingSphere();
  }
}
