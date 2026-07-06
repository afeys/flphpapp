// menu-panel.js
//
// FLMenuPanel — built on FLBaseComponent.
//
// The fold-out panel below the bar. Holds slotted <fl-menu-group> sections.
// Toggle via the linked <fl-menubar> (open/close animates), a bottom close bar,
// or Escape. Emits `fl-menu-toggle` {open,id} whenever it opens/closes.
//
// Usage:
//   <fl-menu-panel id="mainmenu">
//     <fl-menu-group label="Personal" open> <a href="...">Profile</a> ... </fl-menu-group>
//     <fl-menu-group label="Technical"> ... </fl-menu-group>
//   </fl-menu-panel>

import { FLBaseComponent } from './base-component.js';

export class FLMenuPanel extends FLBaseComponent {
  static properties = {
    open: { type: Boolean, reflect: true, default: false },
  };

  styles() {
    return `
      :host { display: block; position: absolute; left: 0; right: 0; z-index: 50; font: inherit; }
      /* 0fr -> 1fr animates height without needing a fixed pixel height. */
      .wrap {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows 0.25s ease;
        background: var(--fl-menu-panel-bg, #262626);
        color: var(--fl-menu-fg, #eee);
      }
      :host([open]) .wrap { grid-template-rows: 1fr; box-shadow: 0 10px 24px rgba(0, 0, 0, 0.4); }
      .inner { overflow: hidden; min-height: 0; }
      .groups { display: flex; flex-direction: column; }
      .close {
        display: flex; align-items: center; justify-content: center;
        width: 100%; padding: 8px 0; margin: 0;
        background: none; border: 0; border-top: 1px solid var(--fl-menu-divider, rgba(255,255,255,0.08));
        color: var(--fl-menu-fg-muted, #999); cursor: pointer;
      }
      .close:hover { background: var(--fl-menu-hover, rgba(255,255,255,0.06)); color: var(--fl-menu-fg, #eee); }
      .close:focus-visible { outline: 2px solid var(--fl-menu-accent, #00a2b3); outline-offset: -2px; }
      .micon { font-family: var(--fl-icon-font, 'Material Icons'); font-size: 22px; line-height: 1; }
    `;
  }

  template() {
    return `
      <div class="wrap" part="panel">
        <div class="inner">
          <div class="groups"><slot></slot></div>
          <button class="close" part="close" aria-label="Close menu">
            <span class="micon" aria-hidden="true">close</span>
          </button>
        </div>
      </div>
    `;
  }

  firstRendered() {
    this.$('.close').addEventListener('click', () => { this.open = false; });
    this._onKey = (e) => { if (e.key === 'Escape' && this.open) this.open = false; };
  }

  connected() {
    // Only one panel open at a time: close this one when another panel opens.
    this._onOtherToggle = (e) => {
      const d = e.detail;
      if (d && d.open && d.id !== this.id && this.open) this.open = false;
    };
    document.addEventListener('fl-menu-toggle', this._onOtherToggle);
  }

  updated(changed) {
    if (changed.has('open')) {
      if (this.open) document.addEventListener('keydown', this._onKey);
      else document.removeEventListener('keydown', this._onKey);
      // Skip the initial render's emit; only announce real toggles.
      if (this._toggleReady) {
        this.emit('fl-menu-toggle', { detail: { open: this.open, id: this.id }, bubbles: true, composed: true });
      }
      this._toggleReady = true;
    }
  }

  disconnected() {
    if (this._onKey) document.removeEventListener('keydown', this._onKey);
    if (this._onOtherToggle) document.removeEventListener('fl-menu-toggle', this._onOtherToggle);
  }
}

if (!customElements.get('fl-menu-panel')) {
  customElements.define('fl-menu-panel', FLMenuPanel);
}
