// base-value-component.js
//
// FLValueComponent — a form-associated base for any component that holds a value.
//
// On top of FLBaseComponent it adds:
//   - static formAssociated = true  + ElementInternals  (real <form> participation)
//   - value / name / disabled / required / readonly properties
//   - .value getter/setter that also updates the form value and validity
//   - Constraint validation proxies (checkValidity / reportValidity / validity ...)
//   - Form lifecycle callbacks (reset / disable / state restore)
//   - _emitInput() / _emitChange() helpers so subclasses fire native-style events
//
// Still abstract — subclasses (e.g. FLDatePicker) register the actual tag.

import { FLBaseComponent } from './base-component.js';

export class FLValueComponent extends FLBaseComponent {
  static formAssociated = true;

  static properties = {
    // `value` is observed (so <tag value="..."> works) but NOT reflected back,
    // mirroring how native inputs treat their value attribute as a default only.
    value: { type: String, reflect: false, observe: true, default: '' },
    name: { type: String, reflect: true },
    disabled: { type: Boolean, reflect: true, default: false },
    required: { type: Boolean, reflect: true, default: false },
    readonly: { type: Boolean, reflect: true, default: false },
  };

  constructor() {
    super();
    this._internals = typeof this.attachInternals === 'function' ? this.attachInternals() : null;
  }

  connected() {
    super.connected();
    this._syncFormValue();
    this._syncValidity();
  }

  propertyChangedCallback(name, oldValue, newValue) {
    super.propertyChangedCallback(name, oldValue, newValue);
    if (name === 'value') this._syncFormValue();
    if (name === 'value' || name === 'required') this._syncValidity();
  }

  // --- Form value & validity ---

  _syncFormValue() {
    this._internals?.setFormValue(this.value == null ? '' : String(this.value));
  }

  _isEmpty() {
    return this.value == null || this.value === '';
  }

  _syncValidity() {
    if (!this._internals) return;
    const anchor = this.$('[part="control"]') || undefined;
    if (this.required && this._isEmpty()) {
      this._internals.setValidity({ valueMissing: true }, 'Please fill out this field.', anchor);
    } else {
      this._internals.setValidity({});
    }
  }

  // --- Native-style event helpers for subclasses ---

  /** Fire an `input` event (bubbles + composed, like native controls). */
  _emitInput() {
    this.emit('input', { detail: { value: this.value }, bubbles: true, composed: true });
  }

  /** Fire a `change` event (bubbles, non-composed — matches native `change`). */
  _emitChange() {
    this.emit('change', { detail: { value: this.value }, bubbles: true, composed: false });
  }

  // --- Constraint validation API (proxied to ElementInternals) ---

  get validity() { return this._internals?.validity ?? null; }
  get validationMessage() { return this._internals?.validationMessage ?? ''; }
  get willValidate() { return this._internals?.willValidate ?? false; }
  get form() { return this._internals?.form ?? null; }
  checkValidity() { return this._internals?.checkValidity() ?? true; }
  reportValidity() { return this._internals?.reportValidity() ?? true; }

  // --- Form lifecycle ---

  formResetCallback() {
    this.value = this.getAttribute('value') ?? '';
  }

  formDisabledCallback(disabled) {
    this.disabled = disabled;
  }

  formStateRestoreCallback(state) {
    this.value = state ?? '';
  }
}
