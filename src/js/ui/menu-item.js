// menu-item.js
//
// FLMenuItem — built on FLBaseComponent.
//
// A second-level entry for use inside <fl-menu-group> when the parent
// <fl-menu-panel> is in layout="split" mode. The item shows its `label`
// (and optional `icon`) in the left rail; its slotted <a>/<button> children
// are the SUB-ITEMS, kept in the DOM but hidden in the rail. Clicking the
// item emits `fl-menu-item-select`; the panel then renders the sub-items in
// its right-hand detail zone and marks this item active.
//
// Usage:
//   <fl-menu-group label="Technical" open>
//     <fl-menu-item label="Projects" icon="folder">
//       <a href="?view=project.project">Project</a>
//       <a href="?view=project.opentech">Open technical projects</a>
//       <a href="?view=project.timespent">Detailed overview Project TimeSpent</a>
//     </fl-menu-item>
//     <fl-menu-item label="SVN Admin">
//       <a href="?view=svn.admin">SVN Admin</a>
//     </fl-menu-item>
//     <a href="?view=logs">Logs</a>   <!-- plain link still works: no submenu -->
//   </fl-menu-group>

import { FLBaseComponent } from './base-component.js';

export class FLMenuItem extends FLBaseComponent {
  static properties = {
    label:  { type: String,  reflect: true },
    icon:   { type: String,  reflect: true },
    active: { type: Boolean, reflect: true, default: false },
  };

  styles() {
    return `
      :host { display: block; }
      .head {
        display: flex; align-items: center; gap: 10px;
        width: 100%; padding: 10px 24px; margin: 0;
        background: none; border: 0;
        border-left: 3px solid transparent;
        color: var(--fl-menu-fg-muted, #dcdcdc);
        font: inherit; text-align: left; cursor: pointer;
      }
      .head:hover { background: var(--fl-menu-hover, rgba(255,255,255,0.06)); color: var(--fl-menu-fg, #fff); }
      .head:focus-visible { outline: 2px solid var(--fl-menu-accent, #00a2b3); outline-offset: -2px; }
      :host([active]) .head {
        color: var(--fl-menu-fg, #fff);
        background: var(--fl-menu-hover, rgba(255,255,255,0.08));
        border-left-color: var(--fl-menu-accent, #00a2b3);
      }
      .icon { font-family: var(--fl-icon-font, 'Material Icons'); font-size: 20px; line-height: 1; }
      .lbl  { flex: 1 1 auto; }
      .chev { font-family: var(--fl-icon-font, 'Material Icons'); font-size: 20px; line-height: 1;
              color: var(--fl-menu-accent, #00a2b3); opacity: 0.9; }
      /* Sub-items are the data source; keep them in the DOM but out of the rail. */
      .src { display: none; }
    `;
  }

  template() {
    return `
      <button class="head" part="item" aria-haspopup="true" aria-expanded="false">
        <span class="icon" aria-hidden="true"></span>
        <span class="lbl"></span>
        <span class="chev" aria-hidden="true">chevron_right</span>
      </button>
      <div class="src"><slot></slot></div>
    `;
  }

  firstRendered() {
    this._head = this.$('.head');
    this._icon = this.$('.icon');
    this._lbl  = this.$('.lbl');
    this._slot = this.$('slot');
    this._head.addEventListener('click', () => this._select());
  }

  _select() {
    this.emit('fl-menu-item-select', {
      detail: { label: this.label, source: this },
      bubbles: true,
      composed: true,
    });
  }

  /** Fresh clones of the slotted sub-items, for the panel to render on the right. */
  subItemNodes() {
    if (!this._slot) return [];
    return this._slot
      .assignedElements({ flatten: true })
      .map((n) => n.cloneNode(true));
  }

  updated(changed) {
    if (changed.has('label')) this._lbl.textContent = this.label ?? '';
    if (changed.has('icon')) {
      const has = !!this.icon;
      this._icon.textContent = has ? this.icon : '';
      this._icon.style.display = has ? '' : 'none';
    }
    if (changed.has('active')) {
      this._head.setAttribute('aria-expanded', String(this.active));
    }
  }
}

if (!customElements.get('fl-menu-item')) {
  customElements.define('fl-menu-item', FLMenuItem);
}
