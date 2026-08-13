import * as THREE from "three";
import { COLORS, RENDER } from "./config";
import { FxSystem, tickFlashes } from "./art/fx";
import { initAudio, startMusic } from "./engine/audio";
import { attachKeyboard, createInputState, endFrame, pollKeyboard } from "./engine/input";
import { loadAll } from "./engine/loader";
import { BossSystem } from "./systems/boss";
import { CameraRig } from "./systems/camera";
import { EnemySystem, preloadWeapons } from "./systems/enemies";
import { NpcSystem } from "./systems/npcs";
import { PickupSystem } from "./systems/pickups";
import { createPlayer, playerCheer, reviveAtStart, updatePlayer } from "./systems/player";
import { ProjectileSystem } from "./systems/projectiles";
import { PropsSystem } from "./systems/props";
import { RoomManager } from "./systems/rooms";
import { StoryDirector } from "./systems/story";
import { SwordFxSystem } from "./art/sword-fx";
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
//
// v3 adds:
//   • NpcSystem       — friendly + ghost characters throughout the world
//   • StoryDirector   — first-visit narrator beats + NPC-triggered lines
//   • SwordFxSystem   — slash arc trail on every attack, combo popups
//   • camera-shake    — HUD dirty pipe that maps sword hits to a screen
//                       displacement (kept in the CameraRig)
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
  scene.fog = new THREE.Fog(COLORS.fog, RENDER.fogNear, RENDER.fogFar);

  // lights ------------------------------------------------------------------
  const ambient = new THREE.AmbientLight(COLORS.ambient, 0.9);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(COLORS.sun, 1.15);
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
  let npcs: NpcSystem | null = null;
  let story: StoryDirector | null = null;
  let swordFx: SwordFxSystem | null = null;
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
      story?.onEvent("boss:dead");
      window.setTimeout(() => screens.showVictory(player?.coins ?? 0), 1800);
    },
    onRoomChanged: (key) => {
      const def = roomAt(...(key.split(",").map(Number) as [number, number]));
      if (def) hud?.setRoomLabel(def.name);
      minimap?.markVisited(key);
      story?.onRoomChanged(key);
      if (key === BOSS_ROOM_KEY && boss?.boss?.state === "waiting") {
        boss.wake();
      }
    },
    onStory: (who, text) => hud?.narrate(who, text),
    onStoryTrigger: (id) => story?.onNpcTrigger(id),
    onSwordHit: (kind, pos) => {
      // camera shake proportional to what was hit
      const strength = kind === "boss" ? 0.55 : kind === "enemy" ? 0.25 : 0.15;
      cam.shake(strength);
      // combo counter: every ENEMY/BOSS hit bumps the streak
      if ((kind === "enemy" || kind === "boss") && player) {
        player.comboCount += 1;
        player.comboTimer = 1.6; // seconds — resets if no hit
        hud?.setCombo(player.comboCount);
        swordFx?.popCombo(pos, player.comboCount);
      }
    },
    onSwordSwing: (step) => {
      // little pre-swing rumble so heavy swings feel weightier
      cam.shake(step === 0 ? 0.08 : 0.12);
      if (player && swordFx) {
        swordFx.spawnArc(player.pos, player.facing, step);
      }
    },
    onGameEvent: (key) => story?.onEvent(key),
  };

  async function startGame(): Promise<void> {
    initAudio();
    screens.showLoading();
    await preloadWeapons();
    await loadAll((done, total, label) => screens.setLoadingProgress(done, total, label));

    // build world + all systems
    world = buildWorld(scene);
    fx = new FxSystem(scene);
    swordFx = new SwordFxSystem(scene);
    pickups = new PickupSystem(scene, fx, events);
    projectiles = new ProjectileSystem(scene, fx, events);
    props = new PropsSystem(fx, events);
    enemies = new EnemySystem(scene, fx, events);
    boss = new BossSystem(scene, fx, events);
    npcs = new NpcSystem(scene, events);
    story = new StoryDirector(events);

    player = createPlayer(scene, world.playerStart);
    roomMgr = new RoomManager(world.rooms, START_ROOM_KEY, events);

    // build HUD + minimap now that we have a player
    hud = new Hud(hudMount);
    hud.render(player);
    const startDef = roomAt(...(START_ROOM_KEY.split(",").map(Number) as [number, number]));
    hud.setRoomLabel(startDef?.name ?? "Willowvale Village");
    minimap = new Minimap(hudMount);

    // spawn the boss (dormant) in the throne room; woken by RoomManager
    boss.spawn(world.bossSpawn);

    // pre-spawn enemies + NPCs for every room so they exist regardless of visit
    for (const [, room] of world.rooms) {
      for (const s of room.enemySpawns) {
        enemies.spawnEnemy(s.kind, tileCenter(room.gx, room.gy, s.tx, s.tz), room.key);
      }
      for (const s of room.npcSpawns) {
        npcs.spawn(s.kind, tileCenter(room.gx, room.gy, s.tx, s.tz), room.key, s.tx, s.tz);
      }
    }

    cam.snap(player.pos, roomMgr.current, player.facing);
    startMusic();
    screens.hide();
    running = true;

    // opening narrator beat, one beat later so the player can settle in
    window.setTimeout(() => story?.onEvent("start:game"), 700);
    story.onRoomChanged(START_ROOM_KEY);
  }

  function restartGame(): void {
    if (!player || !world || !roomMgr || !enemies || !pickups || !projectiles || !npcs || !story) return;
    enemies.clearAll();
    pickups.clearAll();
    projectiles.clearAll();
    npcs.clearAll();
    story.reset();
    // respawn enemies + NPCs fresh
    for (const [, room] of world.rooms) {
      room.cleared = room.doors.length === 0 || (room.enemySpawns.length === 0 && !room.hasBoss);
      for (const s of room.enemySpawns) {
        enemies.spawnEnemy(s.kind, tileCenter(room.gx, room.gy, s.tx, s.tz), room.key);
      }
      for (const s of room.npcSpawns) {
        npcs.spawn(s.kind, tileCenter(room.gx, room.gy, s.tx, s.tz), room.key, s.tx, s.tz);
      }
    }
    reviveAtStart(player, world.playerStart);
    roomMgr.current = world.rooms.get(START_ROOM_KEY)!;
    cam.snap(player.pos, roomMgr.current, player.facing);
    hud?.render(player);
    const startDef = roomAt(...(START_ROOM_KEY.split(",").map(Number) as [number, number]));
    hud?.setRoomLabel(startDef?.name ?? "Willowvale Village");
    // reset room visibility
    for (const [, r] of world.rooms) {
      const def = roomAt(r.gx, r.gy);
      const initial = def?.startVisible === true;
      r.visited = initial;
      r.group.visible = initial;
    }
    running = true;
    story.onRoomChanged(START_ROOM_KEY);
  }

  // game loop ---------------------------------------------------------------
  let last = performance.now();
  function tick(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (running && player && roomMgr && enemies && projectiles && pickups && props && boss && fx && npcs && swordFx) {
      pollKeyboard(input, touchUi.active());

      updatePlayer(player, input, dt, roomMgr, fx, events);
      npcs.update(dt, player, roomMgr, input);
      enemies.update(dt, player, roomMgr, projectiles, pickups);
      boss.update(dt, player, roomMgr, projectiles, props);
      projectiles.update(dt, player, roomMgr);
      pickups.update(dt, player);
      props.update(dt, player, input, roomMgr, pickups);

      // interact with the locked boss door if E is pressed near it
      // (skipped when currently talking to an NPC — dialog owns the button)
      if (input.interactPressed && !npcs.activeNpc) {
        roomMgr.tryUnlockNearbyDoor(player);
      }

      roomMgr.update(dt, player, cam);
      cam.update(dt, player.pos, roomMgr.current, player.facing);

      updateTorches(roomMgr.current.key, now / 1000);
      fx.update(dt);
      swordFx.update(dt);
      const flashRoots: THREE.Object3D[] = [player.root];
      for (const e of enemies.enemies) flashRoots.push(e.root);
      if (boss.boss) flashRoots.push(boss.boss.root);
      tickFlashes(flashRoots, now / 1000);

      // combo timer decay + HUD sync
      if (player.comboTimer > 0) {
        player.comboTimer -= dt;
        if (player.comboTimer <= 0) {
          player.comboCount = 0;
          hud?.setCombo(0);
        }
      }

      hud?.render(player);
      hud?.updateInteractPrompt(npcs.activeNpc);
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
