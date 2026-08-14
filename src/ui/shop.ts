// ---------------------------------------------------------------------------
// v5: SHOP UI
//
// Rendered as an HTML overlay when the player presses E on a shopkeeper NPC.
// Sells four items paid in coins:
//   • Heart Potion — instant heal 3 hearts (uses immediately)
//   • Extra Heart — permanent +1 max HP (up to a cap of 8)
//   • Shield Upgrade — reduce incoming damage by 1 (once per run)
//   • Sword Upgrade — +1 damage per swing (once per run)
//
// The shop pauses everything else — it's opened via `open(player)` and
// closed via `close()`. The RETURN button and Escape close it too.
// ---------------------------------------------------------------------------

import type { PlayerData } from "../types";
import { PLAYER } from "../config";
import { sfx } from "../engine/audio";

export interface ShopItem {
  id: string;
  name: string;
  price: number;
  desc: string;
  /** returns true if the item was applied (enough coins + not maxed). */
  apply(player: PlayerData): boolean;
  /** returns a human "unavailable" reason, or null if buyable. */
  reasonUnavailable(player: PlayerData): string | null;
}

export const SHOP_ITEMS: ShopItem[] = [
  {
    id: "heart_potion",
    name: "Heart Potion",
    price: 5,
    desc: "Restore 3 hearts. Drink now.",
    reasonUnavailable(p) {
      const maxHalves = (p.maxHp ?? 3) * 2;
      if (p.halfHearts >= maxHalves) return "You're already at full HP.";
      return null;
    },
    apply(p) {
      const maxHalves = (p.maxHp ?? 3) * 2;
      p.halfHearts = Math.min(maxHalves, p.halfHearts + 6); // 3 whole hearts = 6 halves
      p.hp = Math.ceil(p.halfHearts / 2);
      return true;
    },
  },
  {
    id: "extra_heart",
    name: "Extra Heart",
    price: 15,
    desc: "Permanently +1 max HP (up to 8).",
    reasonUnavailable(p) {
      if ((p.maxHp ?? 3) >= 8) return "Your heart is at its limit.";
      return null;
    },
    apply(p) {
      p.maxHp = Math.min(8, (p.maxHp ?? 3) + 1);
      // full-heal on purchase — feels rewarding
      p.halfHearts = p.maxHp * 2;
      p.hp = p.maxHp;
      return true;
    },
  },
  {
    id: "sword_upgrade",
    name: "Sharpen the Blade",
    price: 20,
    desc: "+1 damage per swing. One-time.",
    reasonUnavailable(p) {
      if (p.upgrades?.sharpBlade) return "Already sharpened this run.";
      return null;
    },
    apply(p) {
      if (!p.upgrades) p.upgrades = {};
      p.upgrades.sharpBlade = true;
      return true;
    },
  },
  {
    id: "shield_upgrade",
    name: "Reinforced Shield",
    price: 20,
    desc: "Reduce all damage taken by 1. One-time.",
    reasonUnavailable(p) {
      if (p.upgrades?.reinforcedShield) return "Already reinforced this run.";
      return null;
    },
    apply(p) {
      if (!p.upgrades) p.upgrades = {};
      p.upgrades.reinforcedShield = true;
      return true;
    },
  },
];

export class Shop {
  private root: HTMLElement;
  private overlay: HTMLDivElement;
  private open_ = false;
  private player: PlayerData | null = null;
  private onCloseCb?: () => void;
  private escHandler: (e: KeyboardEvent) => void;

  constructor(mount: HTMLElement) {
    this.root = mount;

    // v6 mobile: shop styles moved to a <style> tag so we can use media
    // queries. Mobile viewport compacts EVERYTHING: paddings, font sizes,
    // gaps, panel width — the previous inline styles were too big for a
    // 390px iPhone screen.
    if (!document.getElementById("shop-styles")) {
      const style = document.createElement("style");
      style.id = "shop-styles";
      style.textContent = `
        #shop-panel {
          background: linear-gradient(180deg, #2b1f18, #1a1210);
          border: 2px solid #7a5030;
          border-radius: 12px;
          padding: 22px 26px;
          max-width: 480px;
          width: 90%;
          max-height: calc(100vh - 32px);
          overflow-y: auto;
          color: #f2e6d5;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
          margin: 16px;
        }
        #shop-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; gap: 10px; }
        #shop-title { font-size: 20px; font-weight: 600; color: #f7e4a5; }
        #shop-subtitle { font-size: 12px; color: #c9b596; margin-top: 2px; font-style: italic; }
        #shop-coin-badge { background: #5a3f22; padding: 5px 10px; border-radius: 8px; font-weight: 600; color: #f7e4a5; flex-shrink: 0; font-size: 14px; }
        #shop-items { display: flex; flex-direction: column; gap: 8px; }
        .shop-item { display: flex; align-items: center; gap: 10px; background: rgba(120,80,50,0.24); padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(140,100,70,0.35); }
        .shop-item-body { flex: 1; min-width: 0; }
        .shop-item-name { font-weight: 600; font-size: 14px; color: #f7e4a5; }
        .shop-item-desc { font-size: 11px; color: #c9b596; margin-top: 2px; }
        .shop-item-price { font-weight: 600; text-align: right; font-size: 13px; }
        .shop-item button { background: #7a5030; color: #f2e6d5; border: none; border-radius: 6px; padding: 8px 12px; font-weight: 600; cursor: pointer; min-width: 60px; touch-action: manipulation; font-size: 13px; }
        .shop-item button:disabled { background: #3a2a1c; cursor: not-allowed; opacity: 0.6; }
        #shop-close { margin-top: 14px; width: 100%; padding: 12px; background: #5a3f22; color: #f2e6d5; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; touch-action: manipulation; }

        /* v6 mobile: aggressive compaction under 480px — narrow phones. */
        @media (max-width: 480px) {
          #shop-panel { padding: 14px 16px; max-width: 340px; width: calc(100% - 24px); margin: 12px; border-radius: 10px; }
          #shop-header { margin-bottom: 10px; gap: 8px; }
          #shop-title { font-size: 17px; }
          #shop-subtitle { font-size: 11px; line-height: 1.3; }
          #shop-coin-badge { padding: 4px 8px; font-size: 13px; }
          #shop-items { gap: 6px; }
          .shop-item { padding: 8px 10px; gap: 8px; border-radius: 6px; }
          .shop-item-name { font-size: 13px; }
          .shop-item-desc { font-size: 10px; margin-top: 1px; }
          .shop-item-price { font-size: 12px; }
          .shop-item button { padding: 7px 10px; font-size: 12px; min-width: 52px; }
          #shop-close { margin-top: 10px; padding: 10px; font-size: 13px; }
        }
      `;
      document.head.appendChild(style);
    }

    this.overlay = document.createElement("div");
    this.overlay.id = "shop-overlay";
    this.overlay.style.cssText = [
      "position:fixed", "inset:0", "background:rgba(0,0,0,0.72)",
      "display:none", "align-items:center", "justify-content:center",
      // v6 mobile: super-high z-index guarantees the overlay sits above the
      // touch controls (which use position:fixed inside their own stacking
      // context and can end up above lower z-indexes on iOS Safari). Also
      // set overflow so tall shop content on short viewports can scroll.
      "z-index:9999", "overflow-y:auto",
      "font-family:system-ui,-apple-system,sans-serif",
      // v5 fix: parent #ui has pointer-events:none, which is inherited.
      // Without this override, Buy/Leave buttons receive no clicks and the
      // shop feels frozen — only Esc closes it. Same pattern .screen and
      // #touch-stick use in index.html.
      "pointer-events:auto",
      // v6 mobile: respect iPhone notch/dynamic island so the header isn't
      // hidden under the status bar area.
      "padding-top:env(safe-area-inset-top,0px)",
      "padding-bottom:env(safe-area-inset-bottom,0px)",
    ].join(";");
    this.overlay.innerHTML = this.buildInner();
    this.root.appendChild(this.overlay);
    this.escHandler = (e) => {
      if (this.open_ && e.key === "Escape") this.close();
    };
    window.addEventListener("keydown", this.escHandler);
  }

  private buildInner(): string {
    return `
      <div id="shop-panel">
        <div id="shop-header">
          <div style="min-width:0;flex:1;">
            <div id="shop-title">Inga's Wares</div>
            <div id="shop-subtitle">"The Frontier grew too quiet. Now I trade beside the cart."</div>
          </div>
          <div id="shop-coin-badge">💰 0</div>
        </div>
        <div id="shop-items"></div>
        <button id="shop-close">Leave (Esc)</button>
      </div>
    `;
  }

  open(player: PlayerData, onClose?: () => void): void {
    this.player = player;
    this.onCloseCb = onClose;
    // v6 safeguard: if something (a defensive innerHTML="" somewhere, an
    // error handler, a screen transition) detached our overlay, put it
    // back. Cheap DOM check every open — no cost when things are fine.
    if (!this.overlay.parentElement) {
      this.root.appendChild(this.overlay);
    }
    this.open_ = true;
    this.overlay.style.display = "flex";
    this.render();
    const close = this.overlay.querySelector("#shop-close") as HTMLButtonElement;
    close.onclick = () => this.close();
    // v6 mobile safeguard: also make Leave respond to touchstart so mobile
    // users don't have to wait for the synthetic click event (which can lag
    // ~300ms on old iOS or get eaten if a touch-action config is wrong).
    close.ontouchstart = (e) => {
      e.preventDefault();
      this.close();
    };
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.overlay.style.display = "none";
    this.player = null;
    if (this.onCloseCb) this.onCloseCb();
  }

  isOpen(): boolean {
    return this.open_;
  }

  private render(): void {
    if (!this.player) return;
    const p = this.player;
    const coin = this.overlay.querySelector("#shop-coin-badge")!;
    coin.textContent = `💰 ${p.coins}`;
    const list = this.overlay.querySelector("#shop-items")!;
    list.innerHTML = "";
    for (const item of SHOP_ITEMS) {
      const reason = item.reasonUnavailable(p);
      const canAfford = p.coins >= item.price;
      const disabled = reason !== null || !canAfford;
      const row = document.createElement("div");
      row.className = "shop-item";
      if (disabled) row.style.opacity = "0.55";
      row.innerHTML = `
        <div class="shop-item-body">
          <div class="shop-item-name">${item.name}</div>
          <div class="shop-item-desc">${reason ?? item.desc}</div>
        </div>
        <div class="shop-item-price" style="color:${canAfford ? "#f7e4a5" : "#ff8080"};">${item.price} 💰</div>
        <button data-item="${item.id}" ${disabled ? "disabled" : ""}>Buy</button>
      `;
      list.appendChild(row);
    }
    list.querySelectorAll<HTMLButtonElement>("button[data-item]").forEach((btn) => {
      if (btn.disabled) return;
      const handler = () => {
        const id = btn.dataset.item!;
        this.buy(id);
      };
      btn.onclick = handler;
      // v6 mobile: touchstart bypasses the 300ms synthetic click delay on
      // older iOS and prevents the stall Alexandre reported where taps on
      // Buy sometimes just did nothing.
      btn.ontouchstart = (e) => {
        e.preventDefault();
        handler();
      };
    });
    void PLAYER; // ensures the config import isn't shaken out
  }

  private buy(id: string): void {
    const p = this.player;
    if (!p) return;
    const item = SHOP_ITEMS.find((it) => it.id === id);
    if (!item) return;
    if (item.reasonUnavailable(p)) return;
    if (p.coins < item.price) return;
    p.coins -= item.price;
    if (item.apply(p)) {
      sfx.coin(); // ker-ching
    }
    this.render();
  }
}
