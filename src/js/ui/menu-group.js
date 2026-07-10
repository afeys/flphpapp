// menu-group.js
//
// FLMenuGroup — built on FLBaseComponent.
//
// A collapsible category section for use inside <fl-menu-panel>. The header
// shows the label + a chevron; the body holds slotted links. Click the header
// (or Enter/Space) to expand/collapse. Emits `fl-menu-group-toggle` {label,open}.
//
// Usage:
//   <fl-menu-group label="Personal" open>
//     <a href="/profile">Profile</a>
//     <a href="/settings">Settings</a>
//   </fl-menu-group>

import { FLBaseComponent } from './base-component.js';

export class FLMenuGroup extends FLBaseComponent {
  static properties = {
    label: { type: String, reflect: true },
    open: { type: Boolean, reflect: true, default: false },
  };

  styles() {
    return `
      :host { display: block; border-bottom: 1px solid var(--fl-menu-divider, rgba(255,255,255,0.08)); }
      .head {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        width: 100%; padding: 15px 18px; margin: 0;
        background: none; border: 0; color: var(--fl-menu-fg, #eee);
        font: inherit; font-size: 1rem; text-align: left; cursor: pointer;
      }
      .head:hover { background: var(--fl-menu-hover, rgba(255,255,255,0.05)); }
      .head:focus-visible { outline: 2px solid var(--fl-menu-accent, #00a2b3); outline-offset: -2px; }
      .chev {
        font-family: var(--fl-icon-font, 'Material Icons'); font-size: 20px; line-height: 1;
        color: var(--fl-menu-accent, #00a2b3); transition: transform 0.2s ease;
      }
      :host([open]) .chev { transform: rotate(180deg); }
      .body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.2s ease; }
      :host([open]) .body { grid-template-rows: 1fr; }
      .bodyinner { overflow: hidden; min-height: 0; }
      /* Slotted links live in the HOST light DOM; a host rule like
         a { color: navy } would override a normal ::slotted rule. !important
         keeps the menu link colour regardless of the host's link styling. */
      ::slotted(a) {
        display: block !important;
        padding: 10px 24px !important;
        color: var(--fl-menu-fg-muted, #dcdcdc) !important;
        text-decoration: none !important;
      }
      ::slotted(a:hover) {
        background: var(--fl-menu-hover, rgba(255,255,255,0.06)) !important;
        color: var(--fl-menu-fg, #fff) !important;
        text-decoration: none !important;
      }
    `;
  }

  template() {
    return `
      <button class="head" part="header" aria-expanded="false">
        <span class="lbl"></span>
        <span class="chev" aria-hidden="true">expand_more</span>
      </button>
      <div class="body"><div class="bodyinner"><slot></slot></div></div>
    `;
  }

  firstRendered() {
    this._head = this.$('.head');
    this._lbl = this.$('.lbl');
    this._head.addEventListener('click', () => { this.open = !this.open; });
  }

  updated(changed) {
    if (changed.has('label')) this._lbl.textContent = this.label ?? '';
    if (changed.has('open')) {
      this._head.setAttribute('aria-expanded', String(this.open));
      if (this._toggleReady) {
        this.emit('fl-menu-group-toggle', { detail: { label: this.label, open: this.open }, bubbles: true, composed: true });
      }
      this._toggleReady = true;
    }
  }
}

if (!customElements.get('fl-menu-group')) {
  customElements.define('fl-menu-group', FLMenuGroup);
}
