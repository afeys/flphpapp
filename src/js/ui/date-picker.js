// date-picker.js
//
// FLDatePicker — built on FLValueComponent.
//
// The native <input type="date"> is used only as the calendar/picker engine.
// Its own text is rendered in a locale-dependent format (m/d/y, d/m/y, ...) that
// pages cannot control, so we hide that text and paint our own locale-independent
// "yyyy/mm/dd" display over it. The calendar is opened with the standard
// showPicker() API (Chrome/Edge 99+, Firefox 101+, Safari 16+).
//
// .value is always the ISO string "yyyy-mm-dd" — only the *display* is reformatted.
//
// Usage:
//   <fl-date-picker name="dob" value="1990-05-01" min="1900-01-01" required></fl-date-picker>
//   const p = document.createElement('fl-date-picker'); p.value = '2026-01-31';
//   p.addEventListener('change', (e) => console.log(e.detail.value));

import { FLValueComponent } from './base-value-component.js';

export class FLDatePicker extends FLValueComponent {
  static properties = {
    min: { type: String, reflect: true },
    max: { type: String, reflect: true },
    label: { type: String, reflect: true },
    placeholder: { type: String, reflect: true },
    // value / name / disabled / required / readonly are inherited.
  };

  styles() {
    return `
      :host { display: inline-flex; flex-direction: column; gap: 4px; font: inherit; }
      :host([disabled]) { opacity: 0.5; }
      .label { font-size: 0.85em; color: var(--fl-label, #444); }
      .field {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 9.5em;
        padding: 6px 10px;
        border: 1px solid var(--fl-line, #ccc);
        border-radius: var(--fl-radius, 6px);
        background: var(--fl-surface, #fff);
        color: inherit;
        cursor: pointer;
      }
      .field:focus-within {
        outline: 2px solid var(--fl-accent, #3b82f6);
        outline-offset: 1px;
        border-color: var(--fl-accent, #3b82f6);
      }
      .display { flex: 1 1 auto; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .display[data-empty] { color: var(--fl-placeholder, #9aa0a6); }
      .display, .icon { pointer-events: none; }
      .icon { flex: none; width: 16px; height: 16px; opacity: 0.55; }
      /* The native input covers the whole field but is fully transparent:
         it stays interactive (focus/keyboard/click) while its locale text is hidden. */
      .native {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        border: 0;
        font: inherit;
        color: transparent;
        background: transparent;
        opacity: 0;
        cursor: inherit;
        pointer-events: none;   /* input no longer receives clicks — the field does */
      }
      .native:disabled { cursor: default; }
      .native::-webkit-calendar-picker-indicator { opacity: 0; pointer-events: none; }
    `;
  }

  template() {
    return `
      <label part="label" class="label" hidden></label>
      <div part="control" class="field">
        <span class="display" aria-hidden="true"></span>
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"
             fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="17" rx="2"></rect>
          <path d="M3 9h18M8 2v4M16 2v4"></path>
        </svg>
        <input class="native" type="date" />
      </div>
    `;
  }

  firstRendered() {
    this._input = this.$('input');
    this._display = this.$('.display');
    this._label = this.$('.label');
    this._field = this.$('.field');

    // Associate the visible label with the native control for screen readers.
    const id = `fl-dp-${Math.random().toString(36).slice(2, 9)}`;
    this._input.id = id;
    this._label.setAttribute('for', id);

    this._input.addEventListener('input', () => {
      this.value = this._input.value;
      this._renderDisplay();
      this._emitInput();
    });
    this._input.addEventListener('change', () => {
      this.value = this._input.value;
      this._renderDisplay();
      this._emitChange();
    });

    // Open on any click within the field. Listening on the container (not the
    // input) means clicks on the icon/text — which are siblings of the input —
    // bubble here too. The indicator's pointer-events:none keeps the browser
    // from opening the picker a second time on its own.
    this._field.addEventListener('click', () => {
      console.log('fl-date-picker: field clicked');
      this._openPicker();
    });

    this._input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._openPicker(); }
    });
  }

  updated(changed) {
    if (!this._input) return;

    if (changed.has('value') && this._input.value !== (this.value ?? '')) {
      this._input.value = this.value ?? '';
    }
    if (changed.has('value') || changed.has('placeholder')) this._renderDisplay();
    if (changed.has('disabled')) this._input.disabled = this.disabled;
    if (changed.has('readonly')) this._input.readOnly = this.readonly;
    if (changed.has('required')) this._input.required = this.required;
    if (changed.has('min')) this._toggleAttr(this._input, 'min', this.min);
    if (changed.has('max')) this._toggleAttr(this._input, 'max', this.max);
    if (changed.has('label')) {
      const has = !!this.label;
      this._label.textContent = this.label ?? '';
      this._label.hidden = !has;
      if (has) this._input.setAttribute('aria-label', this.label);
      else this._input.removeAttribute('aria-label');
    }
  }

  _renderDisplay() {
    const iso = this.value ?? '';
    if (iso) {
      this._display.textContent = iso.split('-').join('/'); // yyyy-mm-dd -> yyyy/mm/dd
      this._display.removeAttribute('data-empty');
    } else {
      this._display.textContent = this.placeholder || 'yyyy/mm/dd';
      this._display.setAttribute('data-empty', '');
    }
  }

  _openPicker() {
    if (this.disabled || this.readonly) return;
    this._input.focus();      // programmatic focus (pointer-events:none blocks click-focus)
    this._input.showPicker?.();
  }

  _toggleAttr(el, name, value) {
    if (value == null || value === '') el.removeAttribute(name);
    else el.setAttribute(name, value);
  }

  get valueAsDate() {
    return this.value ? new Date(`${this.value}T00:00:00`) : null;
  }

  set valueAsDate(date) {
    this.value = date instanceof Date && !Number.isNaN(date.getTime())
        ? date.toISOString().slice(0, 10)
        : '';
  }
}

if (!customElements.get('fl-date-picker')) {
  customElements.define('fl-date-picker', FLDatePicker);
}
