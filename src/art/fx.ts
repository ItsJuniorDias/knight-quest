import * as THREE from "three";
import { COLORS } from "../config";

// ---------------------------------------------------------------------------
// FX — tiny pooled particle system + a few procedural meshes.
//
// Particles are plain box meshes (cheap, chunky, matches the low-poly art).
// The pool never allocates during gameplay.
// ---------------------------------------------------------------------------

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  spin: number;
  active: boolean;
}

const POOL_SIZE = 160;

export class FxSystem {
  private pool: Particle[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const geo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    for (let i = 0; i < POOL_SIZE; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({
        mesh,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        gravity: 0,
        spin: 0,
        active: false,
      });
    }
  }

  burst(
    pos: THREE.Vector3,
    color: number,
    count: number,
    opts: { speed?: number; up?: number; gravity?: number; life?: number; scale?: number } = {},
  ): void {
    const speed = opts.speed ?? 4;
    const up = opts.up ?? 3;
    let spawned = 0;
    for (const p of this.pool) {
      if (spawned >= count) break;
      if (p.active) continue;
      spawned++;
      p.active = true;
      p.mesh.visible = true;
      p.mesh.position.copy(pos);
      const a = Math.random() * Math.PI * 2;
      const r = speed * (0.3 + Math.random() * 0.7);
      p.vel.set(Math.cos(a) * r, up * (0.4 + Math.random() * 0.8), Math.sin(a) * r);
      p.life = 0;
      p.maxLife = (opts.life ?? 0.55) * (0.7 + Math.random() * 0.6);
      p.gravity = opts.gravity ?? 12;
      p.spin = (Math.random() - 0.5) * 12;
      const s = (opts.scale ?? 1) * (0.6 + Math.random() * 0.8);
      p.mesh.scale.setScalar(s);
      (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    }
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.06) {
        p.mesh.position.y = 0.06;
        p.vel.y = Math.abs(p.vel.y) * 0.35;
        p.vel.x *= 0.8;
        p.vel.z *= 0.8;
      }
      p.mesh.rotation.x += p.spin * dt;
      p.mesh.rotation.z += p.spin * dt;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p.life / p.maxLife;
    }
  }
}

// ------------------------- procedural meshes ---------------------------------

/** Classic extruded heart — the dungeon pack has no heart model, so we make one. */
export function makeHeartMesh(color = COLORS.heart, scale = 0.42): THREE.Mesh {
  const shape = new THREE.Shape();
  const s = 1;
  shape.moveTo(0, -0.9 * s);
  shape.bezierCurveTo(-1.4 * s, 0.2 * s, -0.7 * s, 1.05 * s, 0, 0.45 * s);
  shape.bezierCurveTo(0.7 * s, 1.05 * s, 1.4 * s, 0.2 * s, 0, -0.9 * s);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.42,
    bevelEnabled: true,
    bevelThickness: 0.09,
    bevelSize: 0.09,
    bevelSegments: 2,
    curveSegments: 10,
  });
  geo.center();
  const mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(scale);
  return mesh;
}

/** Glowing magic bolt for the skeleton mages. */
export function makeBoltMesh(): THREE.Group {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 10, 8),
    new THREE.MeshBasicMaterial({ color: COLORS.magicBolt, transparent: true, opacity: 0.45 }),
  );
  g.add(core, halo);
  const light = new THREE.PointLight(COLORS.magicBolt, 6, 6);
  g.add(light);
  return g;
}

/** Expanding golden ring used by the boss ground-slam shockwave. */
export function makeShockwaveMesh(): THREE.Mesh {
  const geo = new THREE.TorusGeometry(1, 0.16, 8, 40);
  const mat = new THREE.MeshBasicMaterial({
    color: COLORS.shockwave,
    transparent: true,
    opacity: 0.95,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.25;
  return mesh;
}

/** The victory crystal — Magic World's macguffin, a floating gem. */
export function makeCrystalMesh(): THREE.Mesh {
  const geo = new THREE.OctahedronGeometry(0.55, 0);
  const mat = new THREE.MeshLambertMaterial({
    color: 0x7de3ff,
    emissive: 0x2fa8ff,
    emissiveIntensity: 0.8,
  });
  const m = new THREE.Mesh(geo, mat);
  m.scale.y = 1.5;
  return m;
}

// ------------------------------ flash helper ---------------------------------

const flashState = new WeakMap<THREE.Object3D, { mats: THREE.Material[]; until: number }>();

/**
 * Tints every mesh under `root` toward a flash color for `dur` seconds by
 * abusing Lambert's emissive channel. Call tickFlashes each frame.
 */
export function flash(root: THREE.Object3D, timeNow: number, dur = 0.12): void {
  const mats: THREE.Material[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of list) {
      const lam = m as THREE.MeshLambertMaterial;
      if (lam.emissive) {
        lam.emissive.setHex(0xffffff);
        lam.emissiveIntensity = 0.85;
        mats.push(lam);
      }
    }
  });
  flashState.set(root, { mats, until: timeNow + dur });
}

export function tickFlashes(roots: THREE.Object3D[], timeNow: number): void {
  for (const root of roots) {
    const st = flashState.get(root);
    if (!st) continue;
    if (timeNow >= st.until) {
      for (const m of st.mats) {
        const lam = m as THREE.MeshLambertMaterial;
        lam.emissive.setHex(0x000000);
        lam.emissiveIntensity = 0;
      }
      flashState.delete(root);
    }
  }
}
