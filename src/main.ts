import * as THREE from "three";
import { COLORS, IS_MOBILE, RENDER } from "./config";
import { FxSystem, tickFlashes } from "./art/fx";
import { initAudio, playMusic, sfx, stopMusic } from "./engine/audio";
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
import { Shop } from "./ui/shop";
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

  // v6 mobile: kill iOS Safari's built-in zoom gestures. CSS `touch-action:none`
  // + meta viewport `maximum-scale=1` cover ~90% of cases, but iOS Safari
  // still fires `gesturestart` (pinch) and can double-tap-zoom regardless
  // when the double-tap crosses element boundaries fast. `preventDefault`
  // on both is the last-mile fix. `{ passive: false }` is required — the
  // browser ignores preventDefault on passive listeners.
  const killGesture = (e: Event) => e.preventDefault();
  document.addEventListener("gesturestart", killGesture, { passive: false });
  document.addEventListener("gesturechange", killGesture, { passive: false });
  document.addEventListener("gestureend", killGesture, { passive: false });
  document.addEventListener("dblclick", killGesture, { passive: false });

  // v7 mobile: renderer options are driven by the RENDER preset, which knows
  // whether we're on a phone / web-view. Antialias off + pixelRatio 1 on
  // mobile is the single biggest win (halves fill-rate cost, no fringing on
  // a flat-shaded look). `stencil:false` and `depth:true` keep the WebGL
  // context minimal.
  const renderer = new THREE.WebGLRenderer({
    antialias: RENDER.antialias,
    powerPreference: "high-performance",
    stencil: false,
    depth: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(COLORS.bg);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (RENDER.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = RENDER.softShadows
      ? THREE.PCFSoftShadowMap
      : THREE.BasicShadowMap;
    // Auto-update is on by default; on mobile we render mostly-static geometry,
    // so we let Three decide when to redraw the shadow map (default) but with
    // a much smaller frustum below.
  }
  canvasWrap.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.bg);
  scene.fog = new THREE.Fog(COLORS.fog, RENDER.fogNear, RENDER.fogFar);

  // lights ------------------------------------------------------------------
  // v7: mobile gets slightly brighter ambient to compensate for the missing
  // shadow contact — the scene doesn't feel washed out without a cast shadow.
  const ambient = new THREE.AmbientLight(COLORS.ambient, IS_MOBILE ? 1.05 : 0.9);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(COLORS.sun, IS_MOBILE ? 1.25 : 1.15);
  sun.position.set(30, 60, 20);
  sun.castShadow = RENDER.shadows;
  sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
  // v7: shrink the sun's shadow frustum to roughly one room. The old
  // 120x120 area meant the 1024² shadow texture had ~14 texels per world
  // unit; the new 60x60 keeps the same texture density with 4x less
  // pixels to draw into (and much less geometry inside the frustum).
  const shadowSpan = IS_MOBILE ? 26 : 40;
  sun.shadow.camera.left = -shadowSpan;
  sun.shadow.camera.right = shadowSpan;
  sun.shadow.camera.top = shadowSpan;
  sun.shadow.camera.bottom = -shadowSpan;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = IS_MOBILE ? 140 : 200;
  sun.shadow.bias = -0.001;
  scene.add(sun);
  // v7: shadow-cam target follows the player, so the frustum always
  // covers the current play area even when we shrink it.
  const sunTarget = new THREE.Object3D();
  scene.add(sunTarget);
  sun.target = sunTarget;

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
  let shop: Shop | null = null;
  let running = false;

  const events: GameEvents = {
    onHudDirty: () => hud?.render(player!),
    onToast: (t) => hud?.toast(t),
    onBossBar: (frac) => hud?.setBossBar(frac),
    onGameOver: () => {
      running = false;
      playMusic("gameover");
      window.setTimeout(() => screens.showGameOver(player?.coins ?? 0), 900);
    },
    onVictory: () => {
      running = false;
      if (player) playerCheer(player);
      story?.onEvent("boss:dead");
      playMusic("victory");
      window.setTimeout(() => screens.showVictory(player?.coins ?? 0), 1800);
    },
    onRoomChanged: (key) => {
      const def = roomAt(...(key.split(",").map(Number) as [number, number]));
      if (def) hud?.setRoomLabel(def.name);
      minimap?.markVisited(key);
      story?.onRoomChanged(key);
      // v5: music by biome. Boss room has its own aggressive track;
      // snow reuses village (folk/gentle), wetland/pine reuse forest,
      // meadow reuses village for its bright pastoral feel.
      if (key === BOSS_ROOM_KEY) {
        playMusic("boss");
      } else if (def?.biome === "village" || def?.biome === "snow" || def?.biome === "meadow") {
        playMusic("village");
      } else if (def?.biome === "forest" || def?.biome === "pine" || def?.biome === "wetland") {
        playMusic("forest");
      } else if (def?.biome === "dungeon") {
        playMusic("dungeon");
      }
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
    // v5: shop overlay — pauses gameplay while open
    onOpenShop: () => {
      if (!shop || !player) return;
      // v6 mobile: hide the touch controls so they don't overlap the shop
      // panel or accidentally receive taps meant for Buy/Leave.
      touchUi.setVisible(false);
      shop.open(player, () => {
        touchUi.setVisible(true);
      });
    },
    onCloseShop: () => shop?.close(),
  };

  async function startGame(): Promise<void> {
    initAudio();
    // v4: kick off the title-screen loop the moment audio can play (browser
    // autoplay policy requires a user gesture, which is the start click).
    // It'll cross-fade to the biome track once the world finishes loading.
    playMusic("title");
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
    // v4: start on the biome-appropriate track. Village hub → village loop.
    const startDefRoom = roomAt(...(START_ROOM_KEY.split(",").map(Number) as [number, number]));
    const startTrack =
      startDefRoom?.biome === "village" ? "village" :
      startDefRoom?.biome === "forest" ? "forest" : "dungeon";
    playMusic(startTrack);
    screens.hide();

    // v6 fix: build the Shop AFTER screens.hide(). Screens shares the uiMount
    // (#ui) with the Shop, and hide() does `mount.innerHTML = ""` — which
    // silently obliterates the shop overlay if it was created earlier. Result:
    // the shop instance exists in memory (open_ = true, isOpen() = true) but
    // its overlay div is detached from the DOM, so nothing appears on E press.
    shop = new Shop(uiMount);
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
    // Restart music from the village track — restartGame always spawns at start.
    playMusic("village");
    story.onRoomChanged(START_ROOM_KEY);
  }

  // ---------------------------------------------------------------------
  // v7 mobile perf: room-visibility culling.
  //
  // Every room lives in its own THREE.Group. On mobile we hide any room
  // that isn't the current one or one of its 4-connected neighbours, which
  // means the renderer skips their draw calls AND their shadow contribution
  // entirely. `lastCulledKey` is a tiny memo so we only touch the graph
  // when the room actually changes.
  // ---------------------------------------------------------------------
  // v7.3: raio 2 + sala anterior sempre visível — corrige bug de "porta
  // de volta some" quando o jogador entra numa sala nova e olha pra trás.
  let lastCulledKey = "";
  let prevRoomKey = "";
  function applyRoomCulling(currentKey: string): void {
    if (!world || !RENDER.aggressiveRoomCulling) return;
    if (currentKey === lastCulledKey) return;
    prevRoomKey = lastCulledKey;
    lastCulledKey = currentKey;
    const [cx, cy] = currentKey.split(",").map(Number);
    for (const [key, r] of world.rooms) {
      if (!r.visited) continue;
      if (key === prevRoomKey) { r.group.visible = true; continue; }
      const [rx, ry] = key.split(",").map(Number);
      const dx = Math.abs(rx - cx);
      const dy = Math.abs(ry - cy);
      r.group.visible = dx + dy <= 2;
    }
  }

  // ---------------------------------------------------------------------
  // v7 adaptive perf: watch FPS, drop quality if we can't hold target.
  //
  // Three tiers of degradation:
  //   tier 0: as-configured
  //   tier 1: soft → basic shadow map
  //   tier 2: shadows off entirely
  //   tier 3: pixel ratio down to 0.85
  // We only tick this on mobile (adaptiveTargetFps > 0) and only degrade;
  // we never automatically re-enable, to avoid oscillating.
  // ---------------------------------------------------------------------
  let fpsAccum = 0;
  let fpsFrames = 0;
  let lastFpsCheck = performance.now();
  let perfTier = 0;
  function tickAdaptive(now: number): void {
    if (RENDER.adaptiveTargetFps <= 0) return;
    fpsFrames++;
    if (now - lastFpsCheck < 1200) return;
    fpsAccum = (fpsFrames * 1000) / (now - lastFpsCheck);
    fpsFrames = 0;
    lastFpsCheck = now;
    if (fpsAccum >= RENDER.adaptiveTargetFps - 2) return; // healthy
    if (perfTier === 0 && renderer.shadowMap.enabled && RENDER.softShadows) {
      renderer.shadowMap.type = THREE.BasicShadowMap;
      RENDER.softShadows = false;
      sun.shadow.needsUpdate = true;
      perfTier = 1;
    } else if (perfTier === 1 && renderer.shadowMap.enabled) {
      renderer.shadowMap.enabled = false;
      sun.castShadow = false;
      RENDER.shadows = false;
      perfTier = 2;
    } else if (perfTier === 2) {
      const dpr = Math.max(0.75, renderer.getPixelRatio() * 0.85);
      renderer.setPixelRatio(dpr);
      perfTier = 3;
    }
  }

  // game loop ---------------------------------------------------------------
  // v7: raf-frame-cap. We already Math.min(dt, 0.05); on top of that we
  // cap incoming frames to ~62fps so a Hz-mismatched 120Hz mobile panel
  // doesn't waste half its budget re-rendering identical world state.
  let last = performance.now();
  const minFrameMs = 1000 / 62;
  function tick(now: number): void {
    const elapsed = now - last;
    if (elapsed < minFrameMs) {
      requestAnimationFrame(tick);
      return;
    }
    const dt = Math.min(0.05, elapsed / 1000);
    last = now;
    tickAdaptive(now);

    if (running && player && roomMgr && enemies && projectiles && pickups && props && boss && fx && npcs && swordFx) {
      pollKeyboard(input, touchUi.active());

      // v5: shop pauses gameplay — just render, don't update world state.
      // We also drain per-frame input flags so buttons don't queue while paused.
      if (shop?.isOpen()) {
        endFrame(input, dt);
        renderer.render(scene, cam.camera);
        requestAnimationFrame(tick);
        return;
      }

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

      // v7 mobile: keep the sun's shadow-cam centered on the player, so we
      // can afford a much smaller shadow frustum without gaps.
      if (RENDER.shadows) {
        sunTarget.position.set(player.pos.x, 0, player.pos.z);
        sun.position.set(player.pos.x + 30, 60, player.pos.z + 20);
      }
      applyRoomCulling(roomMgr.current.key);

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
      // v6: NPC prompt takes priority; only show chest/prop prompt when no
      // NPC is in interact range, so we never render two prompts at once.
      if (npcs.activeNpc) {
        hud?.updateInteractPrompt(npcs.activeNpc);
      } else {
        hud?.setInteractPromptText(props?.nearestInteractLabel(player, roomMgr) ?? null);
      }
      // v5: charge attack bar fills while holding attack
      hud?.setChargeBar(
        Math.min(1, player.chargeTime / 0.55), // 0.55s = PLAYER.chargeTime
        player.chargeReady,
      );
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
