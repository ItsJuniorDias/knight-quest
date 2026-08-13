import * as THREE from "three";
import { COLORS, RENDER } from "./config";
import { FxSystem, tickFlashes } from "./art/fx";
import { initAudio, startMusic } from "./engine/audio";
import { attachKeyboard, createInputState, endFrame, pollKeyboard } from "./engine/input";
import { loadAll } from "./engine/loader";
import { BossSystem } from "./systems/boss";
import { CameraRig } from "./systems/camera";
import { EnemySystem, preloadWeapons } from "./systems/enemies";
import { PickupSystem } from "./systems/pickups";
import { createPlayer, playerCheer, reviveAtStart, updatePlayer } from "./systems/player";
import { ProjectileSystem } from "./systems/projectiles";
import { PropsSystem } from "./systems/props";
import { RoomManager } from "./systems/rooms";
import type { GameEvents } from "./types";
import { buildWorld, tileCenter, updateTorches } from "./world/builder";
import { BOSS_ROOM_KEY, START_ROOM_KEY, roomAt } from "./world/dungeon";
import { Hud } from "./ui/hud";
import { Minimap } from "./ui/minimap";
import { Screens } from "./ui/screens";
import { TouchUi } from "./ui/touch";

// ---------------------------------------------------------------------------
// KNIGHT QUEST — bootstrap
//
// Wires the renderer to the DOM, orchestrates the loading sequence, builds
// the world and player, and runs the main game loop. Everything gameplay
// lives inside the systems it invokes; this file is just plumbing.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const canvasWrap = document.getElementById("canvas")!;
  const hudMount = document.getElementById("hud")!;
  const uiMount = document.getElementById("ui")!;
  const touchMount = document.getElementById("touch")!;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(COLORS.bg);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (RENDER.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  canvasWrap.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.bg);
  scene.fog = new THREE.Fog(COLORS.fog, 32, 90);

  // lights ------------------------------------------------------------------
  const ambient = new THREE.AmbientLight(COLORS.ambient, 0.55);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(COLORS.sun, 0.9);
  sun.position.set(30, 60, 20);
  sun.castShadow = RENDER.shadows;
  sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.001;
  scene.add(sun);

  // camera + input ----------------------------------------------------------
  const cam = new CameraRig(window.innerWidth / window.innerHeight);
  const input = createInputState();
  const detachKeyboard = attachKeyboard(input);
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    cam.resize(window.innerWidth / window.innerHeight);
  });

  // screens + first user gesture starts audio -------------------------------
  const screens = new Screens(uiMount, {
    onStart: () => startGame(),
    onRestart: () => restartGame(),
  });
  screens.showTitle();

  const touchUi = new TouchUi(touchMount, input);

  let hud: Hud | null = null;
  let minimap: Minimap | null = null;
  let world: ReturnType<typeof buildWorld> | null = null;
  let roomMgr: RoomManager | null = null;
  let player: ReturnType<typeof createPlayer> | null = null;
  let enemies: EnemySystem | null = null;
  let projectiles: ProjectileSystem | null = null;
  let pickups: PickupSystem | null = null;
  let props: PropsSystem | null = null;
  let boss: BossSystem | null = null;
  let fx: FxSystem | null = null;
  let running = false;

  const events: GameEvents = {
    onHudDirty: () => hud?.render(player!),
    onToast: (t) => hud?.toast(t),
    onBossBar: (frac) => hud?.setBossBar(frac),
    onGameOver: () => {
      running = false;
      window.setTimeout(() => screens.showGameOver(player?.coins ?? 0), 900);
    },
    onVictory: () => {
      running = false;
      if (player) playerCheer(player);
      window.setTimeout(() => screens.showVictory(player?.coins ?? 0), 1400);
    },
    onRoomChanged: (key) => {
      const def = roomAt(...(key.split(",").map(Number) as [number, number]));
      if (def) hud?.setRoomLabel(def.name);
      minimap?.markVisited(key);
      if (key === BOSS_ROOM_KEY && boss?.boss?.state === "waiting") {
        boss.wake();
      }
    },
  };

  async function startGame(): Promise<void> {
    initAudio();
    screens.showLoading();
    await preloadWeapons();
    await loadAll((done, total, label) => screens.setLoadingProgress(done, total, label));

    // build world + all systems
    world = buildWorld(scene);
    fx = new FxSystem(scene);
    pickups = new PickupSystem(scene, fx, events);
    projectiles = new ProjectileSystem(scene, fx, events);
    props = new PropsSystem(fx, events);
    enemies = new EnemySystem(scene, fx, events);
    boss = new BossSystem(scene, fx, events);

    player = createPlayer(scene, world.playerStart);
    roomMgr = new RoomManager(world.rooms, START_ROOM_KEY, events);

    // build HUD + minimap now that we have a player
    hud = new Hud(hudMount);
    hud.render(player);
    hud.setRoomLabel("Willowvale Village");
    minimap = new Minimap(hudMount);

    // spawn the boss (dormant) in the throne room; woken by RoomManager
    boss.spawn(world.bossSpawn);

    // pre-spawn enemies for every room so they exist regardless of visit
    for (const [, room] of world.rooms) {
      if (room.enemySpawns.length === 0) continue;
      for (const s of room.enemySpawns) {
        enemies.spawnEnemy(s.kind, tileCenter(room.gx, room.gy, s.tx, s.tz), room.key);
      }
    }

    cam.snap(player.pos, roomMgr.current);
    startMusic();
    screens.hide();
    running = true;
  }

  function restartGame(): void {
    if (!player || !world || !roomMgr || !enemies || !pickups || !projectiles) return;
    enemies.clearAll();
    pickups.clearAll();
    projectiles.clearAll();
    // respawn enemies fresh
    for (const [, room] of world.rooms) {
      room.cleared = room.doors.length === 0 || room.enemySpawns.length === 0 && !room.hasBoss;
      for (const s of room.enemySpawns) {
        enemies.spawnEnemy(s.kind, tileCenter(room.gx, room.gy, s.tx, s.tz), room.key);
      }
    }
    reviveAtStart(player, world.playerStart);
    roomMgr.current = world.rooms.get(START_ROOM_KEY)!;
    cam.snap(player.pos, roomMgr.current);
    hud?.render(player);
    hud?.setRoomLabel("Willowvale Village");
    running = true;
  }

  // game loop ---------------------------------------------------------------
  let last = performance.now();
  function tick(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (running && player && roomMgr && enemies && projectiles && pickups && props && boss && fx) {
      pollKeyboard(input, touchUi.active());

      updatePlayer(player, input, dt, roomMgr, fx, events);
      enemies.update(dt, player, roomMgr, projectiles, pickups);
      boss.update(dt, player, roomMgr, projectiles, props);
      projectiles.update(dt, player, roomMgr);
      pickups.update(dt, player);
      props.update(dt, player, input, roomMgr, pickups);

      // interact with the locked boss door if E is pressed near it
      if (input.interactPressed) roomMgr.tryUnlockNearbyDoor(player);

      roomMgr.update(dt, player, cam);
      cam.update(dt, player.pos, roomMgr.current);

      updateTorches(roomMgr.current.key, now / 1000);
      fx.update(dt);
      const flashRoots: THREE.Object3D[] = [player.root];
      for (const e of enemies.enemies) flashRoots.push(e.root);
      if (boss.boss) flashRoots.push(boss.boss.root);
      tickFlashes(flashRoots, now / 1000);

      hud?.render(player);
      minimap?.render(world!.rooms, roomMgr.current.key, now / 1000);
      endFrame(input, dt);
    }

    renderer.render(scene, cam.camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // don't leave dangling listeners if the module is HMR-reloaded
  window.addEventListener("beforeunload", detachKeyboard);
}

void main();
