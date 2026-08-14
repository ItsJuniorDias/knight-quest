import { applyStick, pressAttack } from "../engine/input";
import type { InputState } from "../types";

// ---------------------------------------------------------------------------
// Touch controls — a left thumbstick + right action buttons. Nothing about
// this is React-Native-specific; it uses PointerEvents so mouse also works.
// When any touch is active `active()` returns true, and the keyboard poll
// in engine/input.ts yields to us.
// ---------------------------------------------------------------------------

export class TouchUi {
  private stickBase: HTMLElement;
  private stickHat: HTMLElement;
  private attackBtn: HTMLElement;
  private rollBtn: HTMLElement;
  private blockBtn: HTMLElement;
  private interactBtn: HTMLElement;
  private stickPointer: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private touching = 0;
  private input: InputState;

  constructor(mount: HTMLElement, input: InputState) {
    this.input = input;
    mount.innerHTML = `
      <div id="touch-stick"><div id="touch-hat"></div></div>
      <div id="touch-buttons">
        <button id="btn-block" class="tb small">🛡</button>
        <button id="btn-interact" class="tb small">✋</button>
        <button id="btn-attack" class="tb big">⚔</button>
        <button id="btn-roll" class="tb med">↷</button>
      </div>
    `;
    this.stickBase = mount.querySelector("#touch-stick")!;
    this.stickHat = mount.querySelector("#touch-hat")!;
    this.attackBtn = mount.querySelector("#btn-attack")!;
    this.rollBtn = mount.querySelector("#btn-roll")!;
    this.blockBtn = mount.querySelector("#btn-block")!;
    this.interactBtn = mount.querySelector("#btn-interact")!;

    this.wireStick();
    this.wireButtons();
  }

  active(): boolean {
    return this.touching > 0;
  }

  /** v6: hide the touch overlays entirely (used when the shop opens so the
   *  stick + attack buttons don't compete with shop taps or block the view).
   *  Also resets the touching counter so we don't leave the keyboard poll
   *  disabled when we come back. */
  setVisible(visible: boolean): void {
    this.stickBase.style.display = visible ? "" : "none";
    this.attackBtn.parentElement!.style.display = visible ? "" : "none";
    if (!visible) {
      this.touching = 0;
      this.stickHat.style.transform = "translate(0,0)";
      // Also cancel any active stick input so the player doesn't keep moving
      // while the shop is up.
      applyStick(this.input, 0, 0);
    }
  }

  private wireStick(): void {
    const down = (e: PointerEvent) => {
      if (this.stickPointer !== null) return;
      this.stickPointer = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickBase.setPointerCapture(e.pointerId);
      this.touching++;
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      const dx = e.clientX - this.stickOrigin.x;
      const dy = e.clientY - this.stickOrigin.y;
      const R = 55;
      const len = Math.hypot(dx, dy);
      const nx = len > R ? (dx / len) * R : dx;
      const ny = len > R ? (dy / len) * R : dy;
      this.stickHat.style.transform = `translate(${nx}px, ${ny}px)`;
      applyStick(this.input, dx / R, dy / R);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.touching = Math.max(0, this.touching - 1);
      this.stickHat.style.transform = "translate(0,0)";
      applyStick(this.input, 0, 0);
    };
    this.stickBase.addEventListener("pointerdown", down);
    this.stickBase.addEventListener("pointermove", move);
    this.stickBase.addEventListener("pointerup", up);
    this.stickBase.addEventListener("pointercancel", up);
  }

  private wireButtons(): void {
    const hold = (el: HTMLElement, on: () => void, off?: () => void) => {
      el.addEventListener("pointerdown", (e) => {
        this.touching++;
        el.setPointerCapture(e.pointerId);
        on();
        e.preventDefault();
      });
      const release = (e: PointerEvent) => {
        this.touching = Math.max(0, this.touching - 1);
        off?.();
        e.preventDefault();
      };
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
    };
    hold(this.attackBtn, () => pressAttack(this.input));
    hold(this.rollBtn, () => { this.input.rollPressed = true; });
    hold(this.blockBtn,
      () => { this.input.blockHeld = true; },
      () => { this.input.blockHeld = false; });
    hold(this.interactBtn, () => { this.input.interactPressed = true; });
  }
}
