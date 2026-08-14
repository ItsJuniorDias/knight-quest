import { INPUT } from "../config";
import type { InputState } from "../types";

// ---------------------------------------------------------------------------
// Input
//
// Same philosophy as Spell Storm's engine/input.ts: raw device events write
// into a plain InputState struct; game systems only ever read the struct.
// Keyboard (desktop) and the virtual touch controls (ui/touch.ts) both feed
// the same state, so systems don't know or care which one is active.
//
// Attack uses a small input buffer (Zelda feel): a press slightly before the
// previous swing ends still chains the combo.
// ---------------------------------------------------------------------------

export function createInputState(): InputState {
  return {
    moveX: 0,
    moveY: 0,
    attackPressed: false,
    attackBuffered: 0,
    attackHeld: false,
    rollPressed: false,
    blockHeld: false,
    interactPressed: false,
  };
}

/** Clear one-frame flags. Call at the END of each update tick. */
export function endFrame(input: InputState, dt: number): void {
  input.attackPressed = false;
  input.rollPressed = false;
  input.interactPressed = false;
  input.attackBuffered = Math.max(0, input.attackBuffered - dt);
}

export function pressAttack(input: InputState): void {
  input.attackPressed = true;
  input.attackBuffered = INPUT.bufferTime;
}

export function applyStick(input: InputState, dx: number, dy: number): void {
  const len = Math.hypot(dx, dy);
  if (len < INPUT.deadzone) {
    input.moveX = 0;
    input.moveY = 0;
    return;
  }
  const scale = Math.min(1, len) / len;
  input.moveX = dx * scale;
  input.moveY = dy * scale;
}

// --------------------------- keyboard ---------------------------------------

const keys = new Set<string>();

export function attachKeyboard(input: InputState): () => void {
  const down = (e: KeyboardEvent) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === "KeyJ" || e.code === "KeyZ" || e.code === "Space") {
      pressAttack(input);
      e.preventDefault();
    }
    if (e.code === "KeyK" || e.code === "KeyX") {
      input.rollPressed = true;
      e.preventDefault();
    }
    if (e.code === "KeyE" || e.code === "Enter") input.interactPressed = true;
  };
  const up = (e: KeyboardEvent) => keys.delete(e.code);
  const blur = () => keys.clear();

  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", blur);

  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", blur);
  };
}

/** Poll held keys into the stick + block. Call once per frame BEFORE systems. */
export function pollKeyboard(input: InputState, touchActive: boolean): void {
  if (touchActive) return; // touch joystick owns the stick this frame
  let x = 0;
  let y = 0;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
  if (keys.has("KeyW") || keys.has("ArrowUp")) y -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) y += 1;
  applyStick(input, x, y);
  input.blockHeld = keys.has("ShiftLeft") || keys.has("ShiftRight");
  // v5: held-attack for charge attack
  input.attackHeld = keys.has("KeyJ") || keys.has("KeyZ") || keys.has("Space");
}
