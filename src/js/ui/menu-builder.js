// menu-builder.js
//
// Fetches the menu JSON from the server (MenuController) and builds the
// <fl-menubar> + <fl-menu-panel>/<fl-menu-group>/<fl-menu-item> elements from
// it. The FL components must already be registered (import init.js first);
// element upgrade happens automatically regardless of creation order.
//
// Usage:
//   import { buildMenu } from './menu-builder.js';
//   buildMenu({ mount: document.querySelector('.header'), endpoint: '/menu.php' });

/** Tiny DOM helper. attrs with null/undefined/false are skipped; true -> "". */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) {
    if (c != null) node.append(c);
  }
  return node;
}

/** A menubar icon button for a given zone. */
function iconButton(def, slot, cls) {
  const btn = el('button', {
    class: cls,
    slot,
    title: def.title || def.label || '',
    'aria-label': def.title || def.label || '',
    'data-panel': def.panel || null, // component delegates data-panel clicks
    'data-id': def.id || null,       // used by fl-usericons-change
  });
  btn.textContent = def.icon || ''; // Material Icons ligature
  // href icons navigate; panel icons are handled by the component's delegation.
  if (!def.panel && def.href) {
    btn.addEventListener('click', () => { window.location.href = def.href; });
  }
  return btn;
}

/** Build the top-slot content for a panel (command line / search box). */
function buildTop(top) {
  if (!top) return null;
  const wrap = el('div', { slot: 'top', class: 'doline' });
  if (top.type === 'search') {
    wrap.append(
      el('span', { class: 'material-icons' }, 'search'),
      el('input', { type: 'text', placeholder: top.placeholder || 'Search everything...' }),
      el('button', {}, top.button || 'Search'),
    );
  } else { // 'command' (default)
    wrap.append(
      el('span', {}, top.label || 'What do you want to do?'),
      el('input', { type: 'text', placeholder: top.placeholder || 'Type a command...' }),
      el('button', {}, top.button || 'Go'),
    );
  }
  return wrap;
}

/** Build one <fl-menu-group> (with its links / items). */
function buildGroup(group) {
  const g = el('fl-menu-group', { label: group.label, open: !!group.open });
  for (const item of group.items || []) {
    if ((item.type || 'link') === 'item') {
      const mi = el('fl-menu-item', { label: item.label, icon: item.icon || null });
      for (const sub of item.subitems || []) {
        mi.append(el('a', { href: sub.href || '#' }, sub.label || ''));
      }
      g.append(mi);
    } else {
      g.append(el('a', { href: item.href || '#' }, item.label || ''));
    }
  }
  return g;
}

/** Build one <fl-menu-panel>. */
function buildPanel(panel) {
  const p = el('fl-menu-panel', { id: panel.id, layout: panel.layout || 'stack' });
  const top = buildTop(panel.top);
  if (top) p.append(top);
  for (const group of panel.groups || []) p.append(buildGroup(group));
  return p;
}

/** Render the whole menu (bar + panels) into `mount`, replacing its contents. */
export function renderMenu(mount, data) {
  const frag = document.createDocumentFragment();

  const bar = el('fl-menubar', { id: 'bar', panel: data.bar?.panel || null });
  for (const ic of data.bar?.fixed || [])  bar.append(iconButton(ic, 'fixed',  'fixedicon'));
  for (const ic of data.bar?.user  || [])  bar.append(iconButton(ic, 'user',   'usericon'));
  for (const ic of data.bar?.system || []) bar.append(iconButton(ic, 'system', 'sysicon'));
  frag.append(bar);

  for (const panel of data.panels || []) frag.append(buildPanel(panel));

  mount.replaceChildren(frag);

  // Persist user-zone changes back to the server (optional).
  bar.addEventListener('fl-usericons-change', (e) => {
    fetch('/menu.php?save=usericons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(e.detail.ids),
    }).catch(() => { /* best-effort */ });
  });

  return { bar };
}

/** Fetch the JSON from `endpoint` and render it into `mount`. */
export async function buildMenu({ mount, endpoint = '/menu.php' } = {}) {
  if (!mount) throw new Error('buildMenu: `mount` element is required');
  const res = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`buildMenu: ${endpoint} returned ${res.status}`);
  const data = await res.json();
  renderMenu(mount, data);
  return data;
}
