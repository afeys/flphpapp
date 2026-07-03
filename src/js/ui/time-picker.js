// time-picker.js
//
// FLTimePicker — built on FLValueComponent.
//
// A 24-hour hh:mm field with live formatting, blur/Enter completion, optional
// rounding, keyboard stepping, AND a click-to-open dropdown of times.
//
// Text entry (ported from checkAndFormatTimeString):
//   - "1345" -> "13:45", "." -> ":", junk stripped; blur completes/clamps
//   - ArrowUp/Down step minutes (by rounded-to, else 1); PageUp/Down step hours
// Dropdown (click the clock icon):
//   - a single scrollable list of times from min..max
//   - step = rounded-to when set, otherwise 15 minutes (dropdown only)
//   - click / Enter selects; Esc or click-away closes
//
// .value is always "" or a canonical "HH:MM" string (24-hour).
//
// Usage:
//   <fl-timepicker name="start" label="Start" required></fl-timepicker>
//   <fl-timepicker name="dnd" rounded-to="15" value="09:07"></fl-timepicker>
//   <fl-timepicker rounded-to="30" min="08:00" max="18:00"></fl-timepicker>

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
        position: relative;
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
        flex: 1 1 auto; min-width: 0;
        margin: 0; padding: 0; border: 0;
        background: transparent; font: inherit; color: inherit;
        outline: none; font-variant-numeric: tabular-nums;
      }
      input::placeholder { color: var(--fl-placeholder, #9aa0a6); }
      input:disabled { cursor: default; }

      .iconbtn {
        flex: none; display: inline-flex; align-items: center; justify-content: center;
        margin: 0; padding: 0; border: 0; background: none; color: inherit; cursor: pointer;
        border-radius: 4px;
      }
      .iconbtn:disabled { cursor: default; }
      .iconbtn:focus-visible { outline: 2px solid var(--fl-accent, #3b82f6); outline-offset: 2px; }
      .icon { width: 16px; height: 16px; opacity: 0.55; }
      .iconbtn:hover .icon { opacity: 0.9; }

      .popup {
        position: absolute; z-index: 20; top: calc(100% + 4px); left: 0;
        min-width: 100%;
        background: var(--fl-surface, #fff);
        border: 1px solid var(--fl-line, #ccc);
        border-radius: var(--fl-radius, 6px);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
        padding: 4px;
      }
      .list { max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; }
      .opt {
        text-align: left; font: inherit; color: inherit; background: none; border: 0;
        padding: 6px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .opt:hover { background: rgba(0, 0, 0, 0.06); }
      .opt.active { background: var(--fl-accent, #3b82f6); color: #fff; }
      .opt[aria-selected="true"] { font-weight: 600; }
    `;
    }

    template() {
        return `
      <label part="label" class="label" hidden></label>
      <div part="control" class="field">
        <input class="native" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" />
        <button class="iconbtn" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Choose time" tabindex="-1">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"
               fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9"></circle>
            <path d="M12 7v5l3 2"></path>
          </svg>
        </button>
        <div class="popup" hidden>
          <div class="list" role="listbox"></div>
        </div>
      </div>
    `;
    }

    firstRendered() {
        this._input = this.$('input');
        this._label = this.$('.label');
        this._iconBtn = this.$('.iconbtn');
        this._popup = this.$('.popup');
        this._list = this.$('.list');
        this._uid = Math.random().toString(36).slice(2, 8);
        this._options = [];
        this._activeIndex = 0;

        const id = `fl-tp-${this._uid}`;
        this._input.id = id;
        this._label.setAttribute('for', id);

        // --- text entry ---
        this._input.addEventListener('input', () => {
            this._input.value = this._sanitize(this._input.value);
        });
        this._input.addEventListener('focus', () => this._close());
        this._input.addEventListener('blur', () => this._commit(this._input.value));
        this._input.addEventListener('keydown', (e) => this._onKeydown(e));

        // --- dropdown ---
        this._iconBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this._isOpen() ? this._close() : this._open();
        });
        // Keep focus on the input when clicking options (no blur-commit mid-pick).
        this._popup.addEventListener('mousedown', (e) => e.preventDefault());
        this._list.addEventListener('click', (e) => {
            const btn = e.target.closest('.opt');
            if (btn) this._choose(this._options[Number(btn.dataset.i)].value);
        });
    }

    disconnected() {
        this._close();
    }

    updated(changed) {
        if (!this._input) return;

        if (changed.has('value')) {
            const norm = this._normalize(this.value);
            if (norm !== (this.value ?? '')) this.value = norm;
            else this._input.value = this.value ?? '';
        }
        if (changed.has('roundedTo')) {
            const norm = this._normalize(this.value);
            if (norm !== (this.value ?? '')) this.value = norm;
        }
        if (changed.has('placeholder') || changed.has('roundedTo')) this._syncPlaceholder();
        if (changed.has('disabled') || changed.has('readonly')) {
            const off = this.disabled || this.readonly;
            this._input.disabled = this.disabled;
            this._input.readOnly = this.readonly;
            this._iconBtn.disabled = off;
            if (off) this._close();
        }
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

    // --- keyboard: list nav when open, stepping when closed ---

    _onKeydown(e) {
        if (this._isOpen()) {
            switch (e.key) {
                case 'Escape': e.preventDefault(); this._close(); break;
                case 'ArrowDown': e.preventDefault(); this._setActive(this._activeIndex + 1); break;
                case 'ArrowUp': e.preventDefault(); this._setActive(this._activeIndex - 1); break;
                case 'Home': e.preventDefault(); this._setActive(0); break;
                case 'End': e.preventDefault(); this._setActive(this._options.length - 1); break;
                case 'Enter':
                    e.preventDefault();
                    if (this._options[this._activeIndex]) this._choose(this._options[this._activeIndex].value);
                    break;
                default: break;
            }
            return;
        }
        const minuteStep = this.roundedTo > 0 ? this.roundedTo : 1;
        if (e.key === 'Enter') this._commit(this._input.value);
        else if (e.key === 'ArrowUp') { e.preventDefault(); this._step(minuteStep); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); this._step(-minuteStep); }
        else if (e.key === 'PageUp') { e.preventDefault(); this._step(60); }
        else if (e.key === 'PageDown') { e.preventDefault(); this._step(-60); }
        else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); this._open(); }
    }

    // --- dropdown internals ---

    _isOpen() { return this._popup && !this._popup.hidden; }

    _open() {
        if (this.disabled || this.readonly) return;
        this._buildOptions();
        this._popup.hidden = false;
        this._iconBtn.setAttribute('aria-expanded', 'true');

        let active = this._options.findIndex((o) => o.value === this.value);
        if (active < 0) active = 0;
        this._setActive(active);

        this._onDocPointer = (e) => {
            if (!e.composedPath().includes(this)) this._close();
        };
        document.addEventListener('click', this._onDocPointer, true);
    }

    _close() {
        if (!this._isOpen()) return;
        this._popup.hidden = true;
        this._iconBtn.setAttribute('aria-expanded', 'false');
        this._list.removeAttribute('aria-activedescendant');
        if (this._onDocPointer) {
            document.removeEventListener('click', this._onDocPointer, true);
            this._onDocPointer = null;
        }
    }

    _buildOptions() {
        const step = this.roundedTo > 0 ? this.roundedTo : 15; // dropdown default 15 min
        const lo = this.min ? Math.max(0, this._toMinutes(this.min)) : 0;
        const hi = this.max ? Math.min(1439, this._toMinutes(this.max)) : 1439;

        this._options = [];
        let html = '';
        for (let m = lo; m <= hi; m += step) {
            const v = this._format(m);
            const i = this._options.length;
            const selected = v === this.value ? ' aria-selected="true"' : '';
            html += `<button type="button" role="option"${selected} class="opt" data-i="${i}" id="opt-${this._uid}-${i}">${v}</button>`;
            this._options.push({ value: v, minutes: m });
        }
        this._list.innerHTML = html;
    }

    _setActive(i) {
        if (!this._options.length) return;
        i = Math.max(0, Math.min(this._options.length - 1, i));
        this._activeIndex = i;
        const items = this._list.children;
        for (const el of items) el.classList.remove('active');
        const el = items[i];
        if (!el) return;
        el.classList.add('active');
        this._list.setAttribute('aria-activedescendant', el.id);
        this._scrollIntoView(el);
    }

    _choose(value) {
        this._close();
        this._commit(value);
        this._input.focus();
    }

    _scrollIntoView(el) {
        try { el.scrollIntoView({ block: 'nearest' }); } catch { /* jsdom / unsupported */ }
    }

    // --- formatting / parsing (ported from checkAndFormatTimeString) ---

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

    // --- commit / step ---

    _commit(str) {
        const finalized = this._finalize(str);
        if (finalized === (this.value ?? '')) {
            this._input.value = this.value ?? '';
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
        this._input.value = next;
        if (next !== this.value) {
            this.value = next;
            this._emitInput();
            this._emitChange();
        }
    }

    get valueAsDate() {
        return this.value ? new Date(`1970-01-01T${this.value}:00`) : null;
    }

    set valueAsDate(date) {
        this.value = date instanceof Date && !Number.isNaN(date.getTime())
            ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
            : '';
    }
}

if (!customElements.get('fl-timepicker')) {
    customElements.define('fl-time-picker', FLTimePicker);
}
