// menubar.js
//
// FLMenuBar — built on FLBaseComponent.
//
// A three-zone top bar:
//   [ hamburger ] [ user zone (grey, flexible) ] [ system zone (black, fixed) ]
//
//   - hamburger toggles a linked <fl-menu-panel> (by id via the `panel` attribute)
//   - user zone: slot name="user" — app-added shortcut icons (grey background)
//   - system zone: a built-in "+" add button + slot name="system" — fixed app icons
//   - hovering/focusing "+" highlights the user zone (it's what the add affects)
//   - clicking "+" emits `fl-menu-add` (your app opens its picker)
//   - when the user-zone slot changes, emits `fl-usericons-change` {ids,count}
//     so your backend can persist the new set
//
// Usage:
//   <fl-menubar panel="mainmenu">
//     <button slot="user" data-id="wiki"><span class="material-icons">public</span></button>
//     <span slot="system" class="material-icons">search</span>
//     <span slot="system" class="material-icons">power_settings_new</span>
//   </fl-menubar>
//   <fl-menu-panel id="mainmenu"> ... </fl-menu-panel>

import { FLBaseComponent } from './base-component.js';

export class FLMenuBar extends FLBaseComponent {
  static properties = {
    panel: { type: String, reflect: true }, // id of the <fl-menu-panel> to toggle
  };

  styles() {
    return `
      :host { display: block; font: inherit; }
      .bar {
        display: flex; align-items: stretch;
        height: var(--fl-menu-height, 48px);
        background: var(--fl-menu-bg, #1e1e1e);
        color: var(--fl-menu-fg, #eee);
      }
      .btn {
        display: inline-flex; align-items: center; justify-content: center;
        min-width: 48px; padding: 0 12px;
        background: none; border: 0; color: inherit; cursor: pointer;
      }
      .btn:hover { background: var(--fl-menu-hover, rgba(255,255,255,0.08)); }
      .btn:focus-visible { outline: 2px solid var(--fl-menu-accent, #00a2b3); outline-offset: -2px; }
      .zone { display: flex; align-items: center; }
      .zone.user {
        flex: 1 1 auto; gap: 4px; padding: 0 8px; min-width: 0; overflow-x: auto;
        background: var(--fl-menu-user-bg, #333);
        transition: background 0.15s ease;
      }
      .zone.user.highlight { background: var(--fl-menu-highlight, #2f6fd8); }
      .zone.system { flex: none; background: var(--fl-menu-system-bg, #000); }
      .micon {
        font-family: var(--fl-icon-font, 'Material Icons');
        font-size: 22px; line-height: 1;
      }
      /* Slotted user/system buttons are in the HOST's light DOM, so an
         aggressive host reset like  button { font: inherit; background: navy }
         would otherwise override them (outer-tree normal beats inner-tree
         normal). !important lets these inner-tree rules win regardless. */
      ::slotted(button),
      ::slotted(.usericon),
      ::slotted(.sysicon) {
        font-family: var(--fl-icon-font, 'Material Icons') !important;
        font-weight: normal !important;
        font-style: normal !important;
        font-feature-settings: 'liga' !important;
        font-size: 22px !important;
        line-height: 1 !important;
        letter-spacing: normal !important;
        text-transform: none !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        min-width: 44px !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 0 10px !important;
        background: none !important;
        border: 0 !important;
        border-radius: 0 !important;
        color: inherit !important;
        cursor: pointer !important;
        -webkit-font-smoothing: antialiased;
      }
      ::slotted(button:hover),
      ::slotted(.usericon:hover),
      ::slotted(.sysicon:hover) {
        background: var(--fl-menu-hover, rgba(255,255,255,0.08)) !important;
      }
      ::slotted(*) { color: inherit; }
    `;
  }

  template() {
    return `
      <div class="bar" part="bar">
        <button class="ham btn" part="hamburger" aria-label="Toggle menu" aria-expanded="false" aria-haspopup="true">
          <span class="micon" aria-hidden="true">menu</span>
        </button>
        <div class="zone user" part="user-zone"><slot name="user"></slot></div>
        <div class="zone system" part="system-zone">
          <button class="add btn" part="add" aria-label="Add shortcut">
            <span class="micon" aria-hidden="true">add</span>
          </button>
          <slot name="system"></slot>
        </div>
      </div>
    `;
  }

  firstRendered() {
    this._ham = this.$('.ham');
    this._add = this.$('.add');
    this._user = this.$('.user');
    this._userSlot = this.$('slot[name="user"]');

    this._ham.addEventListener('click', () => this._toggle());
    this._add.addEventListener('click', () => this.emit('fl-menu-add', { bubbles: true, composed: true }));

    const hi = (on) => this._user.classList.toggle('highlight', on);
    this._add.addEventListener('mouseenter', () => hi(true));
    this._add.addEventListener('mouseleave', () => hi(false));
    this._add.addEventListener('focus', () => hi(true));
    this._add.addEventListener('blur', () => hi(false));

    this._userSlot.addEventListener('slotchange', () => this._emitUserChange());

    // Any slotted element with data-panel="id" toggles that panel on click.
    this.addEventListener('click', (e) => this._onDelegatedClick(e));
  }

  connected() {
    // Keep every trigger's state in sync with panel open/close (incl. mutual exclusion).
    this._onPanelToggle = (e) => {
      const d = e.detail;
      if (!d || !d.id) return;
      if (d.id === this.panel) this._syncHam(d.open);
      this.querySelectorAll('[data-panel]').forEach((t) => {
        if (t.getAttribute('data-panel') === d.id) {
          t.setAttribute('aria-expanded', String(d.open));
          t.classList.toggle('active', d.open);
        }
      });
    };
    document.addEventListener('fl-menu-toggle', this._onPanelToggle);
  }

  disconnected() {
    if (this._onPanelToggle) document.removeEventListener('fl-menu-toggle', this._onPanelToggle);
  }

  _panelEl() {
    return this._panelById(this.panel);
  }

  _panelById(id) {
    if (!id) return null;
    const root = this.getRootNode();
    return (root.getElementById && root.getElementById(id)) || document.getElementById(id);
  }

  _togglePanelById(id) {
    const p = this._panelById(id);
    if (p) p.open = !p.open;
  }

  _onDelegatedClick(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-panel]') : null;
    if (t && this.contains(t)) this._togglePanelById(t.getAttribute('data-panel'));
  }

  _toggle() {
    const p = this._panelEl();
    if (p) {
      p.open = !p.open;
      this._syncHam(p.open);
    } else {
      // No panel resolved — still emit so the app can react.
      this.emit('fl-menu-toggle', { detail: { open: true, id: this.panel }, bubbles: true, composed: true });
    }
  }

  _syncHam(open) {
    this._ham.setAttribute('aria-expanded', String(!!open));
    this.classList.toggle('open', !!open);
  }

  _emitUserChange() {
    const nodes = typeof this._userSlot.assignedElements === 'function'
        ? this._userSlot.assignedElements()
        : [];
    const ids = nodes.map((n) => n.getAttribute('data-id') || n.id).filter(Boolean);
    this.emit('fl-usericons-change', { detail: { ids, count: nodes.length }, bubbles: true, composed: true });
  }
}

if (!customElements.get('fl-menubar')) {
  customElements.define('fl-menubar', FLMenuBar);
}
