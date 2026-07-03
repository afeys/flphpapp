// weekday-picker.js
//
// FLWeekdayPicker — built on FLValueComponent.
//
// A weekday picker with optional AM/PM halves. Converted from the original
// FLHTMLElement version: it now uses Shadow DOM (no global ids / FLFunctions),
// exposes a real .value, participates in <form> submission, and fires the same
// input/change events as native controls.
//
// Value format (unchanged from the original):
//   [1]=Mon [2]=Tue [3]=Wed [4]=Thu [5]=Fri [6]=Sat [7]=Sun   (whole day)
//   [1A]..[7A] = AM only        [1P]..[7P] = PM only
//   e.g. "[1][3A][5P]" = all of Monday, Wednesday AM, Friday PM
//
// Usage:
//   <fl-weekdaypicker name="schedule" value="[1][3A]"></fl-weekdaypicker>
//   <fl-weekdaypicker ampm="false"></fl-weekdaypicker>   <!-- single row, no AM/PM -->
//   el.addEventListener('change', (e) => console.log(e.target.value));

import { FLValueComponent } from './base-value-component.js';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export class FLWeekdayPicker extends FLValueComponent {
  static properties = {
    // Default AM/PM ON, matching the original component.
    ampm: { type: Boolean, reflect: false, observe: true, default: true },
    label: { type: String, reflect: true },
    // value / name / disabled / required / readonly are inherited.
  };

  // Legacy-friendly attribute handling: the original API used ampm="false"
  // to disable, with AM/PM on by default. Boolean attributes are normally
  // presence-based, so we translate the string form here.
  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'ampm') {
      this.ampm = newValue === null ? true : newValue !== 'false';
      return;
    }
    super.attributeChangedCallback(name, oldValue, newValue);
  }

  styles() {
    return `
      :host { display: inline-block; font: inherit; }
      :host([disabled]) { opacity: 0.5; }
      .wrap {
        display: inline-block;
        padding: 8px 10px;
        border: 1px solid var(--fl-line, #ccc);
        border-radius: var(--fl-radius, 6px);
        background: var(--fl-surface, #fff);
      }
      .caption { font-size: 0.85em; color: var(--fl-label, #444); margin-bottom: 6px; }
      .grid {
        display: grid;
        grid-template-columns: auto repeat(7, 1.8em);
        gap: 4px 6px;
        align-items: center;
        justify-items: center;
      }
      .rowlabel { justify-self: end; font-size: 0.8em; color: var(--fl-label, #444); padding-right: 4px; }
      .daylabel { font-size: 0.8em; color: var(--fl-label, #444); }
      .cell { display: inline-flex; margin: 0; cursor: pointer; }
      .cell input { margin: 0; cursor: inherit; accent-color: var(--fl-accent, #3b82f6); }
      :host([disabled]) .cell,
      .cell input:disabled { cursor: default; }
    `;
  }

  template() {
    return `
      <div part="control" class="wrap" role="group">
        <div class="caption" hidden></div>
        <div class="grid"></div>
      </div>
    `;
  }

  firstRendered() {
    this._grid = this.$('.grid');
    this._caption = this.$('.caption');
    this._wrap = this.$('.wrap');

    // One delegated listener survives grid rebuilds (the .grid element persists).
    this._grid.addEventListener('change', () => this._onToggle());
  }

  updated(changed) {
    if (!this._grid) return;
    if (changed.has('ampm')) this._buildGrid();
    if (changed.has('ampm') || changed.has('value')) this._applyValueToCheckboxes();
    if (changed.has('ampm') || changed.has('disabled') || changed.has('readonly')) this._syncEnabled();
    if (changed.has('label')) {
      const has = !!this.label;
      this._caption.textContent = this.label ?? '';
      this._caption.hidden = !has;
      this._wrap.setAttribute('aria-label', this.label || 'Weekday selection');
    }
  }

  // --- Structure ---

  _buildGrid() {
    const header = ['<span class="rowlabel"></span>']
      .concat(DAY_LETTERS.map((l, i) => `<span class="daylabel" title="${DAY_NAMES[i]}">${l}</span>`))
      .join('');

    const row = (half, labelText) => {
      const cells = DAY_NAMES.map((name, i) => {
        const day = i + 1;
        const aria = half ? `${name} ${half.toUpperCase()}` : name;
        return `<label class="cell"><input type="checkbox" data-day="${day}" data-half="${half}" aria-label="${aria}"></label>`;
      }).join('');
      return `<span class="rowlabel">${labelText}</span>${cells}`;
    };

    this._grid.innerHTML = this.ampm
      ? header + row('am', 'AM') + row('pm', 'PM')
      : header + row('', '');
  }

  // --- Value <-> checkboxes ---

  _emptyDays() {
    const days = {};
    for (let d = 1; d <= 7; d++) days[d] = { am: false, pm: false };
    return days;
  }

  _parse(value) {
    const days = this._emptyDays();
    const re = /\[([1-7])([AP]?)\]/g;
    let m;
    while ((m = re.exec(value || '')) !== null) {
      const d = Number(m[1]);
      if (m[2] === 'A') days[d].am = true;
      else if (m[2] === 'P') days[d].pm = true;
      else { days[d].am = true; days[d].pm = true; }
    }
    return days;
  }

  _serialize(days) {
    let out = '';
    for (let d = 1; d <= 7; d++) {
      const { am, pm } = days[d];
      if (this.ampm) {
        if (am && pm) out += `[${d}]`;
        else if (am) out += `[${d}A]`;
        else if (pm) out += `[${d}P]`;
      } else if (am || pm) {
        out += `[${d}]`;
      }
    }
    return out;
  }

  _applyValueToCheckboxes() {
    const days = this._parse(this.value);
    for (const cb of this._grid.querySelectorAll('input[type="checkbox"]')) {
      const d = Number(cb.dataset.day);
      cb.checked = cb.dataset.half === 'am' ? days[d].am
        : cb.dataset.half === 'pm' ? days[d].pm
        : (days[d].am || days[d].pm); // single (no AM/PM) row
    }
  }

  _readValueFromCheckboxes() {
    const days = this._emptyDays();
    for (const cb of this._grid.querySelectorAll('input[type="checkbox"]')) {
      if (!cb.checked) continue;
      const d = Number(cb.dataset.day);
      if (cb.dataset.half === 'am') days[d].am = true;
      else if (cb.dataset.half === 'pm') days[d].pm = true;
      else { days[d].am = true; days[d].pm = true; } // single row = whole day
    }
    return days;
  }

  _syncEnabled() {
    const off = this.disabled || this.readonly;
    for (const cb of this._grid.querySelectorAll('input')) cb.disabled = off;
  }

  _onToggle() {
    this.value = this._serialize(this._readValueFromCheckboxes());
    this._emitInput();
    this._emitChange();
  }

  // --- Public helper ---

  /** Uncheck every day. (Programmatic, so it does not fire input/change.) */
  clear() {
    this.value = '';
  }
}

if (!customElements.get('fl-weekday-picker')) {
  customElements.define('fl-weekday-picker', FLWeekdayPicker);
}
