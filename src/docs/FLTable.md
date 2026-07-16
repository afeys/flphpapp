# FLTable — `<fl-table>` reference

A data-grid Web Component built on `FLBaseComponent` (Shadow DOM). It renders a
server-backed, paginated table with sorting, filtering, conditional formatting,
grouping, inline editing, an add-row workflow, export, and row-action icons —
all driven by declarative markup and controllable with attributes.

- **Tag:** `fl-table`
- **No external dependencies.** No FLFunctions / FLUI / fl-panel / global
  `callMethod`. Application hooks are surfaced as DOM events; theming is done
  with `--fl-*` CSS custom properties.
- **Config is declarative.** Columns, footer columns, toolbar buttons, value
  convertors and conditional-formatting rules are child elements read once at
  connect. They are inert (never rendered themselves) and your light-DOM markup
  is left untouched.

---

## Contents

1. [Getting started](#getting-started)
2. [Server data contract](#server-data-contract)
3. [Host attributes (`<fl-table>`)](#host-attributes)
4. [Toolbar & feature toggles](#toolbar--feature-toggles)
5. [Columns (`<fl-table-column>`)](#columns)
6. [Footer columns (`<fl-table-footercolumn>`)](#footer-columns)
7. [Value convertors (`<fl-valueconvertor>`)](#value-convertors)
8. [Conditional formatting](#conditional-formatting)
9. [Custom toolbar buttons (`<fl-table-button>`)](#custom-toolbar-buttons)
10. [Sorting](#sorting)
11. [Filtering](#filtering)
12. [Click-to-filter](#click-to-filter)
13. [Row-action icons](#row-action-icons)
14. [Grouping](#grouping)
15. [Inline editing](#inline-editing)
16. [Add row](#add-row)
17. [Export](#export)
18. [Events](#events)
19. [JavaScript API](#javascript-api)
20. [Theming](#theming)
21. [Recipes](#recipes)

---

## Getting started

Place `table.js` in `src/js/ui/`, register it once (importing the file registers
`<fl-table>` via `customElements.define`), and bump your cache-busting `?v=`:

```js
// init.js
import './ui/table.js';
```

Minimal usage — a column set plus a data endpoint:

```html
<fl-table dataloaderurl="/api/data.php?screen=projects" primarykeyfield="id">
  <fl-table-column name="id"   label="ID"   datafield="id" hidden></fl-table-column>
  <fl-table-column name="code" label="Code" datafield="code"></fl-table-column>
  <fl-table-column name="name" label="Name" datafield="name"></fl-table-column>
</fl-table>
```

The table fetches its first page as soon as it connects.

---

## Server data contract

**Request.** On every load the table issues a `GET` to `dataloaderurl` with these
query parameters appended (existing query parameters in the URL are preserved):

| Param | Meaning |
|---|---|
| `page` | 1-based page number. `0` means "all" (used by export). |
| `recsperpage` | Rows per page. `0` means "all". |
| `filter` | The quick-filter text (free text). |
| `advancedfilter` | A SQL-ish `WHERE` fragment built from advanced-filter / click-to-filter conditions (see [Filtering](#filtering)). |
| `sortorder` | Comma-separated `field dir` list, e.g. `status asc,code desc`. When grouping is active the group fields are prepended automatically. |

**Response.** The endpoint must return JSON:

```json
{ "data": [ { "id": 1, "code": "P001", "name": "…" } ], "totalrecs": 42, "page": 1 }
```

- `data` — array of record objects for the requested page.
- `totalrecs` — total row count across all pages (drives pagination math).
- `page` — the page actually served (echoed back).

The table reads records by the field names referenced in your columns and by
`primarykeyfield`. Hidden columns' `datafield`s are still available in the record
objects (for `getData()`, links, formatting, etc.).

---

## Host attributes

Attributes on the `<fl-table>` element itself. All reflect to/from properties.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `dataloaderurl` | string | — | The JSON endpoint (see [contract](#server-data-contract)). |
| `title` | string | — | Caption shown above the toolbar. |
| `pagination` | string | `top bottom prevnext` | Space-separated tokens: `top`, `bottom` (where the pager appears), `prevnext` (show ‹ › buttons). Empty string hides the pager. |
| `recordsperpage` | number | `15` | Page size. `0` = all rows on one page. |
| `nrofpaginationbuttons` | number | `5` | Max number of numbered page buttons shown in the pager window. |
| `primarykeyfield` | string | `id` | Record field used as the unique key (selection, edit/add payloads, `getSelectedRecord`, etc.). |
| `emptymessage` | string | `No records found.` | Text shown when a page has no rows. |
| `highlightselectedrow` | boolean | `true` | Highlight the clicked row and track it as the selection. |
| `minimal` | boolean | `false` | Strip the entire toolbar **and** pagination (see below). |
| `minimalwithpagination` | boolean | `false` | Strip the toolbar but keep top pagination. |
| `url-base` | string | `''` | Base URL prepended by value convertors that build links, and used to derive default export/edit endpoints. |
| `export-url` | string | `''` | Endpoint the Export button POSTs to. Defaults to `${url-base}apphandler.php?action=exporttable`. |
| `edit-url` | string | `''` | Endpoint inline edits POST to (see [Inline editing](#inline-editing)). If unset, edits are event-only. |
| `add-url` | string | `''` | Endpoint the inline add-row POSTs to (see [Add row](#add-row)). If unset, a new row is inserted locally. |

Boolean attributes follow the HTML convention: **presence = true** (`minimal`,
not `minimal="true"`).

---

## Toolbar & feature toggles

The toolbar is assembled from a set of features, each on by default (except
**Add**, which is opt-in). You control them with attributes in one of two styles:

**Allowlist** — `features="…"` shows *only* the named features, everything else off:

```html
<fl-table features="search,clearfilter"> … </fl-table>   <!-- simple table -->
```

**Denylist** — `no-<feature>` switches specific features off, the rest stay on:

```html
<fl-table no-export no-formatting no-clicktofilter no-group> … </fl-table>
```

> If `features` is present it wins; `no-*` attributes are ignored for that table.
> Use one style or the other per element.

Recognized features and the attribute tokens (aliases) that refer to each:

| Feature | Tokens | What it controls |
|---|---|---|
| Quick filter | `quickfilter`, `search` | The free-text search box. |
| Clear filter | `clearfilter` | The **Clear filter** button. |
| Reload | `refresh`, `reload` | The **Reload** button. |
| Header sort | `columnsort`, `headersort` | The sort arrows in column headers. |
| Filter+ | `advancedfilter`, `filter` | The advanced-filter builder button. |
| Sort+ | `advancedsort`, `sort` | The advanced-sort builder button. |
| Formatting+ | `conditionalformatter`, `formatting`, `conditionalformatting` | The conditional-formatting builder button. |
| Export | `export` | The **Export** button. |
| Click to filter | `clicktofilter` | The click-to-filter toggle. |
| Group+ | `group`, `grouping` | The grouping builder button. |
| Add | `add`, `addbutton` | The **Add** button (**off by default**; opt in). |

Examples: `no-filter` hides Filter+, `no-sort` hides Sort+, `no-headersort`
removes the header sort arrows, `features="add,search"` shows only Add and the
search box.

**Minimal modes** take precedence over the above:

- `minimal` — no toolbar, no pagination, all rows on one page (`recordsperpage=0`).
- `minimalwithpagination` — no toolbar, top pagination kept.

---

## Columns

`<fl-table-column>` declares one column. Order in markup = column order.

| Attribute | Applies to | Description |
|---|---|---|
| `name` | all | Internal identifier for the column (used by some helpers / your own code). |
| `label` | all | Header text. Also used as the field label in the group builder, filter/sort builders and group headers. |
| `datafield` | all | The record field this column reads/writes. Required for sorting, filtering, formatting, editing. |
| `hidden` | all | Presence hides the column. The `datafield` is still available in records (`getData()`, links, etc.). |
| `type="hidden"` | all | Alternate way to hide a column. |
| `convertor` | display | Name of an `<fl-valueconvertor>` used to transform the display value (see [Value convertors](#value-convertors)). |
| `editable` | editing | Presence makes cells in this column editable (double-click). `editable="false"` explicitly disables. |
| `edittype` | editing | Editor kind: `text` (default), `number`, `date`, `select`, `checkbox` (aliases `bool`/`boolean`), `textarea`. |
| `editoptions` | editing (`select`) | Options for a select editor. Formats: `v1:Label 1, v2:Label 2`, a bare `a, b, c`, or a JSON array (`[{"value":…,"label":…}]` or `["a","b"]`). |
| `required` | editing | Presence: value may not be empty on commit. |
| `editmin` / `editmax` | editing (`number`) | Numeric range bounds (also set the input's `min`/`max`). |
| `editmaxlength` | editing | Max input length. |
| `editpattern` | editing | A regular-expression string the value must match. |

Sorting/formatting/editing all key off `datafield`; a column with no `datafield`
is display-only.

---

## Footer columns

`<fl-table-footercolumn>` builds a `<tfoot>` row (e.g. for totals your server or
your own code fills in). Cells are created in declaration order.

| Attribute | Description |
|---|---|
| `id` | Sets `data-fl-footerid` on the cell so you can target it to inject a total. |
| `colspan` | Column span for the cell (default `1`). |

When a leading actions column is present (row actions or inline add), the footer
row automatically gets a matching leading spacer cell so totals stay aligned.

---

## Value convertors

`<fl-valueconvertor>` registers a named display transform you can attach to a
column via `convertor="<name>"`.

```html
<fl-valueconvertor name="created" type="timestamptodate"></fl-valueconvertor>
<fl-table-column label="Created" datafield="created_ts" convertor="created"></fl-table-column>
```

| Attribute | Description |
|---|---|
| `name` | The name referenced by a column's `convertor` attribute. |
| `type` | The transform to apply (below). |
| `view` | Optional view hint passed through for link-building convertors (default `home`). |

Built-in `type` values:

| Type | Effect |
|---|---|
| `timestamptodate` | Shows the first 10 characters (the `YYYY-MM-DD` date part). |
| `striphtml` | Strips HTML tags from the value. |
| `booleantoyesno` | `1`/`"1"` → `Y`, otherwise `N`. |
| `modeliddesctolink` | Value `"model\|id\|description"` becomes a link to `index.php?view=<model>&id=<id>` with the description as text. |
| `recordidlabeltolink` | Comma-separated `id:label` items become a list of links. |
| `fileidnametodownloadlink` | Renders a file id/name pair as a download link. |

Convertors receive `(value, record, urlBase)` and may return either a string or a
DOM node.

---

## Conditional formatting

Colour rows or cells based on the data. Declare rules as child elements; they are
also editable at runtime via the **Formatting+** builder.

```html
<!-- red background on the whole row when status is closed -->
<fl-table-conditional-formatting target="[row]" andor="all" background-color="#ffe3e3">
  <fl-table-condition datafield="status" operator="eq" parameter="closed"></fl-table-condition>
</fl-table-conditional-formatting>

<!-- green text on just the status cell when open -->
<fl-table-conditional-formatting target="status" text-color="#0a7d28">
  <fl-table-condition datafield="status" operator="eq" parameter="open"></fl-table-condition>
</fl-table-conditional-formatting>
```

**`<fl-table-conditional-formatting>`**

| Attribute | Description |
|---|---|
| `target` | `[row]` (or `row` / `entire row`) formats the whole row; a `datafield` formats just that cell. |
| `andor` | `all` (every condition must match) or `any` (default `all`). |
| `background-color` | CSS colour applied as the background when matched. |
| `text-color` | CSS colour applied to the text when matched. |
| `class` | A CSS class name to add when matched (an alternative to inline colours). |

**`<fl-table-condition>`** (one or more, nested inside a rule)

| Attribute | Description |
|---|---|
| `datafield` | Field to test. |
| `operator` | One of the [operators](#operators) below (default `eq`). |
| `parameter` | Comparison value. |

Formatting is re-applied automatically after an inline edit, so a changed value
can flip a rule live.

---

## Custom toolbar buttons

`<fl-table-button>` injects your own buttons into the toolbar. Clicking one emits
`fl-table-buttonclick`.

```html
<fl-table-button id="archive" label="Archive" action="archive" location="last"></fl-table-button>
```

| Attribute | Description |
|---|---|
| `id` | Element id (echoed in the event; auto-generated if omitted). |
| `label` | Button text. Either `label` or `labelicon` is required. |
| `labelicon` | Material Icons ligature to show as an icon. |
| `action` | Arbitrary string echoed back in the event `detail.action`. |
| `location` | `first` (before the built-in buttons) or `last` (after them). |

---

## Sorting

**Header sort.** Click a column header's arrow to sort by it; click again to flip
direction; a small index badge shows multi-column order, and an `✕` clears that
field. Controlled by the `columnsort`/`headersort` feature.

**Sort+ builder.** Opens a dialog to build a multi-field sort (field + direction
per line). Controlled by the `advancedsort`/`sort` feature.

**Initial sort.** Set `sortorder="field asc, field2 desc"` on the host element.

Sorting is server-side: the current sort is sent as the `sortorder` query param.

---

## Filtering

**Quick filter.** The search box sends free text as the `filter` param on Enter.

**Filter+ builder.** Build advanced conditions (field / operator / value per
line). These compile into the `advancedfilter` query param as a SQL-ish `WHERE`
fragment (e.g. `lower(status) = 'open' and lower(code) like '%p0%'`). Your
endpoint interprets it.

**Clear filter** resets both the quick filter and advanced conditions.

Programmatic: `filter([[field, op, value], …])`, `clearFilter()`,
`setQuickFilter(text)`.

### Operators

Used by advanced filter, click-to-filter and conditional-formatting conditions:

| Op | Meaning |
|---|---|
| `eq` | Equals |
| `ne` | Not equals |
| `gt` / `lt` | Greater than / Less than |
| `ge` / `le` | Greater/Less than or equal |
| `bw` / `dbw` | Starts with / Does not start with |
| `ew` / `dew` | Ends with / Does not end with |
| `cnt` / `dcnt` | Contains / Does not contain |
| `in` | In (comma-separated list) |

---

## Click-to-filter

A toolbar toggle (`clicktofilter` feature). When on, the cursor becomes a zoom
hint and clicking any data cell adds an `eq` condition on that cell's value to the
advanced filter and reloads (row selection is suppressed while active). Toggling
off restores normal selection.

- Event: `fl-table-clicktofilter` → `{ active }`.
- API: `toggleClickToFilter([force])`.

---

## Row-action icons

Opt-in per-row icons via the `rowactions` attribute (a comma/space list). They
render in a leading column; clicking one emits `fl-table-rowaction` and does **not**
select the row — your app decides what to do (open a dialog, navigate, …).

```html
<fl-table rowactions="edit,comment,open"> … </fl-table>
```

| Token | Icon | Meaning |
|---|---|---|
| `edit` | ✎ | Edit |
| `comment` / `comments` | 💬 | Comments |
| `open` / `opennewtab` | ↗ | Open in new tab |

Event: `fl-table-rowaction` → `{ action, recordid, record }`.

---

## Grouping

Cluster the current page's rows into collapsible group headers, by one or more
fields.

```html
<fl-table groupby="status,category"> … </fl-table>
```

- **Declarative:** `groupby="status"` or a multi-level `groupby="status,category"`.
- **Group+ builder:** the `group`/`grouping` feature adds a toolbar button to pick
  group levels interactively.
- **Programmatic:** `groupBy(fields)` (string / comma-list / array; `null` to
  ungroup), `collapseAllGroups()`, `expandAllGroups()`.
- Group headers show the field label, value and a record count; click one to
  collapse/expand. Group members remain ordinary data rows, so selection,
  formatting, row actions and click-to-filter keep working inside groups.
- Event: `groupchange` → `{ groupby }`.

**Auto-sort-by-group.** Grouping is a view over the current page, so to keep a
group's rows from scattering across pages the table automatically prepends the
group fields to the `sortorder` it sends to the server (respecting any explicit
direction you set on a group field; your other sort fields order rows *within*
each group). Your visible header sort badges are unchanged — the group headers are
the grouping indicator.

> A group can still straddle a single page boundary (unavoidable with fixed-size
> pages). To group the entire result set with no split, set per-page to **All**
> (`recordsperpage="0"`). Fully eliminating boundary splits would require the
> server to group before paginating.

---

## Inline editing

Make columns editable in place. Opt in per column with `editable`; the table is
editable unless `readonly` (or `no-edit`) is set on the host.

```html
<fl-table edit-url="/save.php" primarykeyfield="id">
  <fl-table-column label="Name"   datafield="name"   editable required></fl-table-column>
  <fl-table-column label="Status" datafield="status" editable edittype="select"
                   editoptions="open:Open,closed:Closed"></fl-table-column>
  <fl-table-column label="Qty"    datafield="qty"    editable edittype="number"
                   editmin="0" editmax="100"></fl-table-column>
  <fl-table-column label="Active" datafield="active" editable edittype="checkbox"></fl-table-column>
</fl-table>
```

**Trigger & keys.** **Double-click** an editable cell (chosen so it never clashes
with single-click selection or click-to-filter). **Enter** commits, **Esc**
cancels and restores the original value, **blur** commits — or reverts if invalid.
`select` and `checkbox` commit immediately on change.

**Edit types.** `text` (default), `number`, `date`, `select` (uses `editoptions`),
`checkbox`/`bool`/`boolean` (stores `1`/`0`), `textarea`. Numbers commit as real
numbers.

**Validation** runs on commit and comes from column attributes — `required`,
`editmin`/`editmax` (numbers), `editpattern` (regex), `editmaxlength` — plus an
optional programmatic hook:

```js
table.setValidator('name', (value, record) => value.length >= 2 ? true : 'Too short');
```

An invalid **Enter** keeps the editor open with a red outline and the message as a
tooltip.

**Persistence** (same event-first, cancelable contract as export/add): on a
successful commit the table updates the record and cell optimistically, re-applies
row/cell conditional formatting, and emits a **cancelable** `fl-table-celledit`
with `{ recordid, field, oldValue, newValue, record }` (only when the value
changed).

- If you `preventDefault()` the event → you own persistence; the table makes no
  request.
- Else if `edit-url` is set → the table POSTs `{ <primarykeyfield>, field, value }`
  form-encoded; on a non-OK response it reverts the record and cell and emits
  `fl-table-editerror` → `{ recordid, field, value }`.
- Else (no `edit-url`, not prevented) → event-only; persist however you like.

---

## Add row

An opt-in **Add** button (off by default). Two modes, chosen with `addmode`:

- **`inline`** — inserts an empty editable entry row at the top with green-check
  **Save** and red-X **Cancel** controls; one editor per editable column, seeded
  with defaults. Enter saves, Esc cancels. All fields validate (same rules as
  inline editing) before committing.
- **`event`** — clicking Add simply emits `fl-table-add` so your app can open its
  own form/dialog.

Default mode is `inline` when the table has editable columns, else `event`;
requesting `inline` on a table with no editable columns safely falls back to
`event`.

```html
<fl-table add add-url="/add.php" addlabel="Add project">
  <fl-table-column label="Name"   datafield="name"   editable required></fl-table-column>
  <fl-table-column label="Status" datafield="status" editable edittype="select"
                   editoptions="open:Open,closed:Closed"></fl-table-column>
</fl-table>
```

| Attribute | Description |
|---|---|
| `add` / `addbutton` | Presence shows the Add button. |
| `addmode` | `inline` or `event` (see above). |
| `addlabel` | Button text (default `Add`). |
| `add-url` | POST target for a saved inline row. |

**On inline save** the table assembles the record and emits a **cancelable**
`fl-table-rowadd` → `{ record }`:

- `preventDefault()` → your app owns persistence and refresh; the entry row is removed.
- Else if `add-url` is set → POSTs the fields, then reloads (so a server-assigned
  id/row appears); `fl-table-adderror` → `{ record }` on failure.
- Else → optimistic local insert at the top of the current page.

Other events: `fl-table-addstart` (entry row opened), `fl-table-addcancel`
(dismissed). API: `addRow()` triggers the Add action.

> Enabling inline add reserves the same leading column that row-action icons use;
> tables that turn it on get a narrow leading column on every row.

---

## Export

The **Export** button (`export` feature) opens a small dialog (XLSX / CSV) and,
on confirm, emits a **cancelable** `fl-table-export` with the export payload
(`exporttype`, `title`, `dataloaderurl` set to the full result set, `columns`,
`columnlabels`, `conditionalformatting`).

- `preventDefault()` → you produce the export yourself.
- Otherwise the table POSTs the payload (hidden form → hidden iframe) to
  `export-url`, or `${url-base}apphandler.php?action=exporttable` by default.

---

## Events

All events bubble and cross shadow boundaries (`composed`). Listen on the
`<fl-table>` element.

| Event | `detail` | Cancelable | Fired when |
|---|---|:---:|---|
| `tablerendered` | — | | The component finished its initial connect. |
| `tableload` | — | | A data load completed. |
| `rowadded` | `{ record }` | | Each data row is rendered (internal/diagnostic). |
| `recordselect` | `{ recordid, record }` | | A row is selected. |
| `pagechange` | `{ page }` | | The page changed. |
| `orderchange` | `{ sortorder }` | | The sort order changed. |
| `filterchange` | `{ filter }` \| `{ advancedfilter }` \| `{ cleared }` | | Quick/advanced filter changed or cleared. |
| `formattingchange` | `{ rules }` | | Conditional-formatting rules changed via the builder. |
| `groupchange` | `{ groupby }` | | Grouping changed. |
| `fl-table-buttonclick` | `{ action, id, button }` | | A custom toolbar button was clicked. |
| `fl-table-rowaction` | `{ action, recordid, record }` | | A row-action icon was clicked. |
| `fl-table-clicktofilter` | `{ active }` | | Click-to-filter toggled. |
| `fl-table-export` | export payload | ✓ | Export confirmed. `preventDefault()` to handle it yourself. |
| `fl-table-celledit` | `{ recordid, field, oldValue, newValue, record }` | ✓ | An inline edit committed (value changed). `preventDefault()` to own persistence. |
| `fl-table-editerror` | `{ recordid, field, value }` | | An inline-edit POST failed (change reverted). |
| `fl-table-rowadd` | `{ record }` | ✓ | An inline add-row was saved. `preventDefault()` to own persistence. |
| `fl-table-add` | `{}` | | Add clicked in `event` mode. |
| `fl-table-addstart` | `{}` | | Inline add entry row opened. |
| `fl-table-addcancel` | `{}` | | Inline add entry row dismissed. |
| `fl-table-adderror` | `{ record }` | | An add-row POST failed. |

---

## JavaScript API

Instance methods on an `<fl-table>` element (`document.getElementById('t')`):

**Data & loading**
- `reload()` — refetch the current page.
- `setDataLoaderUrl(url)` — change the endpoint and reload.
- `goToPage(page)` — navigate to a page.
- `setRecordsPerPage(n)` — change page size.
- `getDataLoaderURL()` — the fully-composed request URL (with all params).
- `getData()` — array of the loaded page's records.
- `getNrOfRecords()` — total record count (`totalrecs`).
- `getColumns()` — the column config elements.
- `clear()` — empty the table.

**Selection**
- `getSelectedRecordId()` / `getSelectedRecord()`.

**Filtering / sorting / grouping**
- `setQuickFilter(text)`, `filter(advancedfilter)`, `clearFilter()`.
- `setSortOrder(order)` — array of `"field dir"` or `["field","dir"]`.
- `toggleClickToFilter([force])`.
- `groupBy(fields)`, `collapseAllGroups()`, `expandAllGroups()`.

**Editing / adding**
- `setValidator(field, fn)` — register a validator `fn(value, record) → true | "message"`.
- `addRow()` — trigger the Add action.

**Misc**
- `setTitle(title)`.

### Static, id-based helpers (backward-compatible surface)

| Static | Equivalent |
|---|---|
| `FLTable.getInstance(id)` | `document.getElementById(id)` |
| `FLTable.getRecordSelected(id)` | `…getSelectedRecordId()` |
| `FLTable.getSelectedRecord(id)` | `…getSelectedRecord()` |
| `FLTable.reloadTableById(id)` | `…reload()` |
| `FLTable.filterTableById(id, advancedfilter)` | `…filter(advancedfilter)` |
| `FLTable.changeDataLoaderURLById(id, url)` | `…setDataLoaderUrl(url)` |
| `FLTable.getDataFromTableById(id)` | `…getData()` |
| `FLTable.clearTable(id)` | `…clear()` |

---

## Theming

Set CSS custom properties on (or above) the element. `@font-face` declared at the
document level pierces the shadow root, so a self-hosted Material Icons face
styles the chevrons and icons.

| Variable | Used for |
|---|---|
| `--fl-text` | Base text colour. |
| `--fl-surface` | Surface/background for inputs, cards. |
| `--fl-line` | Borders / dividers. |
| `--fl-accent` | Accent (active buttons, editor border, sort badges). |
| `--fl-muted` | Secondary text (counts, icons). |
| `--fl-label` | Form labels in dialogs. |
| `--fl-danger` | Errors, remove buttons, invalid editors. |
| `--fl-ok` | Save (add-row) affordance. |
| `--fl-radius` | Corner radius. |
| `--fl-table-header-bg` | Header / card background. |
| `--fl-table-hover` | Row hover. |
| `--fl-table-selected` | Selected row / add entry row. |
| `--fl-table-stripe` | Zebra striping. |
| `--fl-table-group-bg` | Group header background. |
| `--fl-table-group-hover` | Group header hover. |
| `--fl-icon-font` | Icon font family (Material Icons). |

**Shadow parts** exposed for `::part()` styling: `wrap`, `title`, `toolbar`,
`pagination-top`, `table`.

---

## Recipes

**Bare read-only grid**

```html
<fl-table dataloaderurl="/api/data.php?screen=log" features="">
  <fl-table-column label="When" datafield="ts"></fl-table-column>
  <fl-table-column label="Message" datafield="msg"></fl-table-column>
</fl-table>
```

**Simple table with just search**

```html
<fl-table dataloaderurl="/api/data.php?screen=people" features="search,clearfilter"> … </fl-table>
```

**Full editor with add + row actions**

```html
<fl-table dataloaderurl="/api/data.php?screen=projects"
          edit-url="/save.php" add add-url="/add.php"
          rowactions="edit,open" primarykeyfield="id">
  <fl-table-column label="Code"   datafield="code"></fl-table-column>
  <fl-table-column label="Name"   datafield="name"   editable required></fl-table-column>
  <fl-table-column label="Status" datafield="status" editable edittype="select"
                   editoptions="open:Open,closed:Closed"></fl-table-column>
  <fl-table-column label="Amount" datafield="amount" editable edittype="number" editmin="0"></fl-table-column>
</fl-table>
```

**Grouped view**

```html
<fl-table dataloaderurl="/api/data.php?screen=projects" groupby="status,category"> … </fl-table>
```

**Listen for changes**

```js
const t = document.getElementById('projects');
t.addEventListener('fl-table-celledit', (e) => {
  const { recordid, field, newValue } = e.detail;
  // e.preventDefault(); // if you want to own persistence
});
t.addEventListener('fl-table-rowadd', (e) => console.log('new record', e.detail.record));
t.addEventListener('recordselect', (e) => console.log('selected', e.detail.recordid));
```
