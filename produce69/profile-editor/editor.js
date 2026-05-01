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
const HANDOFF_KEY = 'p69-handoff-v1';

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
  // Pass-through play history loaded from imported profiles.
  // null = field absent in source (plugin will leave in-game records
  // untouched on import). non-null = field present, will overwrite.
  recentSongKeys: null,         // null | string[]
  mostPlayedPlays: null,        // null | { [songKey: string]: number }
  // Undo: LIFO stack of full state snapshots (favs + history fields).
  history: [],
  // TAG mode 3-state machine:
  //   'NORMAL'      regular filter tab is showing in the right pane
  //   'TAG_LEVEL1'  artist or stage list (drillable)
  //   'TAG_LEVEL2'  drilled into a specific artist/stage, showing songs
  // tagCategory: 'artist' | 'stage' (only meaningful in TAG_LEVEL*)
  // tagSelection: the picked artist/stage (only meaningful in TAG_LEVEL2)
  // tagPage: pagination index for the active TAG view
  tagMode: 'NORMAL',
  tagCategory: 'artist',
  tagSelection: null,
  tagPage: 0
};

const TAG_PAGE_SIZE = 54;

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
    consumeHandoff();
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

// One-shot handoff: when the converter sends the user here via "Open in
// editor", it writes a JSON payload to localStorage under HANDOFF_KEY.
// We consume + clear it on boot, prefilling the favorites list and
// flagging the banner. If handoff payload is malformed, log and ignore.
function consumeHandoff() {
  let raw;
  try {
    raw = localStorage.getItem(HANDOFF_KEY);
  } catch (e) {
    return; // localStorage disabled
  }
  if (!raw) return;
  try {
    localStorage.removeItem(HANDOFF_KEY);
  } catch (e) { /* ignore */ }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    console.warn('Handoff payload not valid JSON:', e);
    return;
  }
  if (!payload || !Array.isArray(payload.trackIds)) return;
  const trackIds = payload.trackIds.filter(id => typeof id === 'string');
  if (trackIds.length === 0) return;
  state.favorites = trackIds.slice();
  state.favoritesSet = new Set(trackIds);
  showHandoffBanner(trackIds.length, payload.source || 'another tool');
}

function showHandoffBanner(count, source) {
  const banner = document.getElementById('handoff-banner');
  if (!banner) return;
  const sourceLabel = source === 'converter' ? 'profile converter' : source;
  document.getElementById('handoff-banner-text').textContent =
    'Loaded ' + count + ' track' + (count === 1 ? '' : 's') +
    ' from the ' + sourceLabel + '. Refine your list, then export when ready.';
  banner.classList.remove('hidden');
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

  if (state.tagMode === 'NORMAL') {
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
    return;
  }

  // In TAG mode, the strip shows BY ARTIST | BY STAGE | ... | BACK pill.
  const subTabs = [
    { cat: 'artist', label: 'BY ARTIST' },
    { cat: 'stage',  label: 'BY STAGE' }
  ];
  for (const sub of subTabs) {
    const btn = document.createElement('button');
    btn.className = 'tab' + (state.tagCategory === sub.cat ? ' active' : '');
    btn.textContent = sub.label;
    btn.addEventListener('click', () => onTagSubTabClick(sub.cat));
    strip.appendChild(btn);
  }
  const back = document.createElement('button');
  back.className = 'tab tag-pill';
  back.textContent = 'BACK';
  back.title = state.tagMode === 'TAG_LEVEL2'
    ? 'Back to ' + (state.tagCategory === 'artist' ? 'BY ARTIST' : 'BY STAGE') + ' list'
    : 'Exit TAG mode';
  back.addEventListener('click', onTagBackClick);
  strip.appendChild(back);
}

function onTabClick(key) {
  if (key === 'TAG') {
    // Enter TAG mode at LEVEL1, defaulting to BY ARTIST.
    state.currentTab = 'TAG';
    state.tagMode = 'TAG_LEVEL1';
    state.tagCategory = state.tagCategory || 'artist';
    state.tagSelection = null;
    state.tagPage = 0;
    state.expandedSongKey = null;
    renderTabStrip();
    renderRightPane();
    return;
  }
  if (state.tagMode === 'NORMAL' && state.currentTab === key) return;
  state.currentTab = key;
  state.tagMode = 'NORMAL';
  state.tagSelection = null;
  state.tagPage = 0;
  state.expandedSongKey = null;
  renderTabStrip();
  renderRightPane();
}

function onTagSubTabClick(category) {
  if (state.tagCategory === category && state.tagMode === 'TAG_LEVEL1') return;
  state.tagCategory = category;
  state.tagMode = 'TAG_LEVEL1';
  state.tagSelection = null;
  state.tagPage = 0;
  state.expandedSongKey = null;
  renderTabStrip();
  renderRightPane();
}

function onTagBackClick() {
  if (state.tagMode === 'TAG_LEVEL2') {
    // Drill back up to LEVEL1
    state.tagMode = 'TAG_LEVEL1';
    state.tagSelection = null;
    state.tagPage = 0;
  } else {
    // Exit TAG mode entirely, back to the previous regular tab
    state.tagMode = 'NORMAL';
    state.tagSelection = null;
    state.tagPage = 0;
    if (state.currentTab === 'TAG') state.currentTab = DEFAULT_TAB;
  }
  state.expandedSongKey = null;
  renderTabStrip();
  renderRightPane();
}

function onTagItemClick(item) {
  state.tagMode = 'TAG_LEVEL2';
  state.tagSelection = item;
  state.tagPage = 0;
  state.expandedSongKey = null;
  renderTabStrip();
  renderRightPane();
}

function onTagPageClick(direction) {
  const list = currentTagListing();
  const totalPages = Math.max(1, Math.ceil(list.length / TAG_PAGE_SIZE));
  if (direction === 'prev' && state.tagPage > 0) state.tagPage--;
  else if (direction === 'next' && state.tagPage < totalPages - 1) state.tagPage++;
  state.expandedSongKey = null;
  renderRightPane();
}

// Returns the current list being paginated:
//   - LEVEL1: artists or stages array
//   - LEVEL2: songKeys filtered by selected artist/stage, sorted
function currentTagListing() {
  if (state.tagMode === 'TAG_LEVEL1') {
    return state.tagCategory === 'artist'
      ? state.catalog.tags.artists
      : state.catalog.tags.stages;
  }
  if (state.tagMode === 'TAG_LEVEL2') {
    return computeLevel2SongKeys(state.tagCategory, state.tagSelection);
  }
  return [];
}

function computeLevel2SongKeys(category, selection) {
  const seen = new Set();
  for (const t of state.catalog.tracks) {
    if (category === 'artist') {
      const sep = t.songKey.indexOf(' - ');
      if (sep < 0) continue;
      if (t.songKey.slice(0, sep) !== selection) continue;
    } else {
      if (t.stage !== selection) continue;
    }
    seen.add(t.songKey);
  }
  return Array.from(seen).sort();
}

// ============================================================
// Render: right pane content
// ============================================================

function renderRightPane() {
  const content = document.getElementById('catalog-content');
  if (state.tagMode === 'TAG_LEVEL1') {
    renderTagLevel1();
    return;
  }
  if (state.tagMode === 'TAG_LEVEL2') {
    renderTagLevel2();
    return;
  }
  const list = state.catalog.lists[state.currentTab];
  if (!list) {
    content.innerHTML = '<p class="placeholder-msg">No data for this tab.</p>';
    return;
  }
  renderNormalGrid(list);
}

function renderPaginationHTML(total, page) {
  const totalPages = Math.max(1, Math.ceil(total / TAG_PAGE_SIZE));
  if (totalPages <= 1) return '';
  return (
    '<div class="pagination">' +
    '<button data-action="prev"' + (page === 0 ? ' disabled' : '') +
    '>&lt; PREVIOUS PAGE</button>' +
    '<span class="page-info">PAGE ' + (page + 1) + ' / ' + totalPages + '</span>' +
    '<button data-action="next"' + (page >= totalPages - 1 ? ' disabled' : '') +
    '>NEXT PAGE &gt;</button>' +
    '</div>'
  );
}

function renderTagLevel1() {
  const content = document.getElementById('catalog-content');
  const items = currentTagListing();
  const start = state.tagPage * TAG_PAGE_SIZE;
  const pageItems = items.slice(start, start + TAG_PAGE_SIZE);

  const html = ['<div class="song-grid">'];
  for (let i = 0; i < TAG_PAGE_SIZE; i++) {
    const item = pageItems[i];
    if (!item) {
      html.push('<div class="slot empty"></div>');
      continue;
    }
    html.push(
      '<div class="slot tag-item" data-tag-item="' + escapeHTML(item) + '">' +
      '<i>' + escapeHTML(item) + '</i>' +
      '</div>'
    );
  }
  html.push('</div>');
  html.push(renderPaginationHTML(items.length, state.tagPage));
  content.innerHTML = html.join('');

  content.querySelectorAll('.slot.tag-item').forEach(el => {
    el.addEventListener('click', () => onTagItemClick(el.dataset.tagItem));
  });
  content.querySelectorAll('.pagination button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => onTagPageClick(btn.dataset.action));
  });
}

function renderTagLevel2() {
  const content = document.getElementById('catalog-content');
  const songKeys = currentTagListing();
  const start = state.tagPage * TAG_PAGE_SIZE;
  const pageKeys = songKeys.slice(start, start + TAG_PAGE_SIZE);

  // Build pseudo-slot objects so we can reuse renderSlot for consistent UX
  // (NEW highlight, multi-variant popover, added indicator, etc.)
  const pseudoSlots = pageKeys.map(sk => ({ idx: 0, songKey: sk, released: true }));

  const headerLabel = state.tagCategory === 'artist' ? 'BY ARTIST' : 'BY STAGE';
  const html = [];
  html.push(
    '<div class="tag-level2-header">' +
    '<button class="tag-back-link" type="button">&laquo; ' + headerLabel + '</button>' +
    '<span class="tag-current"><i>' + escapeHTML(state.tagSelection) + '</i></span>' +
    '<span class="tag-count">' + songKeys.length + ' song' +
    (songKeys.length === 1 ? '' : 's') + '</span>' +
    '</div>'
  );

  html.push('<div class="song-grid">');
  for (let i = 0; i < TAG_PAGE_SIZE; i++) {
    const slot = pseudoSlots[i];
    if (!slot) {
      html.push('<div class="slot empty"></div>');
      continue;
    }
    html.push(renderSlot(slot));
  }
  html.push('</div>');
  html.push(renderPaginationHTML(songKeys.length, state.tagPage));
  content.innerHTML = html.join('');

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
  content.querySelector('.tag-back-link').addEventListener('click', () => {
    state.tagMode = 'TAG_LEVEL1';
    state.tagSelection = null;
    state.tagPage = 0;
    state.expandedSongKey = null;
    renderRightPane();
  });
  content.querySelectorAll('.pagination button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => onTagPageClick(btn.dataset.action));
  });
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

  // History indicator: click drop to clear loaded history
  document.getElementById('history-drop-btn').addEventListener('click', () => {
    if (state.recentSongKeys === null && state.mostPlayedPlays === null) return;
    const ok = confirm(
      'Drop the loaded play history?\n\n' +
      'After this, exported profiles will leave the player\'s in-game RECENT ' +
      'and MOST PLAYED untouched (favorites-only export).\n\n' +
      'Your favorites list is unaffected. This is undoable.'
    );
    if (!ok) return;
    dropHistory();
    renderHistoryIndicator();
    renderFavList();
  });

  // Handoff banner dismiss
  const banner = document.getElementById('handoff-banner');
  if (banner) {
    document.getElementById('handoff-banner-dismiss').addEventListener('click', () => {
      banner.classList.add('hidden');
    });
  }

  // Export modal buttons
  document.getElementById('export-with-history-btn').addEventListener('click', () => {
    hideExportModal();
    doExport(true);
  });
  document.getElementById('export-favs-only-btn').addEventListener('click', () => {
    hideExportModal();
    doExport(false);
  });
  document.getElementById('export-cancel-btn').addEventListener('click', hideExportModal);
  document.querySelector('#export-modal .modal-backdrop')
    .addEventListener('click', hideExportModal);

  document.addEventListener('keydown', e => {
    // ESC closes the export modal if open
    if (e.key === 'Escape') {
      const modal = document.getElementById('export-modal');
      if (modal && !modal.classList.contains('hidden')) {
        hideExportModal();
        return;
      }
    }
    // Ctrl/Cmd+Z = undo. Skip when focus is in a text input or when Shift is
    // held (Shift+Ctrl+Z = redo on most platforms; redo not implemented).
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

function snapshotState() {
  return {
    favorites: state.favorites.slice(),
    recentSongKeys: state.recentSongKeys ? state.recentSongKeys.slice() : null,
    mostPlayedPlays: state.mostPlayedPlays ? Object.assign({}, state.mostPlayedPlays) : null
  };
}

function restoreState(snap) {
  state.favorites = snap.favorites.slice();
  state.favoritesSet = new Set(snap.favorites);
  state.recentSongKeys = snap.recentSongKeys ? snap.recentSongKeys.slice() : null;
  state.mostPlayedPlays = snap.mostPlayedPlays ? Object.assign({}, snap.mostPlayedPlays) : null;
}

function pushHistory() {
  state.history.push(snapshotState());
  if (state.history.length > MAX_HISTORY) state.history.shift();
}

function undo() {
  if (state.history.length === 0) return;
  const prev = state.history.pop();
  restoreState(prev);
  state.expandedSongKey = null;
  renderRightPane();
  renderFavList();
  renderHistoryIndicator();
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

function dropHistory() {
  if (state.recentSongKeys === null && state.mostPlayedPlays === null) return;
  pushHistory();
  state.recentSongKeys = null;
  state.mostPlayedPlays = null;
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

function renderHistoryIndicator() {
  const ind = document.getElementById('history-indicator');
  if (!ind) return;
  const r = state.recentSongKeys;
  const mp = state.mostPlayedPlays;
  if (r === null && mp === null) {
    ind.classList.add('hidden');
    return;
  }
  const parts = [];
  if (r) parts.push('RECENT (' + r.length + ')');
  if (mp) parts.push('MOST PLAYED (' + Object.keys(mp).length + ')');
  document.getElementById('history-indicator-label').textContent =
    'play history loaded: ' + parts.join(' + ');
  ind.classList.remove('hidden');
}

function renderFavList() {
  const list = document.getElementById('fav-list');
  const emptyMsg = document.getElementById('empty-fav-msg');
  const footer = document.getElementById('fav-footer');
  const countEl = document.getElementById('fav-count');

  countEl.textContent = state.favorites.length;
  updateUndoButton();
  renderHistoryIndicator();

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
  const tail = state.recentSongKeys !== null || state.mostPlayedPlays !== null
    ? '\n\nLoaded play history (RECENT / MOST PLAYED) is unaffected — drop it separately via the pill in the action bar.'
    : '';
  const ok = confirm(
    'Clear all ' + state.favorites.length +
    ' favorite' + (state.favorites.length === 1 ? '' : 's') + '?' + tail
  );
  if (!ok) return;
  clearFavorites();
  renderFavList();
  renderRightPane();
}

function onExportClick() {
  const hasHistory = state.recentSongKeys !== null || state.mostPlayedPlays !== null;
  if (state.favorites.length === 0 && !hasHistory) {
    alert('Nothing to export — pick some songs first.');
    return;
  }
  if (hasHistory) {
    showExportModal();
  } else {
    doExport(false);
  }
}

function showExportModal() {
  const parts = [];
  if (state.recentSongKeys) {
    parts.push('<strong>RECENT</strong> (' + state.recentSongKeys.length + ' entries)');
  }
  if (state.mostPlayedPlays) {
    parts.push('<strong>MOST PLAYED</strong> (' +
      Object.keys(state.mostPlayedPlays).length + ' songs)');
  }
  document.getElementById('history-summary').innerHTML = parts.join(' and ');
  document.getElementById('export-modal').classList.remove('hidden');
}

function hideExportModal() {
  document.getElementById('export-modal').classList.add('hidden');
}

function doExport(includeHistory) {
  const profile = {
    version: '1.0',
    exportedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    favorites: { trackIds: state.favorites.slice() }
  };
  if (includeHistory) {
    if (state.recentSongKeys) {
      profile.recent = { songKeys: state.recentSongKeys.slice() };
    }
    if (state.mostPlayedPlays) {
      // Schema stores counts as strings (VAM JSON convention)
      const playsOut = {};
      for (const k of Object.keys(state.mostPlayedPlays)) {
        playsOut[k] = String(state.mostPlayedPlays[k]);
      }
      profile.mostPlayed = { plays: playsOut };
    }
  }
  const json = JSON.stringify(profile, null, 2);
  const today = new Date().toISOString().slice(0, 10);
  const suffix = includeHistory ? '' : '_favs';
  const filename = 'produce69_profile_' + today + suffix + '.p69save';
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
      const incomingFavs = data.favorites.trackIds.filter(id => typeof id === 'string');

      // Optional history fields: only adopt them if present AND well-formed.
      // Keep null when absent so re-export defaults to "favorites only" and
      // the plugin's partial-patch import leaves in-game RECENT/MOST PLAYED
      // alone.
      let incomingRecent = null;
      if (data.recent && Array.isArray(data.recent.songKeys)) {
        incomingRecent = data.recent.songKeys.filter(s => typeof s === 'string');
      }
      let incomingMostPlayed = null;
      if (data.mostPlayed && data.mostPlayed.plays && typeof data.mostPlayed.plays === 'object') {
        incomingMostPlayed = {};
        for (const k of Object.keys(data.mostPlayed.plays)) {
          const raw = data.mostPlayed.plays[k];
          // Schema stores counts as strings (VAM JSON convention); accept numbers too.
          const n = parseInt(raw, 10);
          if (Number.isFinite(n) && n > 0) incomingMostPlayed[k] = n;
        }
      }

      const hasIncomingHistory = incomingRecent !== null || incomingMostPlayed !== null;
      if (state.favorites.length > 0 || state.recentSongKeys !== null || state.mostPlayedPlays !== null) {
        const summary =
          state.favorites.length + ' favorite' +
          (state.favorites.length === 1 ? '' : 's') +
          (state.recentSongKeys ? ' + RECENT (' + state.recentSongKeys.length + ')' : '') +
          (state.mostPlayedPlays ? ' + MOST PLAYED (' + Object.keys(state.mostPlayedPlays).length + ')' : '');
        const incomingSummary =
          incomingFavs.length + ' favorite' +
          (incomingFavs.length === 1 ? '' : 's') +
          (incomingRecent ? ' + RECENT (' + incomingRecent.length + ')' : '') +
          (incomingMostPlayed ? ' + MOST PLAYED (' + Object.keys(incomingMostPlayed).length + ')' : '');
        const ok = confirm(
          'Replace current state (' + summary + ') with file contents (' + incomingSummary + ')?'
        );
        if (!ok) {
          e.target.value = '';
          return;
        }
      }
      pushHistory();
      state.favorites = incomingFavs.slice();
      state.favoritesSet = new Set(incomingFavs);
      state.recentSongKeys = incomingRecent;
      state.mostPlayedPlays = incomingMostPlayed;
      state.expandedSongKey = null;
      renderRightPane();
      renderFavList();
      renderHistoryIndicator();
      if (hasIncomingHistory) {
        // Surface the implication immediately so user understands what they
        // just loaded — re-export will, by default, prompt about it.
        // No modal needed here; the indicator + tooltip carries the message.
      }
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
