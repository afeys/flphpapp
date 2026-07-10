// menu-panel.js
//
// FLMenuPanel — built on FLBaseComponent.
//
// The fold-out panel below the bar. Toggle via the linked <fl-menubar>
// (open/close animates), a bottom close bar, or Escape. Emits
// `fl-menu-toggle` {open,id} whenever it opens/closes.
//
// TWO LAYOUTS
//   layout="stack" (default) — groups stack vertically (original behavior).
//   layout="split"           — two columns: a left rail of groups + a right
//                              detail zone. Put the full-width command line in
//                              the "top" slot. When an <fl-menu-item> in the
//                              rail is clicked, its sub-items render on the right.
//
// Usage (split):
//   <fl-menu-panel id="mainmenu" layout="split">
//     <div slot="top" class="doline">…command line…</div>
//     <fl-menu-group label="Technical" open>
//       <fl-menu-item label="Projects">
//         <a href="?view=project.project">Project</a>
//         <a href="?view=project.opentech">Open technical projects</a>
//       </fl-menu-item>
//     </fl-menu-group>
//   </fl-menu-panel>
//
// NOTE: `layout` is read once at first render (authoring-time). Changing it at
// runtime won't re-template the panel.

import { FLBaseComponent } from './base-component.js';

export class FLMenuPanel extends FLBaseComponent {
  static properties = {
    open:   { type: Boolean, reflect: true, default: false },
    layout: { type: String,  reflect: true, default: 'stack' },
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

      /* ---- split layout ---- */
      .top:not(:empty) { display: block; }
      .split {
        display: grid;
        grid-template-columns: var(--fl-menu-rail-width, 300px) 1fr;
        align-items: stretch;
      }
      .rail {
        display: flex; flex-direction: column;
        border-right: 1px solid var(--fl-menu-divider, rgba(255,255,255,0.08));
      }
      .detail {
        padding: 16px 18px;
        min-height: var(--fl-menu-detail-min-height, 220px);
      }
      .detailbody {
        display: flex; flex-wrap: wrap; gap: 10px; align-content: flex-start;
      }
      .placeholder {
        color: var(--fl-menu-fg-muted, #dcdcdc); opacity: 0.55; font-size: 0.9rem;
        padding: 2px 0;
      }
      /* Sub-items are cloned into the shadow here, so host a{}/button{} resets
         can't reach them — plain (non-!important) rules are enough. */
      .detailbody .subitem {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 8px 14px; margin: 0;
        background: var(--fl-menu-subitem-bg, #2f6fd8);
        color: var(--fl-menu-subitem-fg, #fff);
        border: 0; border-radius: var(--fl-radius, 6px);
        font: inherit; font-size: 0.9rem; line-height: 1.2;
        text-decoration: none; cursor: pointer;
      }
      .detailbody .subitem:hover { background: var(--fl-menu-subitem-hover, #4680e6); }
      .detailbody .subitem:focus-visible { outline: 2px solid var(--fl-menu-fg, #fff); outline-offset: 2px; }
    `;
  }

  template() {
    return this.layout === 'split' ? this._splitTemplate() : this._stackTemplate();
  }

  _stackTemplate() {
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

  _splitTemplate() {
    return `
      <div class="wrap" part="panel">
        <div class="inner">
          <div class="top" part="top"><slot name="top"></slot></div>
          <div class="split">
            <div class="rail" part="rail"><slot></slot></div>
            <div class="detail" part="detail">
              <div class="detailbody"></div>
              <div class="placeholder">Select an option…</div>
            </div>
          </div>
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

    if (this.layout === 'split') {
      this._detailBody  = this.$('.detailbody');
      this._placeholder = this.$('.placeholder');
      this._activeItem  = null;
      // Items bubble a composed event; this host is their ancestor, so it catches it.
      this._onItemSelect = (e) => this._showItem(e.detail?.source);
      this.addEventListener('fl-menu-item-select', this._onItemSelect);
    }
  }

  _showItem(item) {
    if (!item || !this._detailBody) return;

    // Move the active highlight.
    if (this._activeItem && this._activeItem !== item) this._activeItem.active = false;
    item.active = true;
    this._activeItem = item;

    // Render this item's sub-items (fresh clones) into the detail zone.
    const nodes = typeof item.subItemNodes === 'function' ? item.subItemNodes() : [];
    this._detailBody.replaceChildren(...nodes.map((n) => {
      n.classList.add('subitem');
      return n;
    }));
    this._placeholder.style.display = nodes.length ? 'none' : '';
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
    if (this._onItemSelect) this.removeEventListener('fl-menu-item-select', this._onItemSelect);
  }
}

if (!customElements.get('fl-menu-panel')) {
  customElements.define('fl-menu-panel', FLMenuPanel);
}
