// datasource.js
//
// FLDataSource — a headless (non-rendering) data provider.
//
// It fetches JSON from `url` and exposes it to forms, tables and other
// components, which "attach" either by listening for the `datasourcereloaded`
// event or by calling `subscribe(fn)`. Data sources can be CHAINED: a child
// declares a `parent` and a `link`, and whenever the parent reloads (or its
// current record changes) the child reloads itself filtered by the linked
// field — or empties, if the parent has no single current record.
//
// Actions
//   list        — fetch many records:  GET url?action=list&<params>
//   get(id)     — fetch one record:    GET url?action=get&id=<id>&<params>
//   reload()    — re-run the current action (children: re-sync from parent)
//   select(rec) — mark a current record in list mode (drives children)
//
// Response shape (flexible)
//   list -> a JSON array, or { records:[…] }, or { data:[…] }
//   get  -> a JSON object, or { record:{…} }, or { data:{…} }
//
// Attributes / properties
//   url       string   endpoint returning JSON
//   action    string   "list" (default) | "get"
//   parent    string   id of the parent <fl-datasource> to chain from
//   link      string   "childParam=parentField[;childParam2=parentField2]"
//                       e.g. link="projectid=id"  ==> projectsales.projectid = project.id
//   params    object   JSON of extra query criteria, e.g. params='{"status":"open"}'
//   id-field  string   identity field name (default "id"), used by get()/select()
//   autoload  boolean  present => load on connect (top-level sources only)
//
// Events (all bubble + composed; detail always carries { id, action, … })
//   datasourceloading      { id, action }
//   datasourcereloaded     { id, action, records, record, current, empty, error, params }
//   datasourcecurrentchange{ id, action, current }         (fired by select())
//   datasourceerror        { id, error }
//
// Usage
//   <fl-datasource id="project"      url="/api/project.php"      action="list" autoload></fl-datasource>
//   <fl-datasource id="projectsales" url="/api/projectsales.php" action="list"
//                  parent="project" link="projectid=id"></fl-datasource>
//
//   const sales = document.getElementById('projectsales');
//   sales.subscribe(({ records, empty }) => renderTable(records, empty));
//
//   document.getElementById('project').get(2);   // -> project #2, sales auto-reload for it

import { FLBaseComponent } from './base-component.js';

export class FLDataSource extends FLBaseComponent {
  static properties = {
    url:      { type: String,  reflect: true },
    action:   { type: String,  reflect: true, default: 'list' },
    parent:   { type: String,  reflect: true },
    link:     { type: String,  reflect: true },
    params:   { type: Object,  reflect: false, default: null },
    idField:  { type: String,  reflect: true, attribute: 'id-field', default: 'id' },
    autoload: { type: Boolean, reflect: true, default: false },
  };

  styles() { return `:host { display: none !important; }`; }
  template() { return ''; }

  // ---- lifecycle -------------------------------------------------------

  firstRendered() {
    this._records = [];
    this._record = null;
    this._current = null;      // selected record in list mode
    this._loading = false;
    this._error = null;
    this._lastId = null;
    this._userParams = { ...(this.params || {}) };
    this._linkParams = {};     // replaced each time we sync from a parent
    this._subs = new Set();
  }

  connected() {
    // Listen at document level and filter by parent id. The emitting parent is
    // the event target, so we can read its currentRecord() directly — no need
    // to resolve the element up-front (robust to DOM order).
    this._onDsEvent = (e) => {
      if (!this.parent) return;
      if (e.detail?.id !== this.parent) return;
      const parentEl = (e.target && typeof e.target.currentRecord === 'function') ? e.target : this._resolveParent();
      this._syncFromParent(parentEl);
    };
    document.addEventListener('datasourcereloaded', this._onDsEvent);
    document.addEventListener('datasourcecurrentchange', this._onDsEvent);

    if (this.parent) {
      // Sync once to whatever the parent already holds (it may have loaded first).
      this._syncFromParent(this._resolveParent());
    } else if (this.autoload) {
      this.reload();
    }
  }

  disconnected() {
    document.removeEventListener('datasourcereloaded', this._onDsEvent);
    document.removeEventListener('datasourcecurrentchange', this._onDsEvent);
  }

  // ---- public API ------------------------------------------------------

  /** Current records (list mode) — always an array. */
  get records() { return this._records; }
  /** Current single record (get mode) or null. */
  get record() { return this._record; }
  /** Whichever this source currently "points at": the record in get mode, or the selected row in list mode. */
  currentRecord() { return this.action === 'get' ? this._record : this._current; }
  get loading() { return this._loading; }
  get error() { return this._error; }

  /** Fetch many. Optional params are merged into the persistent user criteria. */
  list(params) {
    if (params) this._userParams = { ...this._userParams, ...params };
    this.action = 'list';
    this._current = null;
    return this._run('list');
  }

  /** Fetch one by id. */
  get(id, extraParams) {
    this._lastId = id;
    if (extraParams) this._userParams = { ...this._userParams, ...extraParams };
    this.action = 'get';
    return this._run('get');
  }

  /** Re-run the current action. Children re-sync from their parent. */
  reload() {
    if (this.parent) {
      this._syncFromParent(this._resolveParent());
      return Promise.resolve();
    }
    return this.action === 'get' ? this._run('get') : this._run('list');
  }

  /**
   * In list mode, mark a record as the "current" one (e.g. a clicked table row).
   * Fires datasourcecurrentchange so chained children reload for it.
   */
  select(recordOrId) {
    let rec = recordOrId;
    if (rec != null && typeof rec !== 'object') {
      rec = this._records.find((r) => String(r?.[this.idField]) === String(recordOrId)) || null;
    }
    this._current = rec;
    this.emit('datasourcecurrentchange', { detail: { id: this.id, action: this.action, current: rec } });
    this._notifySubs();
  }

  /**
   * Attach a subscriber. It's called immediately with the current snapshot and
   * again on every reload / current change. Returns an unsubscribe function.
   */
  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    this._subs.add(fn);
    fn(this._snapshot());
    return () => this._subs.delete(fn);
  }

  // ---- internals -------------------------------------------------------

  _snapshot() {
    return {
      id: this.id,
      action: this.action,
      records: this._records,
      record: this._record,
      current: this.currentRecord(),
      empty: this.action === 'get' ? !this._record : this._records.length === 0,
      loading: this._loading,
      error: this._error,
    };
  }

  _resolveParent() {
    if (!this.parent) return null;
    const root = this.getRootNode();
    return (root && root.getElementById && root.getElementById(this.parent))
      || document.getElementById(this.parent);
  }

  _parseLink() {
    // "projectid=id;region=region" -> [{child:'projectid',parent:'id'}, …]
    return String(this.link || '')
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((pair) => {
        const [child, parent] = pair.split('=').map((x) => x.trim());
        return { child, parent: parent || child };
      });
  }

  _mapLink(parentRecord) {
    const out = {};
    for (const { child, parent } of this._parseLink()) {
      out[child] = parentRecord ? parentRecord[parent] : undefined;
    }
    return out;
  }

  _syncFromParent(parentEl) {
    const cur = parentEl && typeof parentEl.currentRecord === 'function' ? parentEl.currentRecord() : null;
    if (!cur) {
      // Parent is listing (or has no selection): a child that describes "the
      // records for ONE parent" has nothing to show.
      this._setEmpty();
      return;
    }
    this._linkParams = this._mapLink(cur);
    if (this.action === 'get') {
      const idVal = Object.values(this._linkParams)[0];
      this._lastId = idVal;
      this._run('get');
    } else {
      this._run('list');
    }
  }

  _setEmpty() {
    this._records = [];
    this._record = null;
    this._current = null;
    this._loading = false;
    this._error = null;
    this._emitReloaded({ empty: true });
    this._notifySubs();
  }

  _buildUrl(action) {
    const u = new URL(this.url, (typeof location !== 'undefined' ? location.href : 'http://localhost/'));
    u.searchParams.set('action', action);
    const merged = { ...this._userParams, ...this._linkParams };
    if (action === 'get' && this._lastId != null && merged[this.idField] == null) {
      merged.id = this._lastId;
    }
    for (const [k, v] of Object.entries(merged)) {
      if (v !== null && v !== undefined && v !== '') u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  async _run(action) {
    if (!this.url) { this._setEmpty(); return; }
    this._loading = true;
    this._error = null;
    this.emit('datasourceloading', { detail: { id: this.id, action } });
    try {
      const res = await fetch(this._buildUrl(action), { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`${this.id || 'datasource'}: HTTP ${res.status}`);
      const json = await res.json();

      if (action === 'list') {
        this._records = Array.isArray(json) ? json : (json.records ?? json.data ?? []);
        this._record = null;
      } else {
        let rec = (json && !Array.isArray(json)) ? (json.record ?? json.data ?? json) : (Array.isArray(json) ? json[0] : null);
        this._record = rec ?? null;
        this._records = [];
      }
      this._loading = false;
      this._emitReloaded({ empty: action === 'get' ? !this._record : this._records.length === 0 });
      this._notifySubs();
    } catch (err) {
      this._loading = false;
      this._error = err;
      this._records = [];
      this._record = null;
      this.emit('datasourceerror', { detail: { id: this.id, error: err } });
      this._emitReloaded({ empty: true, error: err });
      this._notifySubs();
    }
  }

  _emitReloaded(extra = {}) {
    this.emit('datasourcereloaded', {
      detail: {
        id: this.id,
        action: this.action,
        records: this._records,
        record: this._record,
        current: this.currentRecord(),
        empty: false,
        error: null,
        params: { ...this._userParams, ...this._linkParams },
        ...extra,
      },
    });
  }

  _notifySubs() {
    const snap = this._snapshot();
    this._subs.forEach((fn) => { try { fn(snap); } catch (_e) { /* ignore subscriber errors */ } });
  }
}

if (!customElements.get('fl-datasource')) {
  customElements.define('fl-datasource', FLDataSource);
}
