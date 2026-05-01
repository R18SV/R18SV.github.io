'use strict';

/* ============================================================
   Profile Editor (Goal 2b) — v0.1
   Browse the catalog, pick favorites, export .p69save.
   ============================================================ */

// ============================================================
// Constants
// ============================================================

const TAB_CONFIG = [
  { key: 'Season 01', label: 'SEASON 1' },
  { key: 'Season 02', label: 'SEASON 2' },
  { key: 'Season 03', label: 'SEASON 3' },
  { key: 'Season 04', label: 'SEASON 4' },
  { key: 'Season 05', label: 'SEASON 5' },
  { key: 'New',       label: 'NEW' },
  { key: 'Explicit',  label: 'EXPLICIT' },
  { key: 'Duet',      label: 'DUET DANCE' },
  { key: 'DLC 01',    label: 'CLUB DLC' },
  { key: 'DLC 02',    label: 'HANFU DLC' },
  { key: 'DLC 03',    label: 'MIKU DLC' },
  { key: 'TAG',       label: 'TAG', isPill: true }
];

const DEFAULT_TAB = 'Season 01';
const DEFAULT_SLOT_COUNT = 54;
const MAX_HISTORY = 50;

// ============================================================
// State
// ============================================================

const state = {
  catalog: null,
  songKeyToTracks: new Map(),
  trackIdToTrack: new Map(),
  newReleaseSet: new Set(),
  currentTab: DEFAULT_TAB,
  expandedSongKey: null,
  favorites: [],
  favoritesSet: new Set(),
  // Undo: snapshots of favorites[] taken before each mutation. LIFO stack.
  history: []
};

// ============================================================
// Utilities
// ============================================================

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatFavLabel(trackId) {
  const t = state.trackIdToTrack.get(trackId);
  if (!t) {
    return {
      html:
        '<span class="label is-missing"><i>' +
        escapeHTML(trackId) +
        '</i><span class="missing-tag">(not in catalog)</span></span>',
      isMissing: true
    };
  }
  const variants = state.songKeyToTracks.get(t.songKey) || [];
  const isMulti = variants.length > 1;
  let suffix = '';
  if (isMulti && t.variantNumber > 0) {
    suffix = '<span class="variant-suffix">[' + pad2(t.variantNumber) + ']</span>';
  } else if (isMulti && t.variantNumber === 0) {
    // Multi-variant with descriptive suffix (e.g. "Empire Duet" / "Empire Single").
    // Disambiguate by trackId so the user can tell rows apart.
    suffix = '<span class="variant-suffix">(' + escapeHTML(t.trackId) + ')</span>';
  }
  return {
    html:
      '<span class="label"><i>' + escapeHTML(t.songKey) + '</i>' + suffix + '</span>',
    isMissing: false
  };
}

// ============================================================
// Boot
// ============================================================

async function boot() {
  try {
    const res = await fetch('catalog.json');
    if (!res.ok) {
      throw new Error('Catalog fetch failed (' + res.status + ' ' + res.statusText + ')');
    }
    state.catalog = await res.json();
    initIndices();
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('editor').classList.remove('hidden');
    renderTabStrip();
    renderRightPane();
    renderFavList();
    wireGlobalHandlers();
  } catch (err) {
    showLoadError(err);
  }
}

function initIndices() {
  state.songKeyToTracks = new Map();
  state.trackIdToTrack = new Map();
  for (const t of state.catalog.tracks) {
    if (!state.songKeyToTracks.has(t.songKey)) {
      state.songKeyToTracks.set(t.songKey, []);
    }
    state.songKeyToTracks.get(t.songKey).push(t);
    state.trackIdToTrack.set(t.trackId, t);
  }
  state.newReleaseSet = new Set(state.catalog.newReleaseSet || []);
}

function showLoadError(err) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('editor').classList.add('hidden');
  const errEl = document.getElementById('error');
  errEl.classList.remove('hidden');
  document.getElementById('error-msg').textContent =
    err && err.message ? err.message : String(err);
}

// ============================================================
// Render: tab strip
// ============================================================

function renderTabStrip() {
  const strip = document.getElementById('tab-strip');
  strip.innerHTML = '';
  for (const tab of TAB_CONFIG) {
    const btn = document.createElement('button');
    btn.className =
      'tab' +
      (tab.isPill ? ' tag-pill' : '') +
      (tab.key === state.currentTab ? ' active' : '');
    btn.textContent = tab.label;
    btn.dataset.tabKey = tab.key;
    btn.addEventListener('click', () => onTabClick(tab.key));
    strip.appendChild(btn);
  }
}

function onTabClick(key) {
  if (state.currentTab === key) return;
  state.currentTab = key;
  state.expandedSongKey = null;
  renderTabStrip();
  renderRightPane();
}

// ============================================================
// Render: right pane content
// ============================================================

function renderRightPane() {
  const content = document.getElementById('catalog-content');
  if (state.currentTab === 'TAG') {
    content.innerHTML =
      '<p class="placeholder-msg">TAG mode (BY ARTIST / BY STAGE drill-down) ' +
      'is in the next iteration.</p>';
    return;
  }
  const list = state.catalog.lists[state.currentTab];
  if (!list) {
    content.innerHTML = '<p class="placeholder-msg">No data for this tab.</p>';
    return;
  }
  renderNormalGrid(list);
}

function renderNormalGrid(list) {
  const content = document.getElementById('catalog-content');
  const slotCount =
    typeof list.slotCount === 'number' ? list.slotCount : DEFAULT_SLOT_COUNT;
  const slotsByIdx = new Map();
  for (const slot of list.slots) slotsByIdx.set(slot.idx, slot);

  const html = ['<div class="song-grid">'];
  for (let i = 0; i < slotCount; i++) {
    const slot = slotsByIdx.get(i);
    if (!slot) {
      html.push('<div class="slot empty"></div>');
      continue;
    }
    html.push(renderSlot(slot));
  }
  html.push('</div>');
  content.innerHTML = html.join('');

  // Wire clicks (delegated would also work; explicit listeners are clearer here)
  content.querySelectorAll('.slot.song[data-songkey]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      onSongSlotClick(el.dataset.songkey);
    });
  });
  content.querySelectorAll('.variant-popover .vp-row').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      onVariantRowClick(el.dataset.trackid);
    });
  });
}

function renderSlot(slot) {
  if (slot.header) {
    return '<div class="slot header">' + escapeHTML(slot.header) + '</div>';
  }
  if (!slot.songKey) {
    return '<div class="slot empty"></div>';
  }
  const songKey = slot.songKey;
  const variants = state.songKeyToTracks.get(songKey) || [];
  const isMulti = variants.length > 1;
  const isComingSoon = slot.released === false || slot.comingSoon === true;
  const isNew = state.newReleaseSet.has(songKey);
  const isExpanded = state.expandedSongKey === songKey && isMulti;
  const isAdded =
    variants.length > 0 && variants.some(v => state.favoritesSet.has(v.trackId));

  const cls = [
    'slot song',
    isComingSoon ? 'coming-soon' : '',
    isNew ? 'is-new' : '',
    isAdded ? 'added' : '',
    isExpanded ? 'expanded' : ''
  ]
    .filter(Boolean)
    .join(' ');

  const fromTag = slot.from
    ? '<span class="from-tag">[' + escapeHTML(slot.from) + ']</span>'
    : '';
  const checkPill = isAdded ? '<span class="check-pill">&#10003; ADDED</span>' : '';
  const label = '<i>' + escapeHTML(songKey) + '</i>';
  const popover = isExpanded ? renderVariantPopover(songKey, variants) : '';

  // Coming-soon rows have no songkey data attr (so they don't bind a click).
  const dataAttr = isComingSoon ? '' : ' data-songkey="' + escapeHTML(songKey) + '"';

  return (
    '<div class="' + cls + '"' + dataAttr + '>' +
    label + fromTag + checkPill + popover +
    '</div>'
  );
}

function renderVariantPopover(songKey, variants) {
  const sorted = variants.slice().sort((a, b) => a.variantNumber - b.variantNumber);
  const rows = sorted
    .map(v => {
      const isAdded = state.favoritesSet.has(v.trackId);
      let lbl;
      if (v.variantNumber > 0) {
        lbl =
          '<span><strong>[' + pad2(v.variantNumber) + ']</strong> ' +
          '<span class="vp-stage">' + escapeHTML(v.stage) + '</span></span>';
      } else {
        lbl =
          '<span><span class="vp-stage">' + escapeHTML(v.stage) + '</span>' +
          '<span class="vp-trackid">' + escapeHTML(v.trackId) + '</span></span>';
      }
      const cls = 'vp-row' + (isAdded ? ' added' : '');
      const action = isAdded
        ? '<span class="vp-action">&#10003; ADDED</span>'
        : '<span class="vp-action">+ ADD</span>';
      return (
        '<div class="' + cls + '" data-trackid="' + escapeHTML(v.trackId) + '">' +
        lbl + action + '</div>'
      );
    })
    .join('');
  return (
    '<div class="variant-popover">' +
    '<div class="vp-title">Choose a variant</div>' +
    rows +
    '</div>'
  );
}

// ============================================================
// Click handlers — catalog side
// ============================================================

function onSongSlotClick(songKey) {
  const variants = state.songKeyToTracks.get(songKey) || [];
  if (variants.length === 0) return;
  if (variants.length === 1) {
    const v = variants[0];
    if (state.favoritesSet.has(v.trackId)) {
      removeFavorite(v.trackId);
    } else {
      addFavorite(v.trackId);
    }
    state.expandedSongKey = null;
    renderRightPane();
    renderFavList();
    return;
  }
  state.expandedSongKey = state.expandedSongKey === songKey ? null : songKey;
  renderRightPane();
}

function onVariantRowClick(trackId) {
  if (state.favoritesSet.has(trackId)) {
    removeFavorite(trackId);
  } else {
    addFavorite(trackId);
  }
  renderRightPane();
  renderFavList();
}

function wireGlobalHandlers() {
  // Click outside an expanded slot collapses the variant popover.
  document.addEventListener('click', e => {
    if (!state.expandedSongKey) return;
    const tgt = e.target;
    if (tgt.closest && (tgt.closest('.slot.song.expanded') || tgt.closest('.variant-popover'))) {
      return;
    }
    state.expandedSongKey = null;
    renderRightPane();
  });

  // Wire action bar
  document.getElementById('export-btn').addEventListener('click', onExportClick);
  document.getElementById('import-btn').addEventListener('click', onImportClick);
  document
    .getElementById('import-file-input')
    .addEventListener('change', onImportFileChange);
  document.getElementById('clear-fav-btn').addEventListener('click', onClearAllClick);
  document.getElementById('undo-btn').addEventListener('click', undo);

  // Ctrl/Cmd+Z = undo. Skip when modifier-Z is in a text input (none here, but
  // future-proof) or when shift is also held (that's redo on most platforms).
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.shiftKey || e.altKey) return;
    if (e.key !== 'z' && e.key !== 'Z') return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    undo();
  });
}

// ============================================================
// Fav state mutators (each pushes a history snapshot first)
// ============================================================

function pushHistory() {
  state.history.push(state.favorites.slice());
  if (state.history.length > MAX_HISTORY) state.history.shift();
}

function undo() {
  if (state.history.length === 0) return;
  const prev = state.history.pop();
  state.favorites = prev;
  state.favoritesSet = new Set(prev);
  state.expandedSongKey = null;
  renderRightPane();
  renderFavList();
}

function updateUndoButton() {
  const btn = document.getElementById('undo-btn');
  if (!btn) return;
  btn.disabled = state.history.length === 0;
  btn.title = state.history.length === 0
    ? 'Nothing to undo'
    : 'Undo last change (Ctrl+Z) — ' + state.history.length + ' step' +
      (state.history.length === 1 ? '' : 's') + ' available';
}

function addFavorite(trackId) {
  if (state.favoritesSet.has(trackId)) return;
  pushHistory();
  state.favorites.push(trackId);
  state.favoritesSet.add(trackId);
}

function removeFavorite(trackId) {
  if (!state.favoritesSet.has(trackId)) return;
  pushHistory();
  const idx = state.favorites.indexOf(trackId);
  if (idx >= 0) state.favorites.splice(idx, 1);
  state.favoritesSet.delete(trackId);
}

function clearFavorites() {
  if (state.favorites.length === 0) return;
  pushHistory();
  state.favorites = [];
  state.favoritesSet = new Set();
}

function reorderFavorite(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  if (fromIdx < 0 || fromIdx >= state.favorites.length) return;
  if (toIdx < 0 || toIdx > state.favorites.length) return;
  pushHistory();
  const [moved] = state.favorites.splice(fromIdx, 1);
  // If we removed an item before the target, target index shifts left by 1
  const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
  state.favorites.splice(adjustedTo, 0, moved);
}

// ============================================================
// Render: fav list (left pane)
// ============================================================

function renderFavList() {
  const list = document.getElementById('fav-list');
  const emptyMsg = document.getElementById('empty-fav-msg');
  const footer = document.getElementById('fav-footer');
  const countEl = document.getElementById('fav-count');

  countEl.textContent = state.favorites.length;
  updateUndoButton();

  if (state.favorites.length === 0) {
    list.classList.add('hidden');
    emptyMsg.classList.remove('hidden');
    footer.classList.add('hidden');
    return;
  }

  list.classList.remove('hidden');
  emptyMsg.classList.add('hidden');
  footer.classList.remove('hidden');

  const html = state.favorites
    .map((trackId, idx) => {
      const lbl = formatFavLabel(trackId);
      return (
        '<li class="fav-row" data-trackid="' + escapeHTML(trackId) +
        '" data-idx="' + idx + '" draggable="true">' +
        '<span class="index">' + (idx + 1) + '.</span>' +
        lbl.html +
        '<button class="remove-btn" title="Remove from favorites">&times;</button>' +
        '</li>'
      );
    })
    .join('');
  list.innerHTML = html;

  list.querySelectorAll('button.remove-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const trackId = btn.closest('.fav-row').dataset.trackid;
      removeFavorite(trackId);
      renderFavList();
      renderRightPane();
    });
  });

  wireDragHandlers(list);
}

// HTML5 drag-and-drop for fav-list reordering. Each row is draggable;
// dragover on a row marks it as the drop target; on drop, splice the
// favorites array to move source to target.
function wireDragHandlers(listEl) {
  let dragSrcIdx = null;

  function clearTargets() {
    listEl.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  }

  listEl.querySelectorAll('.fav-row').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragSrcIdx = parseInt(row.dataset.idx, 10);
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Required for Firefox to actually fire drag events
      e.dataTransfer.setData('text/plain', String(dragSrcIdx));
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      clearTargets();
      dragSrcIdx = null;
    });
    row.addEventListener('dragover', e => {
      if (dragSrcIdx === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const targetIdx = parseInt(row.dataset.idx, 10);
      if (targetIdx === dragSrcIdx) return;
      clearTargets();
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drop-target');
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      if (dragSrcIdx === null) return;
      const targetIdx = parseInt(row.dataset.idx, 10);
      reorderFavorite(dragSrcIdx, targetIdx);
      dragSrcIdx = null;
      renderFavList();
      // Catalog "added" markers are unchanged on reorder, no need to
      // re-render right pane.
    });
  });
}

// ============================================================
// Action bar handlers
// ============================================================

function onClearAllClick() {
  if (state.favorites.length === 0) return;
  const ok = confirm(
    'Clear all ' + state.favorites.length +
    ' favorite' + (state.favorites.length === 1 ? '' : 's') + '?'
  );
  if (!ok) return;
  clearFavorites();
  renderFavList();
  renderRightPane();
}

function onExportClick() {
  if (state.favorites.length === 0) {
    alert('Your favorites list is empty. Pick some songs first.');
    return;
  }
  const profile = {
    version: '1.0',
    exportedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    favorites: { trackIds: state.favorites.slice() }
  };
  const json = JSON.stringify(profile, null, 2);
  const today = new Date().toISOString().slice(0, 10);
  const filename = 'produce69_profile_' + today + '.p69save';
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function onImportClick() {
  document.getElementById('import-file-input').click();
}

function onImportFileChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object') {
        throw new Error('File is not a JSON object.');
      }
      if (!data.favorites || !Array.isArray(data.favorites.trackIds)) {
        throw new Error(
          'File does not contain a favorites.trackIds array. ' +
          'Make sure you uploaded a .p69save profile (with a "favorites" field).'
        );
      }
      const incoming = data.favorites.trackIds.filter(id => typeof id === 'string');
      if (state.favorites.length > 0) {
        const ok = confirm(
          'Replace your current ' + state.favorites.length +
          ' favorite' + (state.favorites.length === 1 ? '' : 's') +
          ' with ' + incoming.length + ' from the file?'
        );
        if (!ok) {
          e.target.value = '';
          return;
        }
      }
      pushHistory();
      state.favorites = incoming.slice();
      state.favoritesSet = new Set(incoming);
      state.expandedSongKey = null;
      renderRightPane();
      renderFavList();
    } catch (err) {
      alert('Could not import: ' + (err.message || String(err)));
    }
  };
  reader.onerror = () => alert('Could not read the file.');
  reader.readAsText(file);
  e.target.value = '';
}

// ============================================================
// Init
// ============================================================

document.addEventListener('DOMContentLoaded', boot);
