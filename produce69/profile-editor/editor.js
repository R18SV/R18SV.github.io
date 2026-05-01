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
  favoritesSet: new Set()
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
}

// ============================================================
// Fav state mutators
// ============================================================

function addFavorite(trackId) {
  if (state.favoritesSet.has(trackId)) return;
  state.favorites.push(trackId);
  state.favoritesSet.add(trackId);
}

function removeFavorite(trackId) {
  if (!state.favoritesSet.has(trackId)) return;
  const idx = state.favorites.indexOf(trackId);
  if (idx >= 0) state.favorites.splice(idx, 1);
  state.favoritesSet.delete(trackId);
}

function clearFavorites() {
  state.favorites = [];
  state.favoritesSet = new Set();
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
        '<li class="fav-row" data-trackid="' + escapeHTML(trackId) + '">' +
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
