import * as THREE from "three";
import { PLAYER } from "../config";

// ---------------------------------------------------------------------------
// SWORD FX — three things fire on every attack, driven by main.ts events:
//
//   1. A crescent SLASH arc mesh appears in front of the knight, rotates
//      through his facing arc, then fades. Two variants: swipe (combo 0)
//      and a more explosive chop (combo 1). Colors intensify with combo.
//
//   2. A COMBO POPUP (billboard text sprite) pops above the hit enemy on
//      every successful hit, briefly showing the streak count. Bigger
//      streaks are hotter (yellow → orange → red).
//
//   3. Neither needs pooling since each is short-lived and swings are
//      infrequent enough. Anything that outlives its life is disposed.
//
// The system knows nothing about the player state machine — it just draws.
// ---------------------------------------------------------------------------

interface Arc {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  swingStep: 0 | 1;
}

interface Popup {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  velY: number;
  texture: THREE.Texture;
}

/** Build a crescent slash mesh (ring segment). */
function makeArcMesh(step: 0 | 1): THREE.Mesh {
  // radial segment of a torus, filling the sword arc.
  const arcAngle = PLAYER.attackArc; // radians
  const innerR = 0.7;
  const outerR = PLAYER.attackRange + 0.2;
  const segs = 24;

  const geo = new THREE.BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];

  // build a ring segment centered on +Z, sweeping ±arcAngle/2
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = -arcAngle / 2 + t * arcAngle;
    const cx = Math.sin(a);
    const cz = Math.cos(a);
    positions.push(cx * innerR, 0, cz * innerR);
    positions.push(cx * outerR, 0, cz * outerR);
  }
  for (let i = 0; i < segs; i++) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2);
    indices.push(base + 2, base + 1, base + 3);
  }
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // color: cool white for the first hit, hot amber for the second
  const color = step === 0 ? 0xdbe6ff : 0xffd47a;
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = 0;
  mesh.position.y = 1.0;
  return mesh;
}

/** Build a small canvas texture with the given combo string. */
function makeComboTexture(text: string, hot: number): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // color ramp: hot goes 0..1
  const r = Math.round(255);
  const g = Math.round(210 - hot * 150);
  const b = Math.round(120 - hot * 100);
  ctx.font = "bold 60px -apple-system, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.strokeText(text, size / 2, size / 2);
  ctx.fillStyle = `rgb(${r},${g},${Math.max(0, b)})`;
  ctx.fillText(text, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export class SwordFxSystem {
  private scene: THREE.Scene;
  private arcs: Arc[] = [];
  private popups: Popup[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Spawn a slash arc mesh in front of the player, oriented to their
   * facing. `step` is 0 or 1 (combo index).
   */
  spawnArc(pos: THREE.Vector3, facing: { x: number; z: number }, step: 0 | 1): void {
    const mesh = makeArcMesh(step);
    mesh.position.set(pos.x, 1.0, pos.z);
    const ang = Math.atan2(facing.x, facing.z);
    mesh.rotation.y = ang;
    this.scene.add(mesh);
    this.arcs.push({
      mesh,
      life: 0,
      maxLife: step === 0 ? 0.22 : 0.28,
      swingStep: step,
    });
  }

  /** Pop a combo counter above the hit target. Only shows when count >= 2. */
  popCombo(pos: THREE.Vector3, count: number): void {
    if (count < 2) return;
    const hot = Math.min(1, (count - 2) / 8);
    const tex = makeComboTexture(`${count}x`, hot);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(pos.x + (Math.random() - 0.5) * 0.6, 2.0, pos.z + (Math.random() - 0.5) * 0.6);
    sprite.scale.setScalar(1.2 + hot * 0.9);
    this.scene.add(sprite);
    this.popups.push({
      sprite,
      life: 0,
      maxLife: 0.9,
      velY: 2.2,
      texture: tex,
    });
  }

  update(dt: number): void {
    // arcs — sweep angle + fade
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.life += dt;
      const t = a.life / a.maxLife;
      if (t >= 1) {
        this.scene.remove(a.mesh);
        a.mesh.geometry.dispose();
        (a.mesh.material as THREE.Material).dispose();
        this.arcs.splice(i, 1);
        continue;
      }
      // ease-out radius pop
      const s = 1 + t * 0.35;
      a.mesh.scale.setScalar(s);
      (a.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.85;
    }

    // popups — float up + fade
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life += dt;
      const t = p.life / p.maxLife;
      if (t >= 1) {
        this.scene.remove(p.sprite);
        (p.sprite.material as THREE.SpriteMaterial).dispose();
        p.texture.dispose();
        this.popups.splice(i, 1);
        continue;
      }
      p.sprite.position.y += p.velY * dt;
      p.velY = Math.max(0, p.velY - 5 * dt);
      (p.sprite.material as THREE.SpriteMaterial).opacity = 1 - t;
    }
  }
}
