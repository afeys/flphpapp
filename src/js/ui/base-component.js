// base-component.js
//
// FLBaseComponent — the foundation for all FL web components.
//
// Responsibilities:
//   - Shadow DOM setup
//   - A small declarative property system (like Lit's `static properties`)
//   - Two-way sync between HTML attributes and JS properties
//   - Type coercion (Boolean / Number / String / Object)
//   - Batched render lifecycle (template + updated hooks)
//   - Convenience helpers: this.$(), this.$$(), this.emit()
//
// This class is *abstract*: it is not registered as a custom element itself.
// Subclasses register themselves with customElements.define().

/** Convert `fooBar` -> `foo-bar` for attribute names. */
function toKebabCase(str) {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Coerce a value assigned via JS (el.foo = x) into its declared type. */
function coerceProperty(value, type) {
  if (type === Boolean) return Boolean(value);
  if (type === Number) return value == null || value === '' ? null : Number(value);
  if (type === String) return value == null ? value : String(value);
  return value; // Object / Array: stored as-is
}

/** Parse an HTML attribute value (string | null) into its declared type. */
function fromAttribute(attrValue, type) {
  if (type === Boolean) return attrValue !== null; // presence => true
  if (type === Number) return attrValue == null ? null : Number(attrValue);
  if (type === String) return attrValue;
  if (attrValue == null) return null;
  try { return JSON.parse(attrValue); } catch { return null; }
}

/** Serialize a property value into an attribute string, or null to remove it. */
function toAttribute(value, type) {
  if (type === Boolean) return value ? '' : null;
  if (value == null) return null;
  if (type === Object || type === Array) return JSON.stringify(value);
  return String(value);
}

export class FLBaseComponent extends HTMLElement {
  /**
   * Subclasses declare properties here. Each entry:
   *   type:      Boolean | Number | String | Object   (default String)
   *   reflect:   property -> attribute sync            (default true)
   *   observe:   attribute -> property sync            (default true)
   *   attribute: custom attribute name                 (default kebab-case of key)
   *   default:   initial value
   *
   * @type {Record<string, object>}
   */
  static properties = {};

  // --- Static schema plumbing (merged across the class hierarchy) ---

  /** Merge `static properties` from this class and all ancestors. Cached per class. */
  static _propertyDefs() {
    if (Object.prototype.hasOwnProperty.call(this, '_defs')) return this._defs;

    const chain = [];
    let ctor = this;
    while (ctor && ctor !== HTMLElement) {
      if (Object.prototype.hasOwnProperty.call(ctor, 'properties')) {
        chain.unshift(ctor.properties);
      }
      ctor = Object.getPrototypeOf(ctor);
    }

    const defs = {};
    for (const props of chain) {
      for (const [name, raw] of Object.entries(props)) {
        defs[name] = {
          name,
          type: raw.type || String,
          reflect: raw.reflect !== false,
          observe: raw.observe !== false,
          attribute: raw.attribute || toKebabCase(name),
          default: raw.default,
        };
      }
    }
    this._defs = defs;
    return defs;
  }

  /** Attributes the browser will watch (those with observe !== false). */
  static get observedAttributes() {
    return Object.values(this._propertyDefs())
        .filter((def) => def.observe)
        .map((def) => def.attribute);
  }

  static _defByAttribute(attr) {
    return Object.values(this._propertyDefs()).find((d) => d.attribute === attr) || null;
  }

  /** Install property accessors on the prototype exactly once per class. */
  static _finalize() {
    if (Object.prototype.hasOwnProperty.call(this, '_finalized')) return;
    this._finalized = true;
    for (const def of Object.values(this._propertyDefs())) {
      Object.defineProperty(this.prototype, def.name, {
        configurable: true,
        enumerable: true,
        get() { return this._values[def.name]; },
        set(value) { this._setProperty(def, value); },
      });
    }
  }

  // --- Instance ---

  constructor() {
    super();
    this.constructor._finalize();
    this.attachShadow({ mode: 'open' });

    this._values = {};          // backing store for properties
    this._reflectingAttrs = new Set(); // attributes mid-reflection (guards only their own echo)
    this._hasRendered = false;
    this._changed = new Map();  // props changed since last flush
    this._updateScheduled = false;

    // Seed defaults directly into the backing store (no reflection in ctor).
    for (const def of Object.values(this.constructor._propertyDefs())) {
      let initial = def.default;
      if (initial === undefined && def.type === Boolean) initial = false;
      this._values[def.name] = initial === undefined ? undefined : coerceProperty(initial, def.type);
    }
  }

  connectedCallback() {
    // Handle properties set on the element *before* it was upgraded.
    for (const def of Object.values(this.constructor._propertyDefs())) {
      this._upgradeProperty(def.name);
    }
    if (!this._hasRendered) {
      this._renderInitial();
      this._hasRendered = true;
    }
    this.connected?.();
  }

  disconnectedCallback() {
    this.disconnected?.();
  }

  attributeChangedCallback(attrName, _oldVal, newVal) {
    if (this._reflectingAttrs.has(attrName)) return; // echo from our own reflection of THIS attribute
    const def = this.constructor._defByAttribute(attrName);
    if (!def) return;
    this[def.name] = fromAttribute(newVal, def.type);
  }

  // --- Property engine ---

  _setProperty(def, value) {
    const next = coerceProperty(value, def.type);
    const prev = this._values[def.name];
    if (prev === next) return;
    this._values[def.name] = next;
    if (def.reflect) this._reflectToAttribute(def, next);
    this.propertyChangedCallback(def.name, prev, next);
  }

  _reflectToAttribute(def, value) {
    const attrValue = toAttribute(value, def.type);
    this._reflectingAttrs.add(def.attribute);
    if (attrValue === null) this.removeAttribute(def.attribute);
    else this.setAttribute(def.attribute, attrValue);
    this._reflectingAttrs.delete(def.attribute);
  }

  _upgradeProperty(name) {
    if (Object.prototype.hasOwnProperty.call(this, name)) {
      const value = this[name];
      delete this[name];   // remove the shadowing own data property
      this[name] = value;  // route through the prototype setter
    }
  }

  // --- Render lifecycle (batched via microtask) ---

  propertyChangedCallback(name, oldValue, _newValue) {
    if (!this._changed.has(name)) this._changed.set(name, oldValue);
    this._scheduleUpdate();
  }

  _scheduleUpdate() {
    if (this._updateScheduled) return;
    this._updateScheduled = true;
    queueMicrotask(() => {
      this._updateScheduled = false;
      const changed = this._changed;
      this._changed = new Map();
      if (this._hasRendered && changed.size) this.updated(changed);
    });
  }

  _renderInitial() {
    const css = this.styles();
    const markup = this.template();
    this.shadowRoot.innerHTML =
        (css ? `<style>${css}</style>` : '') + (markup || '');
    this.firstRendered();
    // Sync every property to the freshly-rendered DOM once.
    const all = new Map(
        Object.keys(this.constructor._propertyDefs()).map((n) => [n, undefined]),
    );
    this.updated(all);
  }

  // --- Overridable hooks (safe no-op defaults) ---

  /** Return a CSS string for the shadow root, or '' for none. */
  styles() { return ''; }

  /** Return the initial shadow-DOM markup (rendered once). */
  template() { return ''; }

  /** Called once after the initial render — cache refs and bind listeners here. */
  firstRendered() {}

  /** Called (batched) whenever reactive properties change. @param {Map} changed */
  updated(_changed) {}

  /** Called on connect (after first render). */
  connected() {}

  /** Called on disconnect. */
  disconnected() {}

  // --- Helpers ---

  /** Query one element inside the shadow root. */
  $(selector) { return this.shadowRoot.querySelector(selector); }

  /** Query all matching elements inside the shadow root (as an array). */
  $$(selector) { return Array.from(this.shadowRoot.querySelectorAll(selector)); }

  /** Dispatch a bubbling (by default) event on the host element. */
  emit(type, { detail = null, bubbles = true, composed = true, cancelable = false } = {}) {
    const event = new CustomEvent(type, { detail, bubbles, composed, cancelable });
    this.dispatchEvent(event);
    return event;
  }
}
