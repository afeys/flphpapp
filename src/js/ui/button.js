// button.js
//
// FLButton — built on FLBaseComponent.
//
// A styled button matching the FL design tokens. Supports:
//   - label content: text (slot), image + text, material icon, material icon + text
//   - variant: "default" | "primary" | "danger"  (danger = red, for destructive actions)
//   - hover / active / focus feedback
//   - confirmation interception: add `confirm` to require a yes/no before the click
//     fires. The attribute's value is the prompt (default "Are you sure?").
//
// The real click is intercepted; the host only emits a `click` event once the
// action is (optionally) confirmed — so normal `addEventListener('click', ...)`
// on the element just works, and dangerous buttons ask first.
//
// Usage:
//   <fl-button>Save</fl-button>
//   <fl-button variant="primary" icon="check">Approve</fl-button>
//   <fl-button variant="danger" icon="delete" confirm="Delete this record permanently?">Delete</fl-button>
//   <fl-button image="/logo.png">Sign in</fl-button>
//   el.addEventListener('click', () => reallyDelete());

import { FLBaseComponent } from './base-component.js';

export class FLButton extends FLBaseComponent {
  static properties = {
    variant: { type: String, reflect: true, default: 'default' }, // default | primary | danger
    icon: { type: String, reflect: true },     // Material Icons ligature name
    image: { type: String, reflect: true },    // image URL
    confirm: { type: String, reflect: true },  // present => confirm; value => message
    disabled: { type: Boolean, reflect: true, default: false },
  };

  styles() {
    return `
      :host { display: inline-block; position: relative; font: inherit; }

      .btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        font: inherit;
        height: 1.4em;              /* fixed content height so all label types match */
        box-sizing: content-box;    /* padding adds on top of the 1.4em line */
        padding: 7px 14px;
        border: 1px solid var(--fl-line, #ccc);
        border-radius: var(--fl-radius, 6px);
        background: var(--fl-surface, #fff);
        color: var(--fl-text, #1a1a1a);
        cursor: pointer; user-select: none;
        transition: filter 0.12s ease, transform 0.04s ease;
      }
      .btn.icononly { padding: 7px; width: 1.4em; }
      .btn:hover { filter: brightness(0.96); }
      .btn:active { transform: translateY(1px); filter: brightness(0.92); }
      .btn:focus-visible { outline: 2px solid var(--fl-accent, #3b82f6); outline-offset: 2px; }
      .btn:disabled { cursor: default; opacity: 0.5; filter: none; transform: none; }

      :host([variant="primary"]) .btn {
        background: var(--fl-accent, #3b82f6); border-color: var(--fl-accent, #3b82f6); color: #fff;
      }
      :host([variant="danger"]) .btn {
        background: var(--fl-danger, #dc2626); border-color: var(--fl-danger, #dc2626); color: #fff;
      }

      .img { height: 1.15em; width: auto; display: block; flex: none; }
      .micon {
        font-family: var(--fl-icon-font, 'Material Icons');
        font-size: 1.25em; line-height: 1; height: 1em; display: inline-flex; align-items: center;
        font-weight: normal; font-style: normal;
        white-space: nowrap; -webkit-font-feature-settings: 'liga'; font-feature-settings: 'liga';
      }
      .text { white-space: nowrap; }
      [hidden] { display: none !important; }

      .confirm {
        position: absolute; z-index: 30; top: calc(100% + 6px); left: 0;
        min-width: max(100%, 210px);
        background: var(--fl-surface, #fff);
        border: 1px solid var(--fl-line, #ccc);
        border-radius: var(--fl-radius, 6px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
        padding: 12px; color: var(--fl-text, #1a1a1a);
      }
      .confirm-msg { margin: 0 0 10px; font-size: 0.92em; }
      .confirm-row { display: flex; gap: 8px; justify-content: flex-end; }
      .confirm-row button {
        font: inherit; padding: 5px 12px; border-radius: var(--fl-radius, 6px);
        border: 1px solid var(--fl-line, #ccc); background: var(--fl-surface, #fff);
        color: inherit; cursor: pointer;
      }
      .confirm-row button:focus-visible { outline: 2px solid var(--fl-accent, #3b82f6); outline-offset: 2px; }
      .c-ok { background: var(--fl-accent, #3b82f6); border-color: var(--fl-accent, #3b82f6); color: #fff; }
      :host([variant="danger"]) .c-ok { background: var(--fl-danger, #dc2626); border-color: var(--fl-danger, #dc2626); }
    `;
  }

  template() {
    return `
      <button class="btn" part="button" type="button" aria-haspopup="dialog" aria-expanded="false">
        <img class="img" alt="" hidden />
        <span class="micon" aria-hidden="true" hidden></span>
        <span class="text"><slot></slot></span>
      </button>
      <div class="confirm" role="dialog" aria-label="Please confirm" hidden>
        <p class="confirm-msg"></p>
        <div class="confirm-row">
          <button class="c-cancel" type="button">Cancel</button>
          <button class="c-ok" type="button">Confirm</button>
        </div>
      </div>
    `;
  }

  firstRendered() {
    this._btn = this.$('.btn');
    this._img = this.$('.img');
    this._micon = this.$('.micon');
    this._text = this.$('.text');
    this._slot = this.$('slot');
    this._confirm = this.$('.confirm');
    this._confirmMsg = this.$('.confirm-msg');
    this._cOk = this.$('.c-ok');
    this._cCancel = this.$('.c-cancel');

    this._btn.addEventListener('click', (e) => this._onButtonClick(e));
    this._slot.addEventListener('slotchange', () => this._syncLayout());

    this._cOk.addEventListener('click', (e) => { e.stopPropagation(); this._closeConfirm(); this._fireClick(); });
    this._cCancel.addEventListener('click', (e) => { e.stopPropagation(); this._closeConfirm(); });

    this._syncLayout();
  }

  disconnected() {
    this._closeConfirm();
  }

  updated(changed) {
    if (!this._btn) return;
    if (changed.has('icon') || changed.has('image')) this._syncLayout();
    if (changed.has('disabled')) {
      this._btn.disabled = this.disabled;
      if (this.disabled) this._closeConfirm();
    }
  }

  _syncLayout() {
    const hasIcon = !!this.icon;
    this._micon.hidden = !hasIcon;
    if (hasIcon) this._micon.textContent = this.icon;

    const hasImage = !!this.image;
    this._img.hidden = !hasImage;
    if (hasImage) this._img.src = this.image;

    const hasText = this.textContent.trim() !== '';
    this._text.hidden = !hasText;

    this._btn.classList.toggle('icononly', !hasText && (hasIcon || hasImage));
  }

  // --- click interception / confirmation ---

  _confirmEnabled() {
    return this.confirm != null; // attribute present (even if empty)
  }

  _onButtonClick(e) {
    // We fully control what the host emits, so stop the raw inner click.
    e.stopPropagation();
    e.preventDefault();
    if (this.disabled) return;
    if (this._confirmEnabled()) this._openConfirm();
    else this._fireClick();
  }

  _fireClick() {
    this.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
  }

  _openConfirm() {
    const msg = this.confirm && this.confirm.trim() ? this.confirm : 'Are you sure?';
    this._confirmMsg.textContent = msg;
    this._confirm.hidden = false;
    this._btn.setAttribute('aria-expanded', 'true');
    this._cCancel.focus(); // safer default for destructive actions

    this._onDocPointer = (e) => { if (!e.composedPath().includes(this)) this._closeConfirm(); };
    document.addEventListener('click', this._onDocPointer, true);
    this._onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); this._closeConfirm(); } };
    this.addEventListener('keydown', this._onKey);
  }

  _closeConfirm() {
    if (!this._confirm || this._confirm.hidden) return;
    this._confirm.hidden = true;
    this._btn.setAttribute('aria-expanded', 'false');
    if (this._onDocPointer) { document.removeEventListener('click', this._onDocPointer, true); this._onDocPointer = null; }
    if (this._onKey) { this.removeEventListener('keydown', this._onKey); this._onKey = null; }
    try { this._btn.focus(); } catch { /* ignore */ }
  }
}

if (!customElements.get('fl-button')) {
  customElements.define('fl-button', FLButton);
}