import * as THREE from "three";

// ---------------------------------------------------------------------------
// v6: PROCEDURAL BOSS MESHES
//
// Four of the eight bosses have no external art asset — they're assembled
// from three.js primitives at spawn time. That keeps the deliverable small
// and lets each boss get a distinctive silhouette that reads at a glance.
//
// Each factory returns a THREE.Group centered at the origin, standing on
// y=0 (the ground plane). The BossSystem parents it to a wrapper group
// that is then positioned in the world.
//
// The `handles` returned alongside the group are the sub-parts the AI
// wants to animate every frame (a floating orb, a rotating laser eye, etc.)
// — they let update() poke at inner nodes without another traversal.
// ---------------------------------------------------------------------------

export interface BossMeshHandles {
  root: THREE.Group;
  /** parts the AI wants to animate every frame */
  parts: {
    body?: THREE.Object3D;
    head?: THREE.Object3D;
    core?: THREE.Object3D;
    eyeL?: THREE.Object3D;
    eyeR?: THREE.Object3D;
    ring?: THREE.Object3D;
    segments?: THREE.Object3D[];
    orbs?: THREE.Object3D[];
    aura?: THREE.Object3D;
  };
}

/**
 * Crystal Golem — an obsidian humanoid built from octahedron shards with a
 * glowing gem core. Tall (3.6m), broad, slow. The "core" mesh in the chest
 * is what the boss uses for its rotating laser attack and enrage glow.
 */
export function makeCrystalGolemMesh(tint = 0x66d0ff): BossMeshHandles {
  const root = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x203040 });
  const crystal = new THREE.MeshLambertMaterial({
    color: tint, transparent: true, opacity: 0.85, emissive: tint, emissiveIntensity: 0.35,
  });
  const gold = new THREE.MeshLambertMaterial({ color: 0xffd166, emissive: 0xffd166, emissiveIntensity: 0.3 });

  // legs — two thick shard cones
  const legGeo = new THREE.CylinderGeometry(0.45, 0.65, 1.5, 6);
  const legL = new THREE.Mesh(legGeo, dark); legL.position.set(-0.55, 0.75, 0);
  const legR = new THREE.Mesh(legGeo, dark); legR.position.set(0.55, 0.75, 0);
  root.add(legL, legR);

  // torso — big octahedron
  const torso = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0), dark);
  torso.position.y = 2.15;
  torso.scale.set(1.1, 1.15, 0.9);
  root.add(torso);

  // core gem — glowing crystal at the chest, animated by the AI
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), crystal);
  core.position.set(0, 2.15, 0.55);
  root.add(core);

  // shoulder crystals
  const shard = new THREE.OctahedronGeometry(0.4, 0);
  for (const x of [-1.2, 1.2]) {
    const s = new THREE.Mesh(shard, crystal); s.position.set(x, 2.6, 0);
    s.rotation.z = x < 0 ? 0.4 : -0.4; root.add(s);
  }

  // arms — cylinders with fist gems
  const armGeo = new THREE.CylinderGeometry(0.28, 0.35, 1.3, 6);
  for (const x of [-1.05, 1.05]) {
    const arm = new THREE.Mesh(armGeo, dark);
    arm.position.set(x, 1.55, 0); arm.rotation.z = x < 0 ? 0.15 : -0.15; root.add(arm);
    const fist = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), crystal);
    fist.position.set(x * 1.15, 0.95, 0); root.add(fist);
  }

  // head — smaller shard with glowing "eyes"
  const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), dark);
  head.position.y = 3.4; root.add(head);
  const eyeGeo = new THREE.SphereGeometry(0.08, 6, 6);
  const eyeMat = new THREE.MeshBasicMaterial({ color: gold.color });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.18, 3.45, 0.45); root.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.18, 3.45, 0.45); root.add(eyeR);

  // aura ring — laser beam anchor, hidden by default
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.06, 8, 20),
    new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0 }),
  );
  ring.position.set(0, 2.15, 0);
  ring.rotation.x = Math.PI / 2;
  root.add(ring);

  return { root, parts: { body: torso, head, core, eyeL, eyeR, ring } };
}

/**
 * Void Serpent — a floating segmented worm. Head at index 0, tail at the end.
 * Segments hover in a sine wave; the AI shifts them each frame.
 */
export function makeVoidSerpentMesh(tint = 0x8a2be2): BossMeshHandles {
  const root = new THREE.Group();
  const scaleMat = new THREE.MeshLambertMaterial({ color: 0x160f2b });
  const glowMat = new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.75 });
  const fangMat = new THREE.MeshLambertMaterial({ color: 0xf5eddc });

  const segments: THREE.Object3D[] = [];
  const segCount = 10;
  for (let i = 0; i < segCount; i++) {
    const size = 0.85 - i * 0.05;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), scaleMat);
    body.scale.set(1, 0.85, 1); grp.add(body);
    // little glow band around each segment
    const band = new THREE.Mesh(new THREE.TorusGeometry(size * 0.85, 0.06, 6, 10), glowMat);
    band.rotation.x = Math.PI / 2; grp.add(band);
    grp.position.set(-i * 0.65, 1.4 + Math.sin(i * 0.6) * 0.35, 0);
    root.add(grp); segments.push(grp);
  }

  // head — first segment gets fangs + eyes
  const headGrp = segments[0] as THREE.Group;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffe74c });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), eyeMat);
  eyeL.position.set(0.6, 0.35, 0.35);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), eyeMat);
  eyeR.position.set(0.6, 0.35, -0.35);
  headGrp.add(eyeL, eyeR);
  const fangGeo = new THREE.ConeGeometry(0.08, 0.35, 6);
  for (const [z, sign] of [[0.22, 1], [-0.22, -1]] as [number, number][]) {
    const fang = new THREE.Mesh(fangGeo, fangMat);
    fang.position.set(0.8, -0.15, z);
    fang.rotation.z = -Math.PI / 2 - 0.15 * sign;
    headGrp.add(fang);
  }
  // core between eyes for tinting
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), glowMat);
  core.position.set(0.7, 0.5, 0);
  headGrp.add(core);

  return { root, parts: { segments, head: headGrp, core, eyeL, eyeR } };
}

/**
 * Flame Djinn — a floating orb wreathed in flames. The core is the "body"
 * sphere; the orbs list holds 5 flame petals that rotate around it.
 */
export function makeFlameDjinnMesh(tint = 0xff7a1f): BossMeshHandles {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({
    color: tint, emissive: tint, emissiveIntensity: 0.5,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffe066, transparent: true, opacity: 0.7,
  });
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0x2a0a05 });

  // hovering base skirt
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.2, 8), smokeMat);
  skirt.position.y = 1.0; skirt.rotation.x = Math.PI;
  root.add(skirt);

  // core body — big sphere at chest height
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 10), bodyMat);
  core.position.y = 2.4;
  root.add(core);

  // face crown — two glowing eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), eyeMat);
  eyeL.position.set(-0.28, 2.55, 0.7);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), eyeMat);
  eyeR.position.set(0.28, 2.55, 0.7);
  root.add(eyeL, eyeR);

  // 5 flame petals orbiting the head
  const orbs: THREE.Object3D[] = [];
  const petalGeo = new THREE.ConeGeometry(0.28, 0.9, 6);
  for (let i = 0; i < 5; i++) {
    const petal = new THREE.Mesh(petalGeo, glowMat);
    orbs.push(petal); root.add(petal);
  }

  // burning aura ring at feet
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.4, 0.1, 8, 24),
    new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.6 }),
  );
  ring.position.y = 0.1; ring.rotation.x = Math.PI / 2;
  root.add(ring);

  return { root, parts: { body: core, core, eyeL, eyeR, orbs, ring } };
}

/**
 * Storm Elemental — a swirling storm cloud with a bright core. Similar to
 * the djinn shape but colder, with lightning rings floating around it.
 */
export function makeStormElementalMesh(tint = 0x64c8ff): BossMeshHandles {
  const root = new THREE.Group();
  const cloudMat = new THREE.MeshLambertMaterial({
    color: 0x2a3a52, emissive: 0x0e1a30, emissiveIntensity: 0.4,
  });
  const boltMat = new THREE.MeshBasicMaterial({
    color: tint, transparent: true, opacity: 0.9,
  });
  const coreMat = new THREE.MeshLambertMaterial({
    color: 0xe8f6ff, emissive: 0xe8f6ff, emissiveIntensity: 0.7,
  });

  // main storm body — big fluffy cluster of spheres
  const bodyGrp = new THREE.Group();
  for (const [x, y, z, s] of [
    [0, 2.4, 0, 1.0],
    [-0.7, 2.2, 0.2, 0.8],
    [0.7, 2.3, -0.2, 0.85],
    [0, 2.7, 0.5, 0.7],
    [0.2, 2.8, -0.4, 0.65],
    [-0.3, 3.0, 0.1, 0.55],
  ] as [number, number, number, number][]) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 8), cloudMat);
    puff.position.set(x, y, z); bodyGrp.add(puff);
  }
  root.add(bodyGrp);

  // bright core in the middle — glows when charging
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), coreMat);
  core.position.y = 2.4; root.add(core);

  // eyes — twin lightning slits
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xe8f6ff });
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.03), eyeMat);
  eyeL.position.set(-0.28, 2.42, 0.75);
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.03), eyeMat);
  eyeR.position.set(0.28, 2.42, 0.75);
  root.add(eyeL, eyeR);

  // orbiting lightning bolts (thin rectangles)
  const orbs: THREE.Object3D[] = [];
  for (let i = 0; i < 4; i++) {
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.4, 0.06), boltMat);
    orbs.push(bolt); root.add(bolt);
  }

  // wispy tail
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.5, 8), cloudMat);
  tail.position.y = 1.2; tail.rotation.x = Math.PI;
  root.add(tail);

  // ring at the base for tornado telegraph
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.6, 0.08, 8, 24),
    new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0 }),
  );
  ring.position.y = 0.1; ring.rotation.x = Math.PI / 2;
  root.add(ring);

  return { root, parts: { body: bodyGrp, core, eyeL, eyeR, orbs, ring } };
}
