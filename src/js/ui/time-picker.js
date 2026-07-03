// time-picker.js
//
// FLTimePicker — built on FLValueComponent.
//
// A 24-hour hh:mm text field with live formatting, blur completion, and optional
// rounding. Ports the behaviour of the old checkAndFormatTimeString():
//   - typing "1345" becomes "13:45", "." becomes ":", junk chars are stripped
//   - on blur the value is completed/padded and clamped to a valid time
//   - ArrowUp/ArrowDown step the time
//
// Modes:
//   - Default: any valid time (no rounding).
//   - rounded-to="N": on commit, minutes round to the nearest N (e.g. 15, 5, 30).
//
// .value is always "" or a canonical "HH:MM" string (24-hour).
//
// Usage:
//   <fl-timepicker name="start" label="Start" required></fl-timepicker>
//   <fl-timepicker name="dnd" rounded-to="15" value="09:07"></fl-timepicker>  <!-- shows 09:00 -->
//   el.addEventListener('change', (e) => console.log(e.target.value));

import { FLValueComponent } from './base-value-component.js';

export class FLTimePicker extends FLValueComponent {
    static properties = {
        roundedTo: { type: Number, reflect: true, attribute: 'rounded-to' },
        min: { type: String, reflect: true },   // "HH:MM"
        max: { type: String, reflect: true },   // "HH:MM"
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
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 8.5em;
        padding: 6px 10px;
        border: 1px solid var(--fl-line, #ccc);
        border-radius: var(--fl-radius, 6px);
        background: var(--fl-surface, #fff);
        color: inherit;
      }
      .field:focus-within {
        outline: 2px solid var(--fl-accent, #3b82f6);
        outline-offset: 1px;
        border-color: var(--fl-accent, #3b82f6);
      }
      input {
        flex: 1 1 auto;
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        color: inherit;
        outline: none;
        font-variant-numeric: tabular-nums;
      }
      input::placeholder { color: var(--fl-placeholder, #9aa0a6); }
      input:disabled { cursor: default; }
      .icon { flex: none; width: 16px; height: 16px; opacity: 0.55; }
    `;
    }

    template() {
        return `
      <label part="label" class="label" hidden></label>
      <div part="control" class="field">
        <input class="native" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" />
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"
             fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M12 7v5l3 2"></path>
        </svg>
      </div>
    `;
    }

    firstRendered() {
        this._input = this.$('input');
        this._label = this.$('.label');

        const id = `fl-tp-${Math.random().toString(36).slice(2, 9)}`;
        this._input.id = id;
        this._label.setAttribute('for', id);

        // Live formatting while typing (no commit yet).
        this._input.addEventListener('input', () => {
            this._input.value = this._sanitize(this._input.value);
        });
        // Commit + round on blur or Enter.
        this._input.addEventListener('blur', () => this._commit(this._input.value));
        this._input.addEventListener('keydown', (e) => {
            const minuteStep = this.roundedTo > 0 ? this.roundedTo : 1;
            if (e.key === 'Enter') {
                this._commit(this._input.value);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault(); this._step(minuteStep);        // minutes up
            } else if (e.key === 'ArrowDown') {
                e.preventDefault(); this._step(-minuteStep);       // minutes down
            } else if (e.key === 'PageUp') {
                e.preventDefault(); this._step(60);                // one hour up
            } else if (e.key === 'PageDown') {
                e.preventDefault(); this._step(-60);               // one hour down
            }
        });
    }

    updated(changed) {
        if (!this._input) return;

        if (changed.has('value')) {
            const norm = this._normalize(this.value);
            if (norm !== (this.value ?? '')) {
                this.value = norm;           // re-normalize; display syncs on the next pass
            } else {
                this._input.value = this.value ?? '';
            }
        }
        if (changed.has('roundedTo')) {
            const norm = this._normalize(this.value);
            if (norm !== (this.value ?? '')) this.value = norm;
        }
        if (changed.has('placeholder') || changed.has('roundedTo')) this._syncPlaceholder();
        if (changed.has('disabled')) this._input.disabled = this.disabled;
        if (changed.has('readonly')) this._input.readOnly = this.readonly;
        if (changed.has('required')) this._input.required = this.required;
        if (changed.has('label')) {
            const has = !!this.label;
            this._label.textContent = this.label ?? '';
            this._label.hidden = !has;
            if (has) this._input.setAttribute('aria-label', this.label);
            else this._input.removeAttribute('aria-label');
        }
    }

    _syncPlaceholder() {
        const custom = this.placeholder != null && this.placeholder !== '';
        this._input.placeholder = custom
            ? this.placeholder
            : (this.roundedTo > 0 ? `hh:mm (${this.roundedTo} min)` : 'hh:mm');
    }

    // --- Formatting / parsing (ported from checkAndFormatTimeString) ---

    /** Light cleanup applied on every keystroke; may return a partial string. */
    _sanitize(str) {
        if (/^\d{4}$/.test(str)) str = str.slice(0, 2) + ':' + str.slice(2);
        str = str.replace('.', ':').replace(/[^0-9:]/g, '');
        const i = str.indexOf(':');
        if (i !== -1) {
            let before = str.slice(0, i);
            while (before.length < 2) before = '0' + before;
            return before.slice(0, 2) + ':' + str.slice(i + 1).slice(0, 2);
        }
        return str.length > 2 ? str.slice(0, 2) + ':' + str.slice(2, 4) : str;
    }

    /** Complete a (possibly partial) string into a canonical, clamped "HH:MM". */
    _finalize(str) {
        str = this._sanitize(str);
        if (str === '') return '';

        let [before, after] = str.includes(':') ? str.split(':') : [str, '00'];
        before = (before || '0').padStart(2, '0').slice(0, 2);
        after = (after || '0').padEnd(2, '0').slice(0, 2);

        let total = Math.min(23, parseInt(before, 10) || 0) * 60
            + Math.min(59, parseInt(after, 10) || 0);

        if (this.roundedTo > 0) {
            total = Math.round(total / this.roundedTo) * this.roundedTo;
            if (total >= 1440) total = Math.floor(1439 / this.roundedTo) * this.roundedTo;
        }
        return this._format(this._clamp(total));
    }

    /** Normalize an externally-set value (or '' for empty). */
    _normalize(value) {
        return value == null || value === '' ? '' : this._finalize(String(value));
    }

    _clamp(total) {
        let lo = 0;
        let hi = 1439;
        if (this.min) lo = Math.max(0, this._toMinutes(this.min));
        if (this.max) hi = Math.min(1439, this._toMinutes(this.max));
        return Math.min(hi, Math.max(lo, total));
    }

    _toMinutes(hhmm) {
        const [h, m] = String(hhmm).split(':').map((n) => parseInt(n, 10) || 0);
        return h * 60 + m;
    }

    _format(total) {
        const h = Math.floor(total / 60);
        const m = total % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    // --- Commit / step ---

    _commit(str) {
        const finalized = this._finalize(str);
        if (finalized === (this.value ?? '')) {
            this._input.value = this.value ?? ''; // re-sync canonical form
            return;
        }
        this.value = finalized;
        this._emitInput();
        this._emitChange();
    }

    _step(deltaMinutes) {
        if (this.disabled || this.readonly) return;
        const base = this._finalize(this._input.value || this.value || '00:00') || '00:00';
        // Clamp to [min, max] (default 00:00..23:59) — do NOT wrap, so stepping
        // sticks to the lower or upper limit depending on direction.
        const next = this._format(this._clamp(this._toMinutes(base) + deltaMinutes));
        this._input.value = next; // reflect immediately for rapid repeats
        if (next !== this.value) {
            this.value = next;
            this._emitInput();
            this._emitChange();
        }
    }
}

if (!customElements.get('fl-timepicker')) {
    customElements.define('fl-time-picker', FLTimePicker);
}
