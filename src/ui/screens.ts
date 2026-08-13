// ---------------------------------------------------------------------------
// Screens — title, loading bar, game over, victory. All plain HTML overlays.
// ---------------------------------------------------------------------------

export interface ScreenCallbacks {
  onStart: () => void;
  onRestart: () => void;
}

export class Screens {
  private mount: HTMLElement;
  private cb: ScreenCallbacks;
  private loadingBar: HTMLElement | null = null;
  private loadingLabel: HTMLElement | null = null;

  constructor(mount: HTMLElement, cb: ScreenCallbacks) {
    this.mount = mount;
    this.cb = cb;
  }

  showTitle(): void {
    this.mount.innerHTML = `
      <div class="screen title">
        <div class="title-crown">👑</div>
        <h1>KNIGHT QUEST</h1>
        <p class="subtitle">A Magic World Adventure</p>
        <p class="story">The peaceful village of Willowvale is under siege by an ancient evil.
          The Skeleton Warrior has risen in the depths of the old dungeon.
          Take up your sword and shield — the kingdom's fate rests with you.</p>
        <button id="btn-start" class="menu-btn">▶ Begin the Quest</button>
        <div class="controls-hint">
          <div><b>Desktop:</b> WASD/Arrows to move · J or Space to attack · K to roll · Shift to block · E to interact</div>
          <div><b>Mobile:</b> touch controls appear at the bottom of the screen</div>
        </div>
      </div>`;
    const btn = this.mount.querySelector<HTMLButtonElement>("#btn-start")!;
    btn.onclick = () => {
      this.hide();
      this.cb.onStart();
    };
  }

  showLoading(): void {
    this.mount.innerHTML = `
      <div class="screen loading">
        <h2>Preparing the dungeon...</h2>
        <div class="loading-bar-outer"><div class="loading-bar-inner"></div></div>
        <div class="loading-label">Loading assets...</div>
      </div>`;
    this.loadingBar = this.mount.querySelector(".loading-bar-inner")!;
    this.loadingLabel = this.mount.querySelector(".loading-label")!;
  }

  setLoadingProgress(done: number, total: number, label: string): void {
    if (!this.loadingBar || !this.loadingLabel) return;
    this.loadingBar.style.width = `${(done / total) * 100}%`;
    this.loadingLabel.textContent = `${label} (${done}/${total})`;
  }

  hide(): void {
    this.mount.innerHTML = "";
    this.loadingBar = null;
    this.loadingLabel = null;
  }

  showGameOver(coins: number): void {
    this.mount.innerHTML = `
      <div class="screen gameover">
        <h1>You have fallen</h1>
        <p>The undead claim another soul...</p>
        <p class="stat">💰 Coins collected: <b>${coins}</b></p>
        <button id="btn-restart" class="menu-btn">↻ Try again</button>
      </div>`;
    const btn = this.mount.querySelector<HTMLButtonElement>("#btn-restart")!;
    btn.onclick = () => {
      this.hide();
      this.cb.onRestart();
    };
  }

  showVictory(coins: number): void {
    this.mount.innerHTML = `
      <div class="screen victory">
        <div class="victory-crystal">💎</div>
        <h1>You saved Willowvale!</h1>
        <p>The Skeleton Warrior has fallen. The crystal of the ancients returns to the light,
          and peace is restored to the valley.</p>
        <p class="stat">💰 Coins collected: <b>${coins}</b></p>
        <p class="credits">Thank you for playing this Magic World demo.</p>
        <button id="btn-restart" class="menu-btn">▶ Play again</button>
      </div>`;
    const btn = this.mount.querySelector<HTMLButtonElement>("#btn-restart")!;
    btn.onclick = () => {
      this.hide();
      this.cb.onRestart();
    };
  }
}
