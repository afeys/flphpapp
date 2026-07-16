// table.js
//
// FLTable — a data grid rebuilt on FLBaseComponent (Shadow DOM + the FL
// property/lifecycle/emit conventions used by the rest of the suite).
//
// This is PHASE 1: the core, read-only-plus-selection grid. It covers
// columns, JSON data loading, pagination, header multi-sort, quick filter,
// programmatic advanced filtering, value convertors, declarative conditional
// formatting (applied at render), row/record selection, an empty message,
// minimal modes, events, and a clean public API. The interactive builder
// popups (advanced filter/sort/format), export, drag-drop sort, row-action
// icons, grouping and inline editing are later phases and are called out in
// TODOs so the seams are visible.
//
// Design notes
//   - The grid lives entirely in the shadow root. The <fl-table-column> (and
//     friends) are LIGHT-DOM config children: they are read once at connect
//     and, because the shadow root has no <slot>, they never render. We never
//     touch the host's innerHTML.
//   - No global dependencies (no FLFunctions/FLUI/callMethod). Everything the
//     component needs is a small private helper here; app hooks are events.
//   - Theming is via CSS custom properties (with fallbacks) so the host page
//     can restyle without piercing the shadow boundary.
//
// Config markup
//   <fl-table id="t1"
//             dataloaderurl="/api/data.php?screen=project"
//             title="Projects"
//             primarykeyfield="id"
//             pagination="top bottom prevnext"
//             recordsperpage="15"
//             nrofpaginationbuttons="5"
//             emptymessage="No projects found."
//             sortorder="code asc"
//             url-base="/">
//     <fl-table-column name="id"   label="ID"   datafield="id" hidden></fl-table-column>
//     <fl-table-column name="code" label="Code" datafield="code"></fl-table-column>
//     <fl-table-column name="cust" label="Customer" datafield="customer" convertor="custlink"></fl-table-column>
//     <fl-valueconvertor name="custlink" type="recordidlabeltolink" view="company"></fl-valueconvertor>
//     <fl-table-conditional-formatting target="[row]" andor="all" background-color="#ffe6e6">
//        <fl-table-condition datafield="status" operator="eq" parameter="closed"></fl-table-condition>
//     </fl-table-conditional-formatting>
//     <fl-table-footercolumn colspan="2"></fl-table-footercolumn>
//   </fl-table>
//
// Server JSON contract (unchanged from the original)
//   { "data": [ {…}, {…} ], "totalrecs": 123, "page": 1 }
//
// Events (bubble + composed, names kept from the original for compatibility)
//   tablerendered · tableload · recordselect · pagechange · filterchange · orderchange · rowadded

import { FLBaseComponent } from './base-component.js';

// ---------------------------------------------------------------------------
// small private helpers (replacing the old FLFunctions dependency)
// ---------------------------------------------------------------------------

let _uid = 0;
const uniqId = (prefix = 'fl') => `${prefix}-${Date.now().toString(36)}-${(_uid++).toString(36)}`;

const isEl = (x) => !!x && typeof x === 'object' && x.nodeType === 1;

function stripTags(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html ?? '');
  return tmp.textContent || tmp.innerText || '';
}

// Minimal escaping for the client-built query fragment. NOTE: this mirrors the
// original design where the client sends a SQL-ish "advancedfilter" string; the
// SERVER must still treat it as untrusted and parameterize/validate. Prefer
// moving to a structured (JSON) filter on the server when you can.
function escapeParam(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// The set of filter/condition operators shared by advanced filter + conditional
// formatting, with both a SQL builder and a client-side evaluator.
const OPERATORS = {
  eq:  { sql: (f, p) => `lower(${f}) = '${escapeParam(p)}'`,           test: (v, p) => v === p },
  ne:  { sql: (f, p) => `lower(${f}) <> '${escapeParam(p)}'`,          test: (v, p) => v !== p },
  gt:  { sql: (f, p) => `lower(${f}) > '${escapeParam(p)}'`,           test: (v, p) => v > p },
  lt:  { sql: (f, p) => `lower(${f}) < '${escapeParam(p)}'`,           test: (v, p) => v < p },
  ge:  { sql: (f, p) => `lower(${f}) >= '${escapeParam(p)}'`,          test: (v, p) => v >= p },
  le:  { sql: (f, p) => `lower(${f}) <= '${escapeParam(p)}'`,          test: (v, p) => v <= p },
  bw:  { sql: (f, p) => `lower(${f}) like '${escapeParam(p)}%'`,       test: (v, p) => v.startsWith(p) },
  dbw: { sql: (f, p) => `lower(${f}) not like '${escapeParam(p)}%'`,   test: (v, p) => !v.startsWith(p) },
  ew:  { sql: (f, p) => `lower(${f}) like '%${escapeParam(p)}'`,       test: (v, p) => v.endsWith(p) },
  dew: { sql: (f, p) => `lower(${f}) not like '%${escapeParam(p)}'`,   test: (v, p) => !v.endsWith(p) },
  cnt: { sql: (f, p) => `lower(${f}) like '%${escapeParam(p)}%'`,      test: (v, p) => v.includes(p) },
  dcnt:{ sql: (f, p) => `lower(${f}) not like '%${escapeParam(p)}%'`,  test: (v, p) => !v.includes(p) },
  in:  {
    sql: (f, p) => `lower(${f}) in (${String(p).split(',').map((x) => `'${escapeParam(x.trim())}'`).join(',')})`,
    test: (v, p) => String(p).split(',').map((x) => x.trim()).includes(v),
  },
};

// Human labels for the operators, in the order they appear in the builder's
// operator dropdown. Kept alongside OPERATORS so the two never drift apart.
const OPERATOR_LABELS = [
  ['eq', 'Equals'],
  ['ne', 'Not equals'],
  ['in', 'In (comma list)'],
  ['gt', 'Greater than'],
  ['lt', 'Less than'],
  ['ge', 'Greater than or equal to'],
  ['le', 'Less than or equal to'],
  ['bw', 'Starts with'],
  ['dbw', 'Does not start with'],
  ['ew', 'Ends with'],
  ['dew', 'Does not end with'],
  ['cnt', 'Contains'],
  ['dcnt', 'Does not contain'],
];

// Recognised per-row action icons (opt-in via the `rowactions` attribute).
// Clicking one emits `fl-table-rowaction` with { action, recordid, record } —
// the app decides what to do (open a dialog, navigate, etc.). No global calls.
const ROW_ACTIONS = {
  edit:       { icon: 'edit',        title: 'Edit' },
  comment:    { icon: 'chat',        title: 'Comments' },
  comments:   { icon: 'chat',        title: 'Comments' },
  open:       { icon: 'open_in_new', title: 'Open in new tab' },
  opennewtab: { icon: 'open_in_new', title: 'Open in new tab' },
};

// Toolbar features that can be switched on/off via attributes. Each _show key
// maps to the attribute tokens that refer to it (aliases are forgiving). Two
// ways to control them (see _applyMinimalModes):
//   • features="quickfilter,clearfilter"   → allowlist: only these are shown
//   • no-export no-sort no-filter …        → turn specific features off
const FEATURE_ALIASES = {
  quickfilter:          ['quickfilter', 'search'],
  clearfilter:          ['clearfilter'],
  refresh:              ['refresh', 'reload'],
  columnsort:           ['columnsort', 'headersort'],
  advancedfilter:       ['advancedfilter', 'filter'],
  advancedsort:         ['advancedsort', 'sort'],
  conditionalformatter: ['conditionalformatter', 'formatting', 'conditionalformatting'],
  export:               ['export'],
  clicktofilter:        ['clicktofilter'],
  group:                ['group', 'grouping'],
  add:                  ['add', 'addbutton'],
};

class FLValueConvertor {
  constructor(name = '', type = '', view = 'home') {
    this.name = name;
    this.type = type;
    this.view = view;
  }

  convert(value, _record, urlBase = '') {
    if (value === null || value === undefined || value === '') return value;

    if (this.type === 'timestamptodate') {
      return String(value).substring(0, 10);
    }
    if (this.type === 'striphtml') {
      return stripTags(value);
    }
    if (this.type === 'booleantoyesno') {
      return value === 1 || value === '1' ? 'Y' : 'N';
    }
    if (this.type === 'modeliddesctolink') {
      const parts = String(value).split('|');
      if (parts.length !== 3) return value;
      const [model, id, description] = parts;
      return this._link(`${urlBase}index.php?view=${model.toLowerCase()}&id=${parseInt(id, 10)}`, description);
    }
    if (this.type === 'recordidlabeltolink') {
      const span = document.createElement('span');
      let first = true;
      for (const item of String(value).split(',')) {
        if (item === '') continue;
        const sep = item.indexOf('|');
        const id = item.substring(0, sep);
        const label = item.substring(sep + 1);
        if (!first) span.appendChild(document.createTextNode(', '));
        span.appendChild(this._link(`${urlBase}index.php?view=${this.view}&id=${id}`, label));
        first = false;
      }
      return span;
    }
    if (this.type === 'fileidnametodownloadlink') {
      const sep = String(value).indexOf('|');
      const id = String(value).substring(0, sep);
      const label = String(value).substring(sep + 1);
      const a = this._link(`${urlBase}apphandler.php?action=viewattachment&attachmentid=${id}`, label);
      a.setAttribute('target', '_new');
      return a;
    }
    return value;
  }

  _link(href, text) {
    const a = document.createElement('a');
    a.setAttribute('href', href);
    a.appendChild(document.createTextNode(text));
    return a;
  }
}

// ---------------------------------------------------------------------------
// FLTable
// ---------------------------------------------------------------------------

export class FLTable extends FLBaseComponent {
  static properties = {
    dataloaderurl:         { type: String,  reflect: true },
    title:                 { type: String,  reflect: true },
    pagination:            { type: String,  reflect: true, default: 'top bottom prevnext' },
    recordsperpage:        { type: Number,  reflect: true, default: 15 },
    nrofpaginationbuttons: { type: Number,  reflect: true, default: 5 },
    primarykeyfield:       { type: String,  reflect: true, default: 'id' },
    emptymessage:          { type: String,  reflect: true, default: 'No records found.' },
    highlightselectedrow:  { type: Boolean, reflect: true, default: true },
    minimal:               { type: Boolean, reflect: true, default: false },
    minimalwithpagination: { type: Boolean, reflect: true, default: false },
    urlBase:               { type: String,  reflect: true, attribute: 'url-base', default: '' },
    exporturl:             { type: String,  reflect: true, attribute: 'export-url', default: '' },
    editurl:               { type: String,  reflect: true, attribute: 'edit-url', default: '' },
    addurl:                { type: String,  reflect: true, attribute: 'add-url', default: '' },
  };

  // ---- lifecycle -------------------------------------------------------

  firstRendered() {
    // Cache the skeleton refs built once by template().
    this._elWrap    = this.$('.fltable-wrap');
    this._elTitle   = this.$('.fltable-title');
    this._elToolbar = this.$('.fltable-toolbar');
    this._elPagTop  = this.$('.fltable-pagination-top');
    this._elPagBot  = this.$('.fltable-pagination-bottom');
    this._elHead    = this.$('.fltable-colheaders');
    this._elBody    = this.$('.fltable-body');
    this._elFoot    = this.$('.fltable-foot');

    // Builder popup refs (Phase 2+). `_dlgApplyFn` holds the handler for the
    // currently-open builder so the shared Apply button knows what to do.
    this._dlg        = this.$('.fltable-dialog');
    this._dlgTitle   = this.$('.fltable-dialog-title');
    this._dlgBody    = this.$('.fltable-dialog-body');
    this._dlgApplyBtn = this.$('.fltable-dialog-apply');
    this._dlgApplyFn = null;
    this.$('.fltable-dialog-cancel').addEventListener('click', (e) => { e.stopPropagation(); this._closeDialog(); });
    this.$('.fltable-dialog-apply').addEventListener('click', (e) => { e.stopPropagation(); if (this._dlgApplyFn) this._dlgApplyFn(); });

    // One delegated click handler for the whole grid.
    this.$('.fltable-wrap').addEventListener('click', (e) => this._onClick(e));
    // Double-click enters inline edit on an editable cell (non-conflicting with
    // single-click selection / click-to-filter).
    this.$('.fltable-wrap').addEventListener('dblclick', (e) => this._onDblClick(e));

    // Runtime state.
    this._columns = [];
    this._footercolumns = [];
    this._convertors = [];
    this._conditionalformatting = [];
    this._extrabuttons = [];
    this._sortorder = [];         // ["code asc", "name desc"]
    this._advancedfilter = [];    // [["code","cnt","x"], …]
    this._filter = '';            // quick filter text
    this._click2filter = false;   // when true, cell clicks add filter conditions
    this._page = 1;
    this._totalrecords = 0;
    this._totalpages = 1;
    this._startpage = 1;
    this._endpage = 1;
    this._visiblecolumns = 0;
    this._records = [];
    this._recordsById = new Map();
    this._selectedRecordId = null;
    this._hasRowFormattings = false;
    this._hasCellFormattings = false;
    this._groupby = [];               // group field names (multi-level)
    this._hasGrouping = false;
    this._collapsedGroups = new Set(); // collapsed group paths (keyed by JSON path)
    this._editing = null;             // active inline editor, or null
    this._addingRow = null;           // active inline add-row, or null
    this._validators = new Map();     // field -> (value, record) => true | "error message"
    this._connectedDone = false;  // set true at the end of connected()
    // The inputs that were in effect for the last loadData(); used by updated()
    // to decide whether a property change actually requires a reload (avoids a
    // spurious second fetch from the post-upgrade updated() flush).
    this._applied = { dataloaderurl: undefined, recordsperpage: undefined };
  }

  connected() {
    this._applyMinimalModes();  // builds this._show (needed by _readConfig column count)
    this._readConfig();
    this._renderToolbar();
    this.setTitle(this.title || '');
    this.loadData();          // sets this._applied to the inputs it used
    this._connectedDone = true;
    this.emit('tablerendered');
  }

  // Reacts to runtime property changes. Rather than trusting the timing of the
  // base class's batched flush (which can land before or after connect), we
  // reload only when a load-affecting property ACTUALLY differs from what the
  // last loadData() used. That makes the post-upgrade flush a no-op (nothing
  // changed since the initial load) while genuine later changes still reload.
  updated(changed) {
    if (!this._connectedDone) return;                 // config not read yet
    if (changed.has('title')) this.setTitle(this.title || '');

    let reload = false;
    if (this.dataloaderurl !== this._applied.dataloaderurl) reload = true;
    if (Number(this.recordsperpage) !== this._applied.recordsperpage) { this._page = 1; reload = true; }
    if (reload) this.loadData();
  }

  // ---- config parsing (light-DOM children -> internal state) ----------

  _readConfig() {
    this._columns       = Array.from(this.querySelectorAll('fl-table-column'));
    this._footercolumns = Array.from(this.querySelectorAll('fl-table-footercolumn'));
    this._extrabuttons  = Array.from(this.querySelectorAll('fl-table-button'));

    // value convertors
    this._convertors = Array.from(this.querySelectorAll('fl-valueconvertor')).map((el) =>
      new FLValueConvertor(el.getAttribute('name') || '', el.getAttribute('type') || '', el.getAttribute('view') || 'home'),
    );

    // declarative conditional formatting
    this._conditionalformatting = Array.from(this.querySelectorAll('fl-table-conditional-formatting')).map((cf) => {
      const target = this._normalizeTarget(cf.getAttribute('target') || '[row]');
      return {
        glue: (cf.getAttribute('andor') || 'all').toLowerCase(),           // "all" | "any"
        target,                                                            // "[row]" | datafield
        foregroundcolor: cf.getAttribute('text-color') || '',
        backgroundcolor: cf.getAttribute('background-color') || '',
        applyclass: cf.getAttribute('class') || '',
        conditions: Array.from(cf.querySelectorAll('fl-table-condition')).map((c) => ({
          fieldname: c.getAttribute('datafield') || '',
          operator: c.getAttribute('operator') || 'eq',
          parameter: c.getAttribute('parameter') || '',
        })),
      };
    });
    this._hasRowFormattings  = this._conditionalformatting.some((c) => c.target === '[row]');
    this._hasCellFormattings = this._conditionalformatting.some((c) => c.target !== '[row]');

    // initial sort order from the attribute: "field asc, field2 desc"
    const so = this.getAttribute('sortorder');
    if (so) {
      this._sortorder = so.split(',').map((part) => {
        const [field, dir = 'asc'] = part.trim().split(/\s+/);
        return `${field} ${dir}`;
      }).filter((s) => s.trim() !== '');
    }

    // initial advanced filter from the attribute (JSON array of [field,op,param])
    const af = this.getAttribute('advancedfilter');
    if (af) {
      try { const parsed = JSON.parse(af); if (Array.isArray(parsed)) this._advancedfilter = parsed; } catch { /* ignore */ }
    }

    // per-row action icons: rowactions="edit,comment,open" (order preserved)
    this._rowactions = (this.getAttribute('rowactions') || '')
      .split(/[,\s]+/)
      .map((a) => a.trim().toLowerCase())
      .filter((a) => ROW_ACTIONS[a]);
    this._hasRowActions = this._rowactions.length > 0;

    // grouping: groupby="status" or "status,category" (multi-level). Groups the
    // rows of the CURRENT page (grouping is a client-side view over loaded data).
    this._groupby = (this.getAttribute('groupby') || '')
      .split(/[,\s]+/)
      .map((f) => f.trim())
      .filter(Boolean);
    this._hasGrouping = this._groupby.length > 0;

    // inline editing: any column with `editable`, unless the table is readonly.
    this._hasEditableColumns = this._columns.some((c) => this._isColumnEditable(c));
    this._editingEnabled = this._hasEditableColumns
      && !this.hasAttribute('readonly') && !this.hasAttribute('no-edit');

    // Add button: mode is "inline" (empty editable entry row) or "event" (emit
    // fl-table-add for the app to handle). Defaults to inline when the table has
    // editable columns, else event. Inline needs editable columns to be useful.
    this._addmode = (this.getAttribute('addmode') || '').toLowerCase()
      || (this._hasEditableColumns ? 'inline' : 'event');
    this._addlabel = this.getAttribute('addlabel') || 'Add';
    this._inlineAddEnabled = this._show.add && this._addmode === 'inline' && this._hasEditableColumns;

    // A leading actions column is reserved when we have row-action icons OR an
    // inline add row (whose Save/Cancel controls live in that column).
    this._hasActionsColumn = this._hasRowActions || this._inlineAddEnabled;

    // count visible columns (+1 for the leading actions column when present)
    this._visiblecolumns = this._columns.filter((c) => this._isColumnVisible(c)).length
      + (this._hasActionsColumn ? 1 : 0);
  }

  _applyMinimalModes() {
    this._show = {
      quickfilter: true,
      clearfilter: true,
      refresh: true,
      columnsort: true,
      advancedfilter: true,   // Phase 2: implemented (builder popup)
      advancedsort: true,     // Phase 2: implemented (builder popup)
      conditionalformatter: true, // Phase 2: implemented (builder popup)
      export: true,               // Phase 2: implemented (format popup + POST)
      clicktofilter: true,        // Phase 2: implemented (toggle)
      group: true,                // Phase 3: Group+ builder popup
      add: false,                 // Phase 3: opt-in only (a mutation, off by default)
    };

    // Attribute-based feature toggles (before minimal, which overrides all).
    // `features="…"` is an allowlist: only the named features are shown.
    // Otherwise `no-<feature>` attributes turn specific ones off.
    const featuresAttr = this.getAttribute('features');
    if (featuresAttr !== null) {
      const tokens = featuresAttr.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      Object.keys(this._show).forEach((k) => { this._show[k] = false; });
      for (const [key, aliases] of Object.entries(FEATURE_ALIASES)) {
        if (tokens.some((t) => aliases.includes(t))) this._show[key] = true;
      }
    } else {
      for (const [key, aliases] of Object.entries(FEATURE_ALIASES)) {
        if (aliases.some((a) => this.hasAttribute(`no-${a}`))) this._show[key] = false;
      }
      // Add button is default-off: enable it only when explicitly requested.
      if ((this.hasAttribute('add') || this.hasAttribute('addbutton')) && !this.hasAttribute('no-add')) {
        this._show.add = true;
      }
    }

    if (this.minimal) {
      Object.keys(this._show).forEach((k) => { this._show[k] = false; });
      this.pagination = '';
      this.recordsperpage = 0;
    } else if (this.minimalwithpagination) {
      Object.keys(this._show).forEach((k) => { this._show[k] = false; });
      this.pagination = 'top';
    }
  }

  _normalizeTarget(t) {
    const v = String(t).trim().toLowerCase();
    return (v === 'row' || v === '[row]' || v === 'entire row') ? '[row]' : t;
  }

  _isColumnVisible(col) {
    if (col.hasAttribute('hidden')) return false;
    if (col.getAttribute('type') === 'hidden') return false;
    return true;
  }

  _isColumnEditable(col) {
    if (!col.getAttribute('datafield')) return false;
    if (!col.hasAttribute('editable')) return false;
    return col.getAttribute('editable') !== 'false';
  }

  // ---- shadow skeleton + styles ---------------------------------------

  template() {
    return `
      <div class="fltable-wrap" part="wrap">
        <div class="fltable-title" part="title"></div>
        <div class="fltable-toolbar" part="toolbar"></div>
        <div class="fltable-pagination fltable-pagination-top" part="pagination-top"></div>
        <div class="fltable-scroll">
          <table class="fltable" part="table">
            <thead><tr class="fltable-colheaders"></tr></thead>
            <tbody class="fltable-body"></tbody>
            <tfoot class="fltable-foot"></tfoot>
          </table>
        </div>
        <div class="fltable-pagination fltable-pagination-bottom" part="pagination-bottom"></div>

        <!-- Builder popup. Native <dialog> gives us the modal + backdrop ("fog
             of war") and Escape-to-close for free, no fl-panel dependency. The
             body is (re)populated each time a builder opens it. -->
        <dialog class="fltable-dialog" part="dialog">
          <div class="fltable-dialog-title"></div>
          <div class="fltable-dialog-body"></div>
          <div class="fltable-dialog-footer">
            <button type="button" class="fltable-btn fltable-dialog-cancel">Cancel</button>
            <button type="button" class="fltable-btn fltable-dialog-apply">Apply</button>
          </div>
        </dialog>
      </div>
    `;
  }

  styles() {
    return `
      :host { display: block; font: inherit; color: var(--fl-text, #1a1a1a); }
      .fltable-wrap { display: flex; flex-direction: column; gap: 8px; }
      .fltable-title:empty { display: none; }
      .fltable-title { font-size: 1.2rem; font-weight: 700; }
      .fltable-toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .fltable-toolbar:empty { display: none; }
      .fltable-scroll { overflow-x: auto; }
      /* Loading state: dim the current data (kept in place) instead of clearing
         it, so paging/sorting never collapses the table height. */
      .fltable-wrap.fltable-loading .fltable-scroll { opacity: 0.55; transition: opacity 0.12s ease; pointer-events: none; }
      .fltable-wrap.fltable-loading .fltable-pagination { pointer-events: none; }
      table.fltable { width: 100%; border-collapse: collapse; background: var(--fl-surface, #fff); font-size: 0.9rem; }
      .fltable th, .fltable td { border: 1px solid var(--fl-line, #e4ded1); padding: 6px 10px; text-align: left; vertical-align: top; }
      .fltable thead th, .fltable-colheaders td { background: var(--fl-table-header-bg, #faf7f0); font-weight: 700; white-space: nowrap; }
      .fltable tbody tr:nth-child(even) td { background: var(--fl-table-stripe, transparent); }
      .fltable tbody tr:hover td { background: var(--fl-table-hover, #f4efe2); cursor: default; }
      .fltable tbody tr[data-fl-selected="true"] td { background: var(--fl-table-selected, #fbf3cf); }
      .fltable_msgnorecordsfound { text-align: center; color: var(--fl-muted, #8b8676); font-style: italic; }

      .fltable input[type="text"], .fltable-toolbar input[type="text"] {
        font: inherit; padding: 5px 9px; border: 1px solid var(--fl-line, #d5cebd);
        border-radius: var(--fl-radius, 6px); background: var(--fl-surface, #fff);
      }
      button.fltable-btn {
        font: inherit; cursor: pointer; padding: 5px 10px; border-radius: var(--fl-radius, 6px);
        border: 1px solid var(--fl-line, #d5cebd); background: var(--fl-surface, #fff); color: var(--fl-accent, #16294b);
      }
      button.fltable-btn:hover { background: var(--fl-table-hover, #f4efe2); }

      .fltable-sort { display: inline-flex; align-items: center; gap: 2px; margin-left: 4px; }
      button.fltable-sortbtn {
        font: inherit; cursor: pointer; border: 0; background: none; padding: 0 2px; line-height: 1;
        color: var(--fl-accent, #16294b);
      }
      button.fltable-sortbtn[disabled] { color: var(--fl-muted, #8b8676); cursor: default; }
      .fltable-sortidx { font-size: 0.75em; color: var(--fl-muted, #8b8676); }
      .material-icons, .fltable .material-icons {
        font-family: var(--fl-icon-font, 'Material Icons'); font-weight: normal; font-style: normal;
        font-size: 18px; line-height: 1; vertical-align: middle; -webkit-font-feature-settings: 'liga'; font-feature-settings: 'liga';
      }

      .fltable-pagination:empty { display: none; }
      .fltable-pagination { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 0.85rem; }
      button.fltable-pagebtn {
        font: inherit; cursor: pointer; min-width: 2em; padding: 3px 8px; border-radius: var(--fl-radius, 6px);
        border: 1px solid var(--fl-line, #d5cebd); background: var(--fl-surface, #fff); color: var(--fl-accent, #16294b);
      }
      button.fltable-pagebtn.current { background: var(--fl-accent, #16294b); color: #fff; border-color: var(--fl-accent, #16294b); }
      button.fltable-pagebtn.spacer { border: 0; background: none; cursor: default; }
      .fltable-pageinfo { margin-left: 8px; color: var(--fl-muted, #6b6455); }
      .fltable-pagesize { margin-left: auto; display: inline-flex; gap: 6px; align-items: center; }
      .fltable-pagination select { font: inherit; padding: 2px 4px; }

      /* ---- builder popup ---- */
      .fltable-dialog {
        border: 1px solid var(--fl-line, #d5cebd); border-radius: var(--fl-radius, 6px);
        padding: 0; width: min(620px, 92vw); color: var(--fl-text, #1a1a1a);
        background: var(--fl-surface, #fff); box-shadow: 0 12px 40px rgba(0,0,0,.25);
      }
      .fltable-dialog::backdrop { background: rgba(20, 24, 32, .45); }
      .fltable-dialog-title { font-size: 1.05rem; font-weight: 700; padding: 14px 16px; border-bottom: 1px solid var(--fl-line, #e4ded1); }
      .fltable-dialog-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
      .fltable-dialog-footer { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; border-top: 1px solid var(--fl-line, #e4ded1); }
      .fltable-dialog-apply { background: var(--fl-accent, #16294b); color: #fff; border-color: var(--fl-accent, #16294b); }
      .fltable-dialog-apply:hover { filter: brightness(1.1); background: var(--fl-accent, #16294b); }
      .fltable-filterline { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 6px; align-items: center; }
      .fltable-sortline { display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px; align-items: center; }
      .fltable-groupline { display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: center; }
      .fltable-groupline select { font: inherit; padding: 5px 8px; border: 1px solid var(--fl-line, #d5cebd); border-radius: var(--fl-radius, 6px); background: var(--fl-surface, #fff); }
      .fltable-filterline select, .fltable-filterline input,
      .fltable-sortline select {
        font: inherit; padding: 5px 8px; border: 1px solid var(--fl-line, #d5cebd);
        border-radius: var(--fl-radius, 6px); background: var(--fl-surface, #fff); width: 100%; box-sizing: border-box;
      }
      .fltable-filterline .fltable-lineremove, .fltable-sortline .fltable-lineremove {
        font: inherit; cursor: pointer; border: 1px solid var(--fl-line, #d5cebd); border-radius: var(--fl-radius, 6px);
        background: var(--fl-surface, #fff); color: var(--fl-danger, #b42318); line-height: 1; padding: 4px 8px;
      }
      .fltable-dialog-addline {
        align-self: flex-start; font: inherit; cursor: pointer; border: 1px dashed var(--fl-line, #d5cebd);
        border-radius: var(--fl-radius, 6px); background: transparent; color: var(--fl-accent, #16294b); padding: 5px 10px;
      }
      .fltable-dialog-empty { color: var(--fl-muted, #8b8676); font-style: italic; }

      /* ---- conditional-formatting builder ---- */
      .fltable-cf-list { display: flex; flex-direction: column; gap: 6px; }
      .fltable-cf-card {
        display: flex; align-items: center; gap: 8px; padding: 6px 8px;
        border: 1px solid var(--fl-line, #e4ded1); border-radius: var(--fl-radius, 6px); background: var(--fl-table-header-bg, #faf7f0);
      }
      .fltable-cf-desc { flex: 1; font-size: .88rem; }
      .fltable-cf-swatch { padding: 0 6px; border-radius: 4px; border: 1px solid rgba(0,0,0,.15); font-weight: 700; }
      .fltable-cf-editor {
        display: flex; flex-direction: column; gap: 8px; margin-top: 4px;
        padding: 10px; border: 1px dashed var(--fl-line, #d5cebd); border-radius: var(--fl-radius, 6px);
      }
      .fltable-cf-row { display: flex; align-items: center; gap: 8px; }
      .fltable-cf-label { min-width: 64px; font-size: .85rem; color: var(--fl-label, #444); }
      .fltable-cf-row select { font: inherit; padding: 5px 8px; border: 1px solid var(--fl-line, #d5cebd); border-radius: var(--fl-radius, 6px); background: var(--fl-surface, #fff); }
      .fltable-cf-conditions { display: flex; flex-direction: column; gap: 6px; }
      .fltable-cf-colors { display: flex; gap: 18px; flex-wrap: wrap; }
      .fltable-cf-colorlabel { display: inline-flex; align-items: center; gap: 6px; font-size: .85rem; }

      /* ---- export popup ---- */
      .fltable-export-formats { display: flex; flex-direction: column; gap: 8px; }
      .fltable-export-format { display: inline-flex; align-items: center; gap: 6px; font-size: .9rem; }

      /* ---- row-action icons ---- */
      .fltable-actions-head { width: 1%; white-space: nowrap; }
      .fltable-actions-cell { width: 1%; white-space: nowrap; }
      button.fltable-rowicon {
        font: inherit; cursor: pointer; border: 0; background: none; padding: 0 3px; line-height: 1;
        color: var(--fl-muted, #6b6455);
      }
      button.fltable-rowicon:hover { color: var(--fl-accent, #16294b); }

      /* ---- click-to-filter mode: hint that cells are clickable ---- */
      .fltable-wrap.fltable-c2f .fltable-body td[data-fl-cell] { cursor: zoom-in; }

      /* ---- grouping ---- */
      tr.fltable-group td {
        background: var(--fl-table-group-bg, #eef1f6); font-weight: 600; cursor: pointer; user-select: none;
      }
      tr.fltable-group td:hover { background: var(--fl-table-group-hover, #e3e8f0); }
      .fltable-group-chevron { vertical-align: middle; font-size: 18px; }
      .fltable-group-count { color: var(--fl-muted, #6b6455); font-weight: 400; margin-left: 4px; }

      /* ---- inline editing ---- */
      td[data-fl-editable] { cursor: text; }
      td[data-fl-editable]:hover { box-shadow: inset 0 0 0 1px var(--fl-line, #d5cebd); }
      td.fltable-editing { padding: 2px 4px; box-shadow: inset 0 0 0 2px var(--fl-accent, #16294b); }
      .fltable-editor {
        font: inherit; width: 100%; box-sizing: border-box; padding: 4px 6px;
        border: 1px solid var(--fl-accent, #16294b); border-radius: var(--fl-radius, 6px);
        background: var(--fl-surface, #fff); color: inherit;
      }
      textarea.fltable-editor { min-height: 3.2em; resize: vertical; }
      .fltable-editor-check { width: auto; }
      .fltable-editor-invalid { border-color: var(--fl-danger, #b42318); outline: 1px solid var(--fl-danger, #b42318); }

      /* ---- add row ---- */
      .fltable-btn-add { border-color: var(--fl-accent, #16294b); color: var(--fl-accent, #16294b); font-weight: 600; }
      tr.fltable-newrow td { background: var(--fl-table-selected, #fbf3cf); }
      button.fltable-addsave { color: var(--fl-ok, #0a7d28); }
      button.fltable-addcancel { color: var(--fl-danger, #b42318); }
    `;
  }

  // ---- data loading ----------------------------------------------------

  getDataLoaderURL() {
    const url = new URL(this.dataloaderurl, (typeof location !== 'undefined' ? location.href : 'http://localhost/'));
    const p = url.searchParams;
    p.set('page', String(this._page));
    p.set('recsperpage', String(this.recordsperpage));
    p.set('filter', this._filter);
    p.set('advancedfilter', this.getAdvancedFilterAsQueryPart());
    p.set('sortorder', this._effectiveSortOrder().join(','));
    return url;
  }

  /**
   * The sort order actually sent to the server. When grouping is active the
   * group fields are prepended so each group's rows come back contiguous
   * (otherwise a group can scatter across pages). An explicit direction the
   * user already set on a group field is respected; the user's remaining sort
   * fields follow (within-group ordering). When not grouping, this is just the
   * user's sort order unchanged.
   */
  _effectiveSortOrder() {
    if (!this._hasGrouping) return this._sortorder;
    const result = [];
    const used = new Set();
    for (const field of this._groupby) {
      const explicit = this._sortorder.find((s) => s.split(/\s+/)[0] === field);
      result.push(explicit || `${field} asc`);
      used.add(field);
    }
    for (const s of this._sortorder) {
      const f = s.split(/\s+/)[0];
      if (!used.has(f)) { result.push(s); used.add(f); }
    }
    return result;
  }

  loadData() {
    if (!this._elBody) return;
    // Record the inputs this load is based on, so updated() can tell a real
    // change from the no-op post-upgrade flush.
    this._applied = { dataloaderurl: this.dataloaderurl, recordsperpage: Number(this.recordsperpage) };
    if (!this.dataloaderurl) { this._renderEmpty(); return; }

    // Show a loading state WITHOUT collapsing the table: keep the current rows
    // in place (dimmed) and only drop in a spinner row when the body is empty
    // (i.e. the very first load). The new rows are built detached and swapped
    // in atomically, so paging/sorting/filtering never flashes an empty table.
    this._setLoading(true);

    fetch(this.getDataLoaderURL().toString(), { headers: { Accept: 'application/json' } })
      .then((res) => res.text())
      .then((text) => {
        let payload;
        try { payload = JSON.parse(text); } catch { payload = null; }
        const records = payload && Array.isArray(payload.data) ? payload.data : [];
        this._records = records;
        this._recordsById = new Map(records.map((r) => [String(r[this.primarykeyfield]), r]));
        this._totalrecords = Number(payload?.totalrecs ?? records.length) || 0;
        this._page = Number(payload?.page ?? this._page) || 1;

        this._computePages();
        this.renderColumnHeaders();
        this.renderPagination();
        this._renderBody(records);
        this._setLoading(false);
        this.emit('tableload');
      })
      .catch(() => { this._setLoading(false); this._renderEmpty(); });
  }

  /** Toggle the (non-collapsing) loading state. */
  _setLoading(on) {
    if (this._elWrap) this._elWrap.classList.toggle('fltable-loading', on);
    if (on && !this._elBody.querySelector('tr[data-fl-row]')) {
      // Body is empty (first load): show a spinner row that reserves height.
      this._elBody.innerHTML = '';
      const row = this._elBody.insertRow();
      const cell = row.insertCell();
      cell.colSpan = Math.max(1, this._visiblecolumns);
      cell.className = 'fltable_msgnorecordsfound';
      cell.textContent = 'Loading…';
    }
  }

  _renderBody(records) {
    // Build into a detached tbody first to avoid flicker, then swap.
    const tmp = document.createElement('tbody');
    tmp.className = 'fltable-body';
    if (records.length === 0) {
      const row = tmp.insertRow();
      const cell = row.insertCell();
      cell.colSpan = Math.max(1, this._visiblecolumns);
      cell.className = 'fltable_msgnorecordsfound';
      cell.textContent = this.emptymessage;
    } else if (this._hasGrouping) {
      this._renderGroupNodes(tmp, this._buildGroupTree(records, this._groupby), 0, []);
    } else {
      for (const record of records) this._addRow(tmp, record);
    }
    this._elBody.replaceWith(tmp);
    this._elBody = tmp;
  }

  // ---- grouping (client-side view over the loaded page) ---------------

  _groupKey(path) { return JSON.stringify(path); }

  _columnLabel(field) {
    const col = this._columns.find((c) => c.getAttribute('datafield') === field);
    return (col && col.getAttribute('label')) || field;
  }

  /**
   * Cluster records into a (possibly nested) group tree, preserving the
   * first-appearance order of both group keys and rows within a group.
   * @returns {Array<{field,value,count,rows,children?}>}
   */
  _buildGroupTree(records, fields) {
    const [field, ...rest] = fields;
    const order = [];
    const map = new Map();
    for (const rec of records) {
      const raw = rec == null ? undefined : rec[field];
      const key = raw == null ? '' : String(raw);
      if (!map.has(key)) { map.set(key, { field, value: raw == null ? '' : raw, rows: [] }); order.push(key); }
      map.get(key).rows.push(rec);
    }
    return order.map((key) => {
      const node = map.get(key);
      node.count = node.rows.length;
      if (rest.length) node.children = this._buildGroupTree(node.rows, rest);
      return node;
    });
  }

  _renderGroupNodes(tbody, nodes, level, parentPath) {
    for (const node of nodes) {
      const path = [...parentPath, String(node.value)];
      const collapsed = this._collapsedGroups.has(this._groupKey(path));
      this._addGroupHeader(tbody, node, level, path, collapsed);
      if (collapsed) continue;
      if (node.children) this._renderGroupNodes(tbody, node.children, level + 1, path);
      else for (const rec of node.rows) this._addRow(tbody, rec);
    }
  }

  _addGroupHeader(tbody, node, level, path, collapsed) {
    const tr = tbody.insertRow();
    tr.className = 'fltable-group';
    tr.setAttribute('data-fl-group', this._groupKey(path));
    tr.setAttribute('data-fl-group-level', String(level));
    const cell = tr.insertCell();
    cell.colSpan = Math.max(1, this._visiblecolumns);
    cell.className = 'fltable-group-cell';
    cell.style.paddingLeft = `${10 + level * 20}px`;

    const chevron = document.createElement('span');
    chevron.className = 'material-icons fltable-group-chevron';
    chevron.style.pointerEvents = 'none';
    chevron.textContent = collapsed ? 'chevron_right' : 'expand_more';
    cell.appendChild(chevron);

    const label = document.createElement('span');
    label.className = 'fltable-group-label';
    const valText = (node.value === '' || node.value == null) ? '(none)' : String(node.value);
    label.textContent = ` ${this._columnLabel(node.field)}: ${valText} `;
    cell.appendChild(label);

    const count = document.createElement('span');
    count.className = 'fltable-group-count';
    count.textContent = `(${node.count})`;
    cell.appendChild(count);
  }

  /** Collect every group path key in the current tree (for collapse-all). */
  _allGroupKeys() {
    const keys = [];
    const walk = (nodes, parent) => {
      for (const n of nodes) {
        const path = [...parent, String(n.value)];
        keys.push(this._groupKey(path));
        if (n.children) walk(n.children, path);
      }
    };
    if (this._hasGrouping && this._records.length) walk(this._buildGroupTree(this._records, this._groupby), []);
    return keys;
  }

  _renderEmpty() {
    this._records = [];
    this._recordsById = new Map();
    this._renderBody([]);
  }

  // ---- rows ------------------------------------------------------------

  _addRow(tbody, record) {
    const row = tbody.insertRow();
    row.setAttribute('data-fl-row', 'true');
    const id = record?.[this.primarykeyfield];
    if (id !== undefined) row.setAttribute('data-fl-recordid', String(id));
    const selected = this.highlightselectedrow && String(id) === String(this._selectedRecordId);
    row.setAttribute('data-fl-selected', selected ? 'true' : 'false');

    if (this._hasRowFormattings) this._applyRowFormatting(row, record);

    // leading actions cell. Present whenever the actions column is reserved
    // (row-action icons and/or the inline add row). Data rows render their
    // action icons here (if any); otherwise the cell is just a spacer.
    if (this._hasActionsColumn) {
      const acell = row.insertCell();
      acell.className = 'fltable-actions-cell';
      if (this._hasRowActions) {
        for (const name of this._rowactions) {
          const spec = ROW_ACTIONS[name];
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'fltable-rowicon';
          btn.title = spec.title;
          btn.setAttribute('data-fl-rowaction', name);
          btn.innerHTML = `<span class="material-icons" style="pointer-events:none">${spec.icon}</span>`;
          acell.appendChild(btn);
        }
      }
    }

    for (const col of this._columns) {
      if (!this._isColumnVisible(col)) continue; // hidden datafields stay in _records for getData()
      const datafield = col.getAttribute('datafield');
      const cell = row.insertCell();
      if (datafield) {
        cell.setAttribute('data-fl-cell', 'true');
        cell.setAttribute('data-fl-datafield', datafield);
        if (this._hasCellFormattings) this._applyCellFormatting(cell, datafield, record);
        if (this._editingEnabled && this._isColumnEditable(col)) cell.setAttribute('data-fl-editable', 'true');
        this._renderCellContent(cell, col, record);
      }
    }
    this.emit('rowadded', { detail: { record } });
  }

  /** Render a cell's display value (convertor applied). Shared by _addRow and
   *  the inline-edit commit path so a re-render matches the original markup. */
  _renderCellContent(cell, col, record) {
    while (cell.firstChild) cell.removeChild(cell.firstChild);
    const datafield = col.getAttribute('datafield');
    let value = datafield ? record?.[datafield] : undefined;
    const convName = col.getAttribute('convertor');
    if (convName && datafield && value != null) {
      const conv = this._convertors.find((c) => c.name === convName);
      if (conv) value = conv.convert(value, record, this.urlBase || '');
    }
    if (isEl(value)) cell.appendChild(value);
    else cell.appendChild(document.createTextNode(value == null ? '' : String(value)));
  }

  // ---- inline editing (Phase 3) ---------------------------------------

  /** Register a programmatic validator for a field. fn(value, record) should
   *  return true (valid) or a string error message. */
  setValidator(field, fn) { this._validators.set(field, fn); return this; }

  _onDblClick(e) {
    if (!this._editingEnabled || this._editing) return;
    const cell = e.target.closest('td[data-fl-editable][data-fl-datafield]');
    if (!cell) return;
    const row = cell.closest('[data-fl-row]');
    if (!row) return;
    const recordid = row.getAttribute('data-fl-recordid');
    const record = this._recordsById.get(String(recordid));
    if (!record) return;
    this._beginEdit(cell, cell.getAttribute('data-fl-datafield'), record);
  }

  _beginEdit(cell, field, record) {
    const col = this._columns.find((c) => c.getAttribute('datafield') === field);
    if (!col) return;
    const edittype = (col.getAttribute('edittype') || 'text').toLowerCase();
    const oldValue = record[field];
    const editor = this._buildEditor(edittype, col, oldValue);

    cell.classList.add('fltable-editing');
    while (cell.firstChild) cell.removeChild(cell.firstChild);
    cell.appendChild(editor.el);

    this._editing = { cell, field, record, col, edittype, oldValue, editorEl: editor.el, getValue: editor.getValue };
    editor.focus();

    let done = false;
    const finish = (mode) => {           // mode: 'commit' | 'cancel' | 'blur'
      if (done) return;
      if (mode === 'cancel') { this._cancelEdit(); done = true; return; }
      const ok = this._commitEdit();
      if (ok) { done = true; return; }
      if (mode === 'blur') { this._cancelEdit(); done = true; } // revert on focus loss
      // Enter with invalid value: stay in edit mode (done stays false)
    };

    editor.el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && edittype !== 'textarea') { ev.preventDefault(); finish('commit'); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finish('cancel'); }
    });
    if (edittype === 'checkbox' || edittype === 'select') {
      editor.el.addEventListener('change', () => finish('commit'));
    }
    editor.el.addEventListener('blur', () => finish('blur'));
  }

  /** Build the editor element for an edit type. Returns {el, focus, getValue}. */
  _buildEditor(edittype, col, oldValue) {
    let el;
    if (edittype === 'select') {
      el = document.createElement('select');
      el.className = 'fltable-editor';
      for (const o of this._parseEditOptions(col)) {
        const opt = document.createElement('option');
        opt.value = o.value; opt.textContent = o.label;
        if (String(o.value) === String(oldValue)) opt.selected = true;
        el.appendChild(opt);
      }
      return { el, focus: () => el.focus(), getValue: () => el.value };
    }
    if (edittype === 'checkbox' || edittype === 'bool' || edittype === 'boolean') {
      el = document.createElement('input');
      el.type = 'checkbox';
      el.className = 'fltable-editor fltable-editor-check';
      el.checked = oldValue === true || oldValue === 1 || oldValue === '1' || String(oldValue).toLowerCase() === 'true';
      return { el, focus: () => el.focus(), getValue: () => el.checked };
    }
    if (edittype === 'textarea') {
      el = document.createElement('textarea');
      el.className = 'fltable-editor';
      el.value = oldValue == null ? '' : String(oldValue);
      return { el, focus: () => { el.focus(); el.select?.(); }, getValue: () => el.value };
    }
    // text / number / date
    el = document.createElement('input');
    el.type = (edittype === 'number') ? 'number' : (edittype === 'date' ? 'date' : 'text');
    el.className = 'fltable-editor';
    el.value = oldValue == null ? '' : String(oldValue);
    if (col.hasAttribute('editmin')) el.min = col.getAttribute('editmin');
    if (col.hasAttribute('editmax')) el.max = col.getAttribute('editmax');
    if (col.hasAttribute('editmaxlength')) el.maxLength = col.getAttribute('editmaxlength');
    return { el, focus: () => { el.focus(); el.select?.(); }, getValue: () => el.value };
  }

  _parseEditOptions(col) {
    const raw = col.getAttribute('editoptions') || '';
    if (!raw) return [];
    // JSON array of {value,label} or of scalars
    if (raw.trim().startsWith('[')) {
      try {
        const arr = JSON.parse(raw);
        return arr.map((o) => (o && typeof o === 'object')
          ? { value: o.value, label: o.label ?? String(o.value) }
          : { value: o, label: String(o) });
      } catch { /* fall through */ }
    }
    // "v1:Label 1, v2:Label 2"  OR  "a, b, c"
    return raw.split(',').map((tok) => {
      const [value, label] = tok.split(':');
      const v = (value ?? '').trim();
      return { value: v, label: (label ?? v).trim() };
    }).filter((o) => o.value !== '');
  }

  _castEditValue(edittype, raw) {
    if (edittype === 'number') {
      if (raw === '' || raw == null) return null;
      const n = Number(raw);
      return Number.isNaN(n) ? raw : n;   // keep raw so validation can reject
    }
    if (edittype === 'checkbox' || edittype === 'bool' || edittype === 'boolean') {
      return raw ? 1 : 0;                 // store 1/0 for DB-friendliness
    }
    return raw;                           // text / date / select / textarea
  }

  _validateEdit(col, value, record) {
    const field = col.getAttribute('datafield');
    const str = value == null ? '' : String(value);

    if (col.hasAttribute('required') && str.trim() === '') return { ok: false, message: 'Required' };

    const edittype = (col.getAttribute('edittype') || 'text').toLowerCase();
    if (edittype === 'number' && str !== '') {
      if (Number.isNaN(Number(value))) return { ok: false, message: 'Must be a number' };
      if (col.hasAttribute('editmin') && Number(value) < Number(col.getAttribute('editmin'))) return { ok: false, message: `Minimum ${col.getAttribute('editmin')}` };
      if (col.hasAttribute('editmax') && Number(value) > Number(col.getAttribute('editmax'))) return { ok: false, message: `Maximum ${col.getAttribute('editmax')}` };
    }
    if (col.hasAttribute('editpattern') && str !== '') {
      let re; try { re = new RegExp(col.getAttribute('editpattern')); } catch { re = null; }
      if (re && !re.test(str)) return { ok: false, message: 'Invalid format' };
    }
    const fn = this._validators.get(field);
    if (fn) {
      const r = fn(value, record);
      if (r !== true) return { ok: false, message: typeof r === 'string' ? r : 'Invalid' };
    }
    return { ok: true };
  }

  _markInvalid(el, message) {
    el.classList.add('fltable-editor-invalid');
    if (message) el.title = message;
    el.focus?.();
  }

  _commitEdit() {
    const ed = this._editing;
    if (!ed) return true;
    const value = this._castEditValue(ed.edittype, ed.getValue());
    const check = this._validateEdit(ed.col, value, ed.record);
    if (!check.ok) { this._markInvalid(ed.editorEl, check.message); return false; }

    const { cell, field, record, col, oldValue } = ed;
    const changed = String(value) !== String(oldValue);
    record[field] = value;
    cell.classList.remove('fltable-editing');
    this._editing = null;
    this._renderCellContent(cell, col, record);

    // re-apply formatting that may depend on the new value
    const rowEl = cell.closest('[data-fl-row]');
    if (this._hasRowFormattings && rowEl) this._applyRowFormatting(rowEl, record);
    if (this._hasCellFormattings) this._applyCellFormatting(cell, field, record);

    if (changed) {
      const ev = this.emit('fl-table-celledit', {
        detail: { recordid: record[this.primarykeyfield], field, oldValue, newValue: value, record },
        cancelable: true,
      });
      if (!ev.defaultPrevented) this._persistEdit(record, field, value, oldValue);
    }
    return true;
  }

  _cancelEdit() {
    const ed = this._editing;
    if (!ed) return;
    ed.cell.classList.remove('fltable-editing');
    this._editing = null;
    this._renderCellContent(ed.cell, ed.col, ed.record); // restore original display
  }

  /** Optimistic server persistence. Only runs when edit-url is set and the app
   *  did NOT preventDefault the celledit event. Reverts + emits on failure. */
  _persistEdit(record, field, value, oldValue) {
    if (!this.editurl) return; // event-only mode: the app persists however it likes
    const body = new URLSearchParams();
    body.set(this.primarykeyfield, String(record[this.primarykeyfield]));
    body.set('field', field);
    body.set('value', value == null ? '' : String(value));
    fetch(this.editurl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
      .then((res) => { if (!res.ok) throw new Error('save failed'); })
      .catch(() => {
        record[field] = oldValue; // revert
        const cell = this.$$(`tr[data-fl-recordid="${record[this.primarykeyfield]}"] td[data-fl-datafield="${field}"]`)[0];
        const col = this._columns.find((c) => c.getAttribute('datafield') === field);
        if (cell && col) this._renderCellContent(cell, col, record);
        this.emit('fl-table-editerror', { detail: { recordid: record[this.primarykeyfield], field, value } });
      });
  }

  // ---- add row (Phase 3) ----------------------------------------------

  /** Public: trigger the Add action (same as clicking the Add button). */
  addRow() { this._onAddClick(); return this; }

  _onAddClick() {
    if (this._inlineAddEnabled) this._beginAddRow();
    else this.emit('fl-table-add', { detail: {} }); // event mode: app opens its own form
  }

  /** Insert a transient empty entry row (all editable cells become inputs). */
  _beginAddRow() {
    if (this._addingRow || this._editing) return; // one at a time
    const rec = {};
    const editors = new Map();

    const row = document.createElement('tr');
    row.setAttribute('data-fl-newrow', 'true');
    row.className = 'fltable-newrow';

    // leading actions cell holds Save / Cancel (actions column is reserved)
    const acell = row.insertCell();
    acell.className = 'fltable-actions-cell';
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'fltable-rowicon fltable-addsave';
    save.title = 'Save new row'; save.setAttribute('data-fl-addsave', 'true');
    save.innerHTML = '<span class="material-icons" style="pointer-events:none">check</span>';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'fltable-rowicon fltable-addcancel';
    cancel.title = 'Cancel'; cancel.setAttribute('data-fl-addcancel', 'true');
    cancel.innerHTML = '<span class="material-icons" style="pointer-events:none">close</span>';
    acell.append(save, cancel);

    let firstEditor = null;
    for (const col of this._columns) {
      if (!this._isColumnVisible(col)) continue;
      const cell = row.insertCell();
      const field = col.getAttribute('datafield');
      if (field && this._isColumnEditable(col)) {
        const edittype = (col.getAttribute('edittype') || 'text').toLowerCase();
        const seed = this._addSeedValue(edittype, col);
        const editor = this._buildEditor(edittype, col, seed);
        cell.appendChild(editor.el);
        editors.set(field, { editor, col, edittype });
        rec[field] = seed;
        if (!firstEditor) firstEditor = editor;
        // Enter on any field saves the row; Escape cancels.
        editor.el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' && edittype !== 'textarea') { ev.preventDefault(); this._saveAddRow(); }
          else if (ev.key === 'Escape') { ev.preventDefault(); this._cancelAddRow(); }
        });
      }
    }

    // Put the entry row at the very top of the body.
    this._elBody.insertBefore(row, this._elBody.firstChild);
    this._addingRow = { row, editors, rec };
    if (firstEditor) firstEditor.focus();
    this.emit('fl-table-addstart', { detail: {} });
  }

  _addSeedValue(edittype, col) {
    if (edittype === 'select') { const opts = this._parseEditOptions(col); return opts.length ? opts[0].value : ''; }
    if (edittype === 'checkbox' || edittype === 'bool' || edittype === 'boolean') return 0;
    return '';
  }

  _saveAddRow() {
    const add = this._addingRow;
    if (!add) return;
    const rec = {};
    let firstInvalid = null;
    for (const [field, meta] of add.editors) {
      meta.editor.el.classList.remove('fltable-editor-invalid');
      const value = this._castEditValue(meta.edittype, meta.editor.getValue());
      const check = this._validateEdit(meta.col, value, rec);
      if (!check.ok) { if (!firstInvalid) firstInvalid = meta.editor.el; this._markInvalid(meta.editor.el, check.message); continue; }
      rec[field] = value;
    }
    if (firstInvalid) { firstInvalid.focus?.(); return; } // stay open until valid

    const ev = this.emit('fl-table-rowadd', { detail: { record: rec }, cancelable: true });

    // remove the transient entry row now that we have the record
    add.row.remove();
    this._addingRow = null;

    if (ev.defaultPrevented) return; // app owns persistence + refresh

    if (this.addurl) {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(rec)) body.set(k, v == null ? '' : String(v));
      fetch(this.addurl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
        .then((res) => { if (!res.ok) throw new Error('add failed'); return res; })
        .then(() => { this._page = 1; this.loadData(); }) // re-fetch so the server-assigned id/row appears
        .catch(() => this.emit('fl-table-adderror', { detail: { record: rec } }));
    } else {
      // no add-url: optimistic local insert at the top of the current page
      this._records.unshift(rec);
      this._recordsById.set(String(rec[this.primarykeyfield]), rec);
      this._totalrecords += 1;
      this._renderBody(this._records);
    }
  }

  _cancelAddRow() {
    if (!this._addingRow) return;
    this._addingRow.row.remove();
    this._addingRow = null;
    this.emit('fl-table-addcancel', { detail: {} });
  }

  // ---- column headers + sorting ---------------------------------------

  renderColumnHeaders() {
    const row = this._elHead;
    row.innerHTML = '';
    // leading actions column header (empty)
    if (this._hasActionsColumn) {
      const ah = document.createElement('td');
      ah.className = 'fltable-actions-head';
      row.appendChild(ah);
    }
    for (const col of this._columns) {
      if (!this._isColumnVisible(col)) continue;
      const cell = document.createElement('td');
      const datafield = col.getAttribute('datafield') || '';
      const label = col.getAttribute('label') || '';
      cell.appendChild(document.createTextNode(label + ' '));

      if (this._show.columnsort && datafield !== '') {
        const idx = this._sortIndex(datafield); // {dir, pos} | null
        const container = document.createElement('span');
        container.className = 'fltable-sort';

        const sortBtn = document.createElement('button');
        sortBtn.className = 'fltable-sortbtn';
        sortBtn.setAttribute('data-fl-sortfield', datafield);
        sortBtn.innerHTML = `<span class="material-icons" style="pointer-events:none">${
          idx ? (idx.dir === 'asc' ? 'keyboard_arrow_up' : 'keyboard_arrow_down') : 'unfold_more'
        }</span>`;
        container.appendChild(sortBtn);

        if (idx) {
          const idxBadge = document.createElement('span');
          idxBadge.className = 'fltable-sortidx';
          idxBadge.textContent = String(idx.pos);
          container.appendChild(idxBadge);

          const clearBtn = document.createElement('button');
          clearBtn.className = 'fltable-sortbtn';
          clearBtn.setAttribute('data-fl-unsortfield', datafield);
          clearBtn.innerHTML = `<span class="material-icons" style="pointer-events:none">clear</span>`;
          container.appendChild(clearBtn);
        }
        cell.appendChild(container);
      }
      row.appendChild(cell);
    }
    // footer columns
    this._elFoot.innerHTML = '';
    if (this._footercolumns.length > 0) {
      const frow = this._elFoot.insertRow();
      if (this._hasActionsColumn) frow.insertCell(); // keep totals aligned under the actions column
      for (const fc of this._footercolumns) {
        const fcell = frow.insertCell();
        if (fc.hasAttribute('id')) fcell.setAttribute('data-fl-footerid', fc.getAttribute('id'));
        fcell.colSpan = fc.getAttribute('colspan') || 1;
      }
    }
  }

  /** Return {dir, pos} if `field` is in the sort order, else null. */
  _sortIndex(field) {
    for (let i = 0; i < this._sortorder.length; i++) {
      const [f, dir] = this._sortorder[i].split(/\s+/);
      if (f === field) return { dir: dir || 'asc', pos: i + 1 };
    }
    return null;
  }

  _toggleSort(field) {
    const i = this._sortorder.findIndex((s) => s.split(/\s+/)[0] === field);
    if (i === -1) this._sortorder.push(`${field} asc`);
    else this._sortorder[i] = this._sortorder[i].endsWith('asc') ? `${field} desc` : `${field} asc`;
    this.emit('orderchange', { detail: { sortorder: [...this._sortorder] } });
    this.loadData();
  }

  _removeSort(field) {
    this._sortorder = this._sortorder.filter((s) => s.split(/\s+/)[0] !== field);
    this.emit('orderchange', { detail: { sortorder: [...this._sortorder] } });
    this.loadData();
  }

  // ---- pagination ------------------------------------------------------

  _computePages() {
    const rpp = Number(this.recordsperpage);
    this._totalpages = rpp > 0 ? Math.max(1, Math.ceil(this._totalrecords / rpp)) : 1;
    if (this._page < 1) this._page = 1;
    if (this._page > this._totalpages) this._page = this._totalpages;

    const n = Number(this.nrofpaginationbuttons) || 5;
    const half = Math.floor((n - 1) / 2);
    let start = Math.max(1, this._page - half);
    let end = Math.min(this._totalpages, start + n - 1);
    start = Math.max(1, end - n + 1);
    this._startpage = start;
    this._endpage = end;
  }

  renderPagination() {
    if (this.pagination.includes('top')) this._renderPaginationBar(this._elPagTop, 'top');
    else this._elPagTop.innerHTML = '';
    if (this.pagination.includes('bottom')) this._renderPaginationBar(this._elPagBot, 'bottom');
    else this._elPagBot.innerHTML = '';
  }

  _renderPaginationBar(bar, where) {
    bar.innerHTML = '';
    if (this._totalpages > 1) {
      if (this.pagination.includes('prevnext')) {
        this._pageButton(bar, Math.max(1, this._page - 1), '‹');
        this._pageButton(bar, Math.min(this._totalpages, this._page + 1), '›');
      }
      if (this._startpage > 1) {
        this._pageButton(bar, 1);
        if (this._startpage > 2) this._pageButton(bar, this._page, '…', true);
      }
      for (let i = this._startpage; i <= this._endpage; i++) this._pageButton(bar, i);
      if (this._endpage < this._totalpages - 1) this._pageButton(bar, this._page, '…', true);
      if (this._endpage < this._totalpages) this._pageButton(bar, this._totalpages);
    }

    const info = document.createElement('span');
    info.className = 'fltable-pageinfo';
    info.textContent = `page ${this._page} of ${this._totalpages} · ${this._totalrecords} records`;
    bar.appendChild(info);

    // page-size + go-to-page selectors
    const sizeWrap = document.createElement('span');
    sizeWrap.className = 'fltable-pagesize';

    const gotoSel = document.createElement('select');
    for (let i = 1; i <= this._totalpages; i++) {
      const o = document.createElement('option');
      o.value = String(i); o.textContent = String(i);
      if (i === this._page) o.selected = true;
      gotoSel.appendChild(o);
    }
    gotoSel.addEventListener('change', () => this.goToPage(Number(gotoSel.value)));

    const rppSel = document.createElement('select');
    for (const opt of [10, 15, 20, 25, 30, 40, 50, 100, 200, 300, 400, 500, 'All']) {
      const o = document.createElement('option');
      const val = opt === 'All' ? 0 : opt;
      o.value = String(val); o.textContent = String(opt);
      if (Number(this.recordsperpage) === val) o.selected = true;
      rppSel.appendChild(o);
    }
    rppSel.addEventListener('change', () => { this._page = 1; this.recordsperpage = Number(rppSel.value); });

    sizeWrap.append('Go to page ', gotoSel, ' · per page ', rppSel);
    bar.appendChild(sizeWrap);
  }

  _pageButton(bar, page, label, spacer = false) {
    const btn = document.createElement('button');
    btn.className = 'fltable-pagebtn' + (spacer ? ' spacer' : '') + (Number(label ?? page) === this._page && !spacer ? ' current' : '');
    if (!spacer) btn.setAttribute('data-fl-page', String(page));
    btn.textContent = label != null ? String(label) : String(page);
    if (spacer) btn.disabled = true;
    bar.appendChild(btn);
  }

  // ---- toolbar ---------------------------------------------------------

  _renderToolbar() {
    const bar = this._elToolbar;
    bar.innerHTML = '';

    for (const b of this._extrabuttons) this._renderExtraButton(bar, b, 'first');

    if (this._show.add) {
      const btn = this._toolbarButton(this._addlabel, 'data-fl-add');
      btn.classList.add('fltable-btn-add');
      bar.appendChild(btn);
    }

    if (this._show.quickfilter) {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'search…';
      input.value = this._filter;
      input.className = 'fltable-quickfilter';
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this._filter = input.value;
          this._page = 1;
          this.emit('filterchange', { detail: { filter: this._filter } });
          this.loadData();
        }
      });
      bar.appendChild(input);
    }
    if (this._show.advancedfilter) {
      const btn = this._toolbarButton('Filter+', 'data-fl-advancedfilter');
      // active-state hint when an advanced filter is in effect
      if (this._advancedfilter.length) btn.classList.add('active');
      bar.appendChild(btn);
    }
    if (this._show.advancedsort) {
      const btn = this._toolbarButton('Sort+', 'data-fl-advancedsort');
      if (this._sortorder.length) btn.classList.add('active');
      bar.appendChild(btn);
    }
    if (this._show.group) {
      const btn = this._toolbarButton('Group+', 'data-fl-groupbuilder');
      if (this._groupby.length) btn.classList.add('active');
      bar.appendChild(btn);
    }
    if (this._show.conditionalformatter) {
      const btn = this._toolbarButton('Formatting+', 'data-fl-conditionalformat');
      if (this._conditionalformatting.length) btn.classList.add('active');
      bar.appendChild(btn);
    }
    if (this._show.export) {
      bar.appendChild(this._toolbarButton('Export', 'data-fl-export'));
    }
    if (this._show.clicktofilter) {
      const btn = this._toolbarButton('Click to filter', 'data-fl-clicktofilter');
      if (this._click2filter) btn.classList.add('active');
      bar.appendChild(btn);
    }
    if (this._show.clearfilter) {
      bar.appendChild(this._toolbarButton('Clear filter', 'data-fl-clearfilter'));
    }
    for (const b of this._extrabuttons) this._renderExtraButton(bar, b, 'last');
    if (this._show.refresh) {
      bar.appendChild(this._toolbarButton('Reload', 'data-fl-reload'));
    }
  }

  _toolbarButton(label, dataAttr) {
    const btn = document.createElement('button');
    btn.className = 'fltable-btn';
    btn.setAttribute(dataAttr, 'true');
    btn.textContent = label;
    return btn;
  }

  _renderExtraButton(parent, def, location) {
    if (def.getAttribute('location') !== location) return;
    if (!def.hasAttribute('label') && !def.hasAttribute('labelicon')) return;
    const btn = document.createElement('button');
    btn.className = 'fltable-btn';
    btn.id = def.getAttribute('id') || uniqId('fl-tablebtn');
    if (def.hasAttribute('labelicon')) {
      const i = document.createElement('span');
      i.className = 'material-icons';
      i.title = def.getAttribute('label') || '';
      i.textContent = def.getAttribute('labelicon');
      btn.appendChild(i);
    } else {
      btn.textContent = def.getAttribute('label');
    }
    // App hooks are events now (no global callMethod). Listen for `fl-table-buttonclick`.
    const action = def.getAttribute('action') || '';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.emit('fl-table-buttonclick', { detail: { action, id: btn.id, button: def } });
    });
    parent.appendChild(btn);
  }

  // ---- delegated click (pagination / sort / selection / toolbar) ------

  _onClick(e) {
    // 1) Row-action icons take priority (they live inside rows).
    const actionEl = e.target.closest('[data-fl-rowaction]');
    if (actionEl) {
      e.stopPropagation();
      const row = actionEl.closest('[data-fl-row]');
      const recordid = row?.getAttribute('data-fl-recordid') ?? null;
      this.emit('fl-table-rowaction', {
        detail: { action: actionEl.getAttribute('data-fl-rowaction'), recordid, record: this._recordsById.get(String(recordid)) || null },
      });
      return;
    }

    // inline add-row Save/Cancel controls (live inside the transient entry row)
    const addCtl = e.target.closest('[data-fl-addsave],[data-fl-addcancel]');
    if (addCtl) {
      e.stopPropagation();
      if (addCtl.hasAttribute('data-fl-addsave')) this._saveAddRow();
      else this._cancelAddRow();
      return;
    }

    const el = e.target.closest('[data-fl-page],[data-fl-sortfield],[data-fl-unsortfield],[data-fl-clearfilter],[data-fl-reload],[data-fl-advancedfilter],[data-fl-advancedsort],[data-fl-groupbuilder],[data-fl-conditionalformat],[data-fl-export],[data-fl-clicktofilter],[data-fl-add],[data-fl-group],[data-fl-row]');
    if (!el) return;

    if (el.hasAttribute('data-fl-page')) { this.goToPage(Number(el.getAttribute('data-fl-page'))); return; }
    if (el.hasAttribute('data-fl-sortfield')) { this._toggleSort(el.getAttribute('data-fl-sortfield')); return; }
    if (el.hasAttribute('data-fl-unsortfield')) { this._removeSort(el.getAttribute('data-fl-unsortfield')); return; }
    if (el.hasAttribute('data-fl-clearfilter')) { this.clearFilter(); return; }
    if (el.hasAttribute('data-fl-reload')) { this.loadData(); return; }
    if (el.hasAttribute('data-fl-advancedfilter')) { this.openAdvancedFilter(); return; }
    if (el.hasAttribute('data-fl-advancedsort')) { this.openAdvancedSort(); return; }
    if (el.hasAttribute('data-fl-groupbuilder')) { this.openGroupBuilder(); return; }
    if (el.hasAttribute('data-fl-conditionalformat')) { this.openConditionalFormatting(); return; }
    if (el.hasAttribute('data-fl-export')) { this.openExport(); return; }
    if (el.hasAttribute('data-fl-clicktofilter')) { this.toggleClickToFilter(); return; }
    if (el.hasAttribute('data-fl-add')) { this._onAddClick(); return; }

    // group header: toggle collapse and re-render the body from cached records
    if (el.hasAttribute('data-fl-group')) {
      const gkey = el.getAttribute('data-fl-group');
      if (this._collapsedGroups.has(gkey)) this._collapsedGroups.delete(gkey);
      else this._collapsedGroups.add(gkey);
      this._renderBody(this._records);
      return;
    }

    if (el.hasAttribute('data-fl-row')) {
      // 2) Click-to-filter mode: a click on a data cell adds an equals filter.
      if (this._click2filter) {
        const cell = e.target.closest('[data-fl-cell][data-fl-datafield]');
        if (cell) {
          const field = cell.getAttribute('data-fl-datafield');
          this._advancedfilter.push([field, 'eq', this._cellFilterValue(cell)]);
          this._page = 1;
          this.emit('filterchange', { detail: { advancedfilter: this._advancedfilter } });
          this.loadData();
          this._renderToolbar(); // refresh Filter+ active hint
        }
        return; // never select while click-to-filter is on
      }

      // 3) Normal selection.
      const id = el.getAttribute('data-fl-recordid');
      if (id != null) {
        if (this.highlightselectedrow) {
          this.$$('tr[data-fl-selected="true"]').forEach((r) => r.setAttribute('data-fl-selected', 'false'));
          el.setAttribute('data-fl-selected', 'true');
        }
        this._selectedRecordId = id;
      }
      this.emit('recordselect', { detail: { recordid: id, record: this._recordsById.get(String(id)) || null } });
    }
  }

  /** Clean text value of a cell for click-to-filter (drops any icon glyphs). */
  _cellFilterValue(cell) {
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('.material-icons, .fltable-rowicon').forEach((n) => n.remove());
    return clone.textContent.trim();
  }

  /** Toggle click-to-filter mode (public so apps/tests can drive it too). */
  toggleClickToFilter(force) {
    this._click2filter = (force === undefined) ? !this._click2filter : !!force;
    const btn = this.$('[data-fl-clicktofilter]');
    if (btn) btn.classList.toggle('active', this._click2filter);
    if (this._elWrap) this._elWrap.classList.toggle('fltable-c2f', this._click2filter);
    this.emit('fl-table-clicktofilter', { detail: { active: this._click2filter } });
    return this;
  }

  // ---- advanced filter (data path; builder popup is Phase 2) ----------

  constructQueryPart(field, operator, parameter) {
    const op = OPERATORS[operator];
    return op ? ` ${op.sql(field, String(parameter).toLowerCase())} ` : '';
  }

  getAdvancedFilterAsQueryPart() {
    return this._advancedfilter
      .filter((p) => Array.isArray(p) && p.length >= 2)
      .map(([field, operator, parameter = '']) => this.constructQueryPart(field, operator, parameter))
      .filter(Boolean)
      .join(' and ');
  }

  // ---- advanced filter BUILDER popup (Phase 2) ------------------------

  /** Columns eligible for filtering: visible + has a datafield. */
  _filterableColumns() {
    return this._columns
      .filter((c) => this._isColumnVisible(c) && c.getAttribute('datafield'))
      .map((c) => ({ value: c.getAttribute('datafield'), label: c.getAttribute('label') || c.getAttribute('datafield') }));
  }

  /** Build a <select> from [{value,label}] with `selected` preselected. */
  _select(options, selected, className) {
    const sel = document.createElement('select');
    if (className) sel.className = className;
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === selected) opt.selected = true;
      sel.appendChild(opt);
    }
    return sel;
  }

  /** Append one filter line (field / operator / parameter / remove). */
  _addFilterLine(field = '', operator = 'eq', parameter = '') {
    const fields = this._filterableColumns();
    if (fields.length === 0) return;

    const line = document.createElement('div');
    line.className = 'fltable-filterline';

    const fieldSel = this._select(fields, field || fields[0].value, 'fl-line-field');
    const opSel = this._select(OPERATOR_LABELS.map(([value, label]) => ({ value, label })), operator, 'fl-line-op');
    const paramInput = document.createElement('input');
    paramInput.type = 'text';
    paramInput.className = 'fl-line-param';
    paramInput.placeholder = 'value';
    paramInput.value = parameter;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'fltable-lineremove';
    remove.title = 'Remove condition';
    remove.textContent = '✕';
    remove.addEventListener('click', (e) => { e.stopPropagation(); line.remove(); });

    line.append(fieldSel, opSel, paramInput, remove);
    this._linesWrap.appendChild(line);
    return line;
  }

  /** Open the advanced-filter builder, pre-filled from the current filter. */
  openAdvancedFilter() {
    this._dlgTitle.textContent = 'Advanced filter';
    this._dlgBody.innerHTML = '';

    if (this._filterableColumns().length === 0) {
      const msg = document.createElement('div');
      msg.className = 'fltable-dialog-empty';
      msg.textContent = 'No filterable columns are defined.';
      this._dlgBody.appendChild(msg);
      this._dlgApplyFn = () => this._closeDialog();
      this._openDialog();
      return;
    }

    this._linesWrap = document.createElement('div');
    this._linesWrap.className = 'fltable-filterlines';
    this._linesWrap.style.display = 'flex';
    this._linesWrap.style.flexDirection = 'column';
    this._linesWrap.style.gap = '8px';
    this._dlgBody.appendChild(this._linesWrap);

    // pre-fill from the active filter, else start with one blank line
    const existing = this._advancedfilter.filter((p) => Array.isArray(p) && p.length >= 2);
    if (existing.length) existing.forEach(([f, op, p = '']) => this._addFilterLine(f, op, p));
    else this._addFilterLine();

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'fltable-dialog-addline';
    addBtn.textContent = '+ Add condition';
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); this._addFilterLine(); });
    this._dlgBody.appendChild(addBtn);

    this._dlgApplyFn = () => this._applyAdvancedFilter();
    this._openDialog();
  }

  /** Collect the builder lines and apply them via the Phase-1 filter() path. */
  _applyAdvancedFilter() {
    const rules = [];
    for (const line of this._linesWrap.querySelectorAll('.fltable-filterline')) {
      const field = line.querySelector('.fl-line-field')?.value || '';
      const op = line.querySelector('.fl-line-op')?.value || 'eq';
      const param = line.querySelector('.fl-line-param')?.value ?? '';
      if (field !== '') rules.push([field, op, param]);
    }
    this._closeDialog();
    this.filter(rules.length ? rules : null); // reuses Phase-1 data path (reload + event)
    this._renderToolbar(); // refresh the Filter+ active-state hint
  }

  // ---- advanced sort BUILDER popup (Phase 2) --------------------------

  /** Append one sort line (field / direction / remove). */
  _addSortLine(field = '', direction = 'asc') {
    const fields = this._filterableColumns(); // same eligibility: visible + datafield
    if (fields.length === 0) return;

    const line = document.createElement('div');
    line.className = 'fltable-sortline';

    const fieldSel = this._select(fields, field || fields[0].value, 'fl-sortline-field');
    const dirSel = this._select(
      [{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }],
      direction === 'desc' ? 'desc' : 'asc',
      'fl-sortline-dir',
    );

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'fltable-lineremove';
    remove.title = 'Remove sort field';
    remove.textContent = '✕';
    remove.addEventListener('click', (e) => { e.stopPropagation(); line.remove(); });

    line.append(fieldSel, dirSel, remove);
    this._linesWrap.appendChild(line);
    return line;
  }

  /** Open the advanced-sort builder, pre-filled from the current sort order. */
  openAdvancedSort() {
    this._dlgTitle.textContent = 'Advanced sort';
    this._dlgBody.innerHTML = '';

    if (this._filterableColumns().length === 0) {
      const msg = document.createElement('div');
      msg.className = 'fltable-dialog-empty';
      msg.textContent = 'No sortable columns are defined.';
      this._dlgBody.appendChild(msg);
      this._dlgApplyFn = () => this._closeDialog();
      this._openDialog();
      return;
    }

    this._linesWrap = document.createElement('div');
    this._linesWrap.className = 'fltable-sortlines';
    this._linesWrap.style.display = 'flex';
    this._linesWrap.style.flexDirection = 'column';
    this._linesWrap.style.gap = '8px';
    this._dlgBody.appendChild(this._linesWrap);

    // pre-fill from the active sort order ("field dir"), else one blank line
    if (this._sortorder.length) {
      this._sortorder.forEach((entry) => {
        const [f, dir = 'asc'] = String(entry).trim().split(/\s+/);
        this._addSortLine(f, dir);
      });
    } else {
      this._addSortLine();
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'fltable-dialog-addline';
    addBtn.textContent = '+ Add sort field';
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); this._addSortLine(); });
    this._dlgBody.appendChild(addBtn);

    this._dlgApplyFn = () => this._applyAdvancedSort();
    this._openDialog();
  }

  /** Collect the builder lines and apply them via the Phase-1 sort path. */
  _applyAdvancedSort() {
    const order = [];
    for (const line of this._linesWrap.querySelectorAll('.fltable-sortline')) {
      const field = line.querySelector('.fl-sortline-field')?.value || '';
      const dir = line.querySelector('.fl-sortline-dir')?.value === 'desc' ? 'desc' : 'asc';
      if (field !== '') order.push(`${field} ${dir}`);
    }
    this._closeDialog();
    this.setSortOrder(order);  // reuses Phase-1 data path (reload + orderchange)
    this._renderToolbar();     // refresh Sort+ (and the header sort badges re-render on load)
  }

  // ---- group BUILDER popup (Phase 3) ----------------------------------

  _addGroupLine(field = '') {
    const fields = this._filterableColumns(); // visible + datafield
    if (fields.length === 0) return;

    const line = document.createElement('div');
    line.className = 'fltable-groupline';

    const fieldSel = this._select(fields, field || fields[0].value, 'fl-groupline-field');

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'fltable-lineremove';
    remove.title = 'Remove group level';
    remove.textContent = '✕';
    remove.addEventListener('click', (e) => { e.stopPropagation(); line.remove(); });

    line.append(fieldSel, remove);
    this._linesWrap.appendChild(line);
    return line;
  }

  /** Open the Group+ builder, pre-filled from the current group fields. */
  openGroupBuilder() {
    this._dlgTitle.textContent = 'Group by';
    this._dlgBody.innerHTML = '';

    if (this._filterableColumns().length === 0) {
      const msg = document.createElement('div');
      msg.className = 'fltable-dialog-empty';
      msg.textContent = 'No groupable columns are defined.';
      this._dlgBody.appendChild(msg);
      this._dlgApplyFn = () => this._closeDialog();
      this._openDialog();
      return;
    }

    const help = document.createElement('div');
    help.className = 'fltable-dialog-empty';
    help.style.fontStyle = 'normal';
    help.textContent = 'Rows are grouped in this order (top = outermost). Leave empty to ungroup.';
    this._dlgBody.appendChild(help);

    this._linesWrap = document.createElement('div');
    this._linesWrap.className = 'fltable-grouplines';
    this._linesWrap.style.display = 'flex';
    this._linesWrap.style.flexDirection = 'column';
    this._linesWrap.style.gap = '8px';
    this._dlgBody.appendChild(this._linesWrap);

    if (this._groupby.length) this._groupby.forEach((f) => this._addGroupLine(f));
    // (no blank line when ungrouped — an empty builder means "no grouping")

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'fltable-dialog-addline';
    addBtn.textContent = '+ Add group level';
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); this._addGroupLine(); });
    this._dlgBody.appendChild(addBtn);

    this._dlgApplyFn = () => this._applyGroupBuilder();
    this._openDialog();
  }

  _applyGroupBuilder() {
    const fields = [];
    for (const line of this._linesWrap.querySelectorAll('.fltable-groupline')) {
      const field = line.querySelector('.fl-groupline-field')?.value || '';
      if (field !== '' && !fields.includes(field)) fields.push(field); // de-dupe levels
    }
    this._closeDialog();
    this.groupBy(fields);   // reuses the grouping path (reload w/ group-first sort)
    this._renderToolbar();  // refresh Group+ active-state hint
  }

  // ---- conditional-formatting BUILDER popup (Phase 2) -----------------

  /** Tiny DOM helper used by the formatting builder. */
  _mk(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  /** Apply-to options: entire row + each visible datafield column. */
  _cfTargetOptions() {
    return [{ value: '[row]', label: 'Entire row' }, ...this._filterableColumns()];
  }

  /** Human description of a rule for the list, e.g. "If status equals 'closed' → row". */
  _cfRuleDescription(rule) {
    const wrap = this._mk('div', 'fltable-cf-desc');
    const labelFor = (op) => (OPERATOR_LABELS.find(([v]) => v === op)?.[1] || op).toLowerCase();
    const glueWord = (rule.glue === 'any' || rule.glue === 'or') ? ' or ' : ' and ';
    const condText = (rule.conditions || [])
      .map((c) => `${c.fieldname} ${labelFor(c.operator)} "${c.parameter}"`)
      .join(glueWord);
    const targetText = rule.target === '[row]' ? 'entire row' : rule.target;
    wrap.appendChild(this._mk('span', null, `If ${condText || '(no conditions)'} → format ${targetText}: `));

    const swatch = this._mk('span', 'fltable-cf-swatch', ' Aa ');
    if (rule.backgroundcolor) swatch.style.backgroundColor = rule.backgroundcolor;
    if (rule.foregroundcolor) swatch.style.color = rule.foregroundcolor;
    wrap.appendChild(swatch);
    return wrap;
  }

  /** (Re)render the list of existing rules with per-row remove buttons. */
  _renderCfList() {
    this._cfListWrap.innerHTML = '';
    if (this._cfRules.length === 0) {
      this._cfListWrap.appendChild(this._mk('div', 'fltable-dialog-empty', 'No formatting rules yet.'));
      return;
    }
    this._cfRules.forEach((rule, index) => {
      const card = this._mk('div', 'fltable-cf-card');
      card.appendChild(this._cfRuleDescription(rule));
      const remove = this._mk('button', 'fltable-lineremove', '✕');
      remove.type = 'button';
      remove.title = 'Remove rule';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        this._cfRules.splice(index, 1);
        this._renderCfList();
      });
      card.appendChild(remove);
      this._cfListWrap.appendChild(card);
    });
  }

  /** Append one condition row (field / operator / parameter / remove) to the editor. */
  _addCfCondition(field = '', operator = 'eq', parameter = '') {
    const fields = this._filterableColumns();
    if (fields.length === 0) return;
    const line = this._mk('div', 'fltable-filterline');
    const fieldSel = this._select(fields, field || fields[0].value, 'fl-line-field');
    const opSel = this._select(OPERATOR_LABELS.map(([value, label]) => ({ value, label })), operator, 'fl-line-op');
    const paramInput = this._mk('input', 'fl-line-param');
    paramInput.type = 'text';
    paramInput.placeholder = 'value';
    paramInput.value = parameter;
    const remove = this._mk('button', 'fltable-lineremove', '✕');
    remove.type = 'button';
    remove.addEventListener('click', (e) => { e.stopPropagation(); line.remove(); });
    line.append(fieldSel, opSel, paramInput, remove);
    this._cfEd.condWrap.appendChild(line);
    return line;
  }

  /** Build the (initially hidden) "add rule" editor and stash its refs on _cfEd. */
  _buildCfEditor() {
    const editor = this._mk('div', 'fltable-cf-editor');
    editor.style.display = 'none';

    // Apply to
    const applyRow = this._mk('div', 'fltable-cf-row');
    applyRow.appendChild(this._mk('label', 'fltable-cf-label', 'Apply to'));
    const applyToSel = this._select(this._cfTargetOptions(), '[row]', 'fl-cf-target');
    applyRow.appendChild(applyToSel);
    editor.appendChild(applyRow);

    // Match glue
    const glueRow = this._mk('div', 'fltable-cf-row');
    glueRow.appendChild(this._mk('label', 'fltable-cf-label', 'Match'));
    const glueSel = this._select(
      [{ value: 'all', label: 'All conditions' }, { value: 'any', label: 'Any condition' }],
      'all', 'fl-cf-glue',
    );
    glueRow.appendChild(glueSel);
    editor.appendChild(glueRow);

    // Conditions
    const condWrap = this._mk('div', 'fltable-cf-conditions');
    editor.appendChild(condWrap);
    const addCond = this._mk('button', 'fltable-dialog-addline', '+ Add condition');
    addCond.type = 'button';
    addCond.addEventListener('click', (e) => { e.stopPropagation(); this._addCfCondition(); });
    editor.appendChild(addCond);

    // Colors (each with an enable checkbox so "no colour" is representable)
    const colorRow = this._mk('div', 'fltable-cf-colors');
    const fgChk = this._mk('input'); fgChk.type = 'checkbox';
    const fgColor = this._mk('input'); fgColor.type = 'color'; fgColor.value = '#b42318';
    const bgChk = this._mk('input'); bgChk.type = 'checkbox'; bgChk.checked = true;
    const bgColor = this._mk('input'); bgColor.type = 'color'; bgColor.value = '#fff3b0';
    const fgLabel = this._mk('label', 'fltable-cf-colorlabel'); fgLabel.append(fgChk, ' Text ', fgColor);
    const bgLabel = this._mk('label', 'fltable-cf-colorlabel'); bgLabel.append(bgChk, ' Background ', bgColor);
    colorRow.append(fgLabel, bgLabel);
    editor.appendChild(colorRow);

    // Add-rule button
    const addRule = this._mk('button', 'fltable-btn', 'Add rule');
    addRule.type = 'button';
    addRule.addEventListener('click', (e) => { e.stopPropagation(); this._addCfRuleFromEditor(); });
    editor.appendChild(addRule);

    this._cfEd = { editor, applyToSel, glueSel, condWrap, fgChk, fgColor, bgChk, bgColor };
    return editor;
  }

  _showCfEditor(show) {
    this._cfEd.editor.style.display = show ? '' : 'none';
    if (show && this._cfEd.condWrap.children.length === 0) this._addCfCondition();
  }

  /** Read the editor into a rule, push it, refresh the list, reset the editor. */
  _addCfRuleFromEditor() {
    const conditions = [];
    for (const line of this._cfEd.condWrap.querySelectorAll('.fltable-filterline')) {
      const fieldname = line.querySelector('.fl-line-field')?.value || '';
      const operator = line.querySelector('.fl-line-op')?.value || 'eq';
      const parameter = line.querySelector('.fl-line-param')?.value ?? '';
      if (fieldname !== '') conditions.push({ fieldname, operator, parameter });
    }
    if (conditions.length === 0) return; // nothing to add

    this._cfRules.push({
      glue: this._cfEd.glueSel.value,          // 'all' | 'any'
      target: this._cfEd.applyToSel.value,      // '[row]' | datafield
      foregroundcolor: this._cfEd.fgChk.checked ? this._cfEd.fgColor.value : '',
      backgroundcolor: this._cfEd.bgChk.checked ? this._cfEd.bgColor.value : '',
      applyclass: '',
      conditions,
    });
    this._renderCfList();

    // reset editor for the next rule
    this._cfEd.condWrap.innerHTML = '';
    this._showCfEditor(false);
  }

  /** Open the conditional-formatting manager, working on a copy (Cancel discards). */
  openConditionalFormatting() {
    this._dlgTitle.textContent = 'Conditional formatting';
    this._dlgBody.innerHTML = '';

    if (this._filterableColumns().length === 0) {
      this._dlgBody.appendChild(this._mk('div', 'fltable-dialog-empty', 'No columns available to format on.'));
      this._dlgApplyFn = () => this._closeDialog();
      this._openDialog();
      return;
    }

    // deep-ish copy so Cancel is a true no-op
    this._cfRules = this._conditionalformatting.map((r) => ({
      glue: r.glue,
      target: r.target,
      foregroundcolor: r.foregroundcolor || '',
      backgroundcolor: r.backgroundcolor || '',
      applyclass: r.applyclass || '',
      conditions: (r.conditions || []).map((c) => ({ ...c })),
    }));

    this._cfListWrap = this._mk('div', 'fltable-cf-list');
    this._dlgBody.appendChild(this._cfListWrap);
    this._renderCfList();

    const addRuleBtn = this._mk('button', 'fltable-dialog-addline', '+ Add rule');
    addRuleBtn.type = 'button';
    addRuleBtn.addEventListener('click', (e) => { e.stopPropagation(); this._showCfEditor(true); });
    this._dlgBody.appendChild(addRuleBtn);

    this._dlgBody.appendChild(this._buildCfEditor());

    this._dlgApplyFn = () => this._applyConditionalFormatting();
    this._openDialog();
  }

  /** Commit the working rule set to the engine and re-render. */
  _applyConditionalFormatting() {
    this._conditionalformatting = this._cfRules;
    this._hasRowFormattings = this._conditionalformatting.some((c) => c.target === '[row]');
    this._hasCellFormattings = this._conditionalformatting.some((c) => c.target !== '[row]');
    this._closeDialog();
    this.emit('formattingchange', { detail: { rules: this._conditionalformatting } });
    this.loadData();       // re-render applies the formatting
    this._renderToolbar(); // refresh Formatting+ active-state hint
  }

  // ---- shared dialog open/close (jsdom-safe) --------------------------

  _openDialog(applyLabel = 'Apply') {
    if (this._dlgApplyBtn) this._dlgApplyBtn.textContent = applyLabel;
    if (typeof this._dlg.showModal === 'function') {
      try { this._dlg.showModal(); return; } catch { /* fall through */ }
    }
    this._dlg.setAttribute('open', ''); // fallback for environments without showModal
  }

  // ---- export (Phase 2) -----------------------------------------------

  /** Where the export POST goes. Configurable via `export-url`, else derived. */
  _exportEndpoint() {
    return this.exporturl || `${this.urlBase || ''}apphandler.php?action=exporttable`;
  }

  /** Open the export popup (format choice). */
  openExport() {
    this._dlgTitle.textContent = 'Export table';
    this._dlgBody.innerHTML = '';

    const formats = this._mk('div', 'fltable-export-formats');
    for (const [value, label, checked] of [['XLSX', 'Excel (XLSX)', true], ['CSV', 'CSV', false]]) {
      const wrap = this._mk('label', 'fltable-export-format');
      const radio = this._mk('input');
      radio.type = 'radio';
      radio.name = 'fl-exportfmt';
      radio.value = value;
      radio.checked = checked;
      wrap.append(radio, ' ' + label);
      formats.appendChild(wrap);
    }
    this._dlgBody.appendChild(formats);

    this._dlgApplyFn = () => this._doExport();
    this._openDialog('Export');
  }

  /**
   * Gather the export payload and hand it off. Emits a cancelable
   * `fl-table-export` event first: call preventDefault() to supply your own
   * export (e.g. client-side XLSX) instead of the default server POST.
   */
  _doExport() {
    const format = this._dlgBody.querySelector('input[name="fl-exportfmt"]:checked')?.value || 'XLSX';

    // export the FULL result set (page 0 / recsperpage 0), current filter+sort
    const url = this.getDataLoaderURL();
    url.searchParams.set('page', '0');
    url.searchParams.set('recsperpage', '0');

    const columns = [];
    const columnlabels = [];
    for (const col of this._columns) {
      if (!this._isColumnVisible(col) || !col.getAttribute('datafield')) continue;
      columns.push(col.getAttribute('datafield'));
      columnlabels.push(col.getAttribute('label') || '');
    }

    const payload = {
      exporttype: format,
      title: this.title || '',
      dataloaderurl: url.toString(),
      columns,
      columnlabels,
      conditionalformatting: this._conditionalformatting,
    };

    this._closeDialog();
    const ev = this.emit('fl-table-export', { detail: payload, cancelable: true });
    if (!ev.defaultPrevented) this._submitExport(payload);
  }

  /**
   * Default export transport: POST the payload to the export endpoint via a
   * hidden form targeting a hidden iframe, so the file download happens without
   * navigating the page. Arrays/objects are JSON-encoded as form fields — the
   * same shape the original server handler expects.
   */
  _submitExport(payload) {
    const iframeName = 'fl-export-' + uniqId('t');
    const iframe = document.createElement('iframe');
    iframe.name = iframeName;
    iframe.style.display = 'none';

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = this._exportEndpoint();
    form.target = iframeName;
    form.style.display = 'none';

    for (const [key, value] of Object.entries(payload)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = typeof value === 'string' ? value : JSON.stringify(value);
      form.appendChild(input);
    }

    document.body.append(iframe, form);
    try { form.submit(); } catch { /* environments without navigation */ }
    setTimeout(() => { form.remove(); iframe.remove(); }, 60000);
  }

  _closeDialog() {
    this._dlgApplyFn = null;
    if (typeof this._dlg.close === 'function') {
      try { this._dlg.close(); return; } catch { /* fall through */ }
    }
    this._dlg.removeAttribute('open');
  }

  // ---- conditional formatting (applied at render) ---------------------

  _checkCondition(condition, record) {
    let v = record?.[condition.fieldname];
    if (v === null || v === undefined) return false;
    v = String(v).toLowerCase();
    const p = String(condition.parameter).toLowerCase();
    const op = OPERATORS[condition.operator];
    return op ? op.test(v, p) : false;
  }

  _matches(cf, record) {
    if (cf.conditions.length === 0) return false;
    const results = cf.conditions.map((c) => this._checkCondition(c, record));
    return cf.glue === 'any' || cf.glue === 'or'
      ? results.some(Boolean)
      : results.every(Boolean);
  }

  _applyRowFormatting(row, record) {
    for (const cf of this._conditionalformatting) {
      if (cf.target !== '[row]') continue;
      if (!this._matches(cf, record)) continue;
      if (cf.backgroundcolor) row.style.backgroundColor = cf.backgroundcolor;
      if (cf.foregroundcolor) row.style.color = cf.foregroundcolor;
      if (cf.applyclass) row.classList.add(cf.applyclass);
    }
  }

  _applyCellFormatting(cell, datafield, record) {
    for (const cf of this._conditionalformatting) {
      if (cf.target !== datafield) continue;
      if (!this._matches(cf, record)) continue;
      if (cf.backgroundcolor) cell.style.backgroundColor = cf.backgroundcolor;
      if (cf.foregroundcolor) cell.style.color = cf.foregroundcolor;
      if (cf.applyclass) cell.classList.add(cf.applyclass);
    }
  }

  // ---- public instance API --------------------------------------------

  setTitle(title) {
    if (this._elTitle) this._elTitle.textContent = title || '';
  }

  reload() { this.loadData(); return this; }

  setDataLoaderUrl(url) { this.dataloaderurl = url; return this; } // triggers updated() -> reload

  goToPage(page = 1) {
    this._page = Number(page) || 1;
    this.emit('pagechange', { detail: { page: this._page } });
    this.loadData();
    return this;
  }

  setRecordsPerPage(n) { this._page = 1; this.recordsperpage = Number(n) || 0; return this; }

  setQuickFilter(text) {
    this._filter = String(text ?? '');
    this._page = 1;
    this.emit('filterchange', { detail: { filter: this._filter } });
    this.loadData();
    return this;
  }

  /**
   * Set the advanced filter. Accepts a single triple ["field","op","val"],
   * an array of triples, or null/[] to clear. Then reloads.
   */
  filter(advancedfilter) {
    if (!advancedfilter) this._advancedfilter = [];
    else if (Array.isArray(advancedfilter) && Array.isArray(advancedfilter[0])) this._advancedfilter = advancedfilter.slice();
    else if (Array.isArray(advancedfilter)) this._advancedfilter = [advancedfilter];
    this._page = 1;
    this.emit('filterchange', { detail: { advancedfilter: this._advancedfilter } });
    this.loadData();
    return this;
  }

  clearFilter() {
    this._filter = '';
    this._advancedfilter = [];
    this._page = 1;
    this.emit('filterchange', { detail: { cleared: true } });
    this.loadData();
    this._renderToolbar(); // refresh Filter+ active-state hint + keep quick-filter box in sync
    return this;
  }

  setSortOrder(order) {
    // order: ["field asc", …] or [["field","asc"], …]
    this._sortorder = (order || []).map((s) => Array.isArray(s) ? `${s[0]} ${s[1] || 'asc'}` : String(s));
    this.emit('orderchange', { detail: { sortorder: [...this._sortorder] } });
    this.loadData();
    return this;
  }

  /**
   * Group by one or more fields. Accepts a field name, a comma/space list, an
   * array, or null/[] to ungroup. Because grouping prepends the group fields to
   * the server sort (so groups stay contiguous across pages), this reloads the
   * data (resetting to page 1). Grouping itself is still a view over the page.
   */
  groupBy(fields) {
    if (!fields) this._groupby = [];
    else if (Array.isArray(fields)) this._groupby = fields.filter(Boolean);
    else this._groupby = String(fields).split(/[,\s]+/).map((f) => f.trim()).filter(Boolean);
    this._hasGrouping = this._groupby.length > 0;
    this._collapsedGroups.clear();
    this._page = 1;
    this.emit('groupchange', { detail: { groupby: [...this._groupby] } });
    this.loadData(); // re-sort on the server (group fields first), then re-render
    return this;
  }

  collapseAllGroups() {
    this._allGroupKeys().forEach((k) => this._collapsedGroups.add(k));
    this._renderBody(this._records);
    return this;
  }

  expandAllGroups() {
    this._collapsedGroups.clear();
    this._renderBody(this._records);
    return this;
  }

  getSelectedRecordId() { return this._selectedRecordId; }
  getSelectedRecord() { return this._selectedRecordId == null ? null : (this._recordsById.get(String(this._selectedRecordId)) || null); }
  getData() { return this._records.slice(); }
  getColumns() { return this._columns; }
  getNrOfRecords() { return this._totalrecords; }
  clear() { this._renderEmpty(); return this; }

  // ---- static, id-based conveniences (backward-compatible surface) ----

  static getInstance(id) { return document.getElementById(id) || null; }
  static getRecordSelected(id) { return document.getElementById(id)?.getSelectedRecordId() ?? null; }
  static getSelectedRecord(id) { return document.getElementById(id)?.getSelectedRecord() ?? null; }
  static reloadTableById(id) { document.getElementById(id)?.reload(); }
  static filterTableById(id, advancedfilter) { document.getElementById(id)?.filter(advancedfilter); }
  static changeDataLoaderURLById(id, url) { document.getElementById(id)?.setDataLoaderUrl(url); }
  static getDataFromTableById(id) { return document.getElementById(id)?.getData() ?? null; }
  static clearTable(id) { document.getElementById(id)?.clear(); }
}

// ---------------------------------------------------------------------------
// registration — main element + inert config elements (so they're valid and,
// being un-slotted light-DOM children, never render).
// ---------------------------------------------------------------------------

for (const tag of ['fl-table-column', 'fl-table-footercolumn', 'fl-table-button', 'fl-valueconvertor', 'fl-table-conditional-formatting', 'fl-table-condition']) {
  if (!customElements.get(tag)) {
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() { this.style.display = 'none'; }
    });
  }
}

if (!customElements.get('fl-table')) {
  customElements.define('fl-table', FLTable);
}
