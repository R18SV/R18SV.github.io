#!/usr/bin/env node
/*
 * build-catalog.js
 *
 * Reads the plugin's _songs.json and per-filter list files, emits a
 * single bundled catalog used by the online profile editor:
 *   produce69/profile-editor/catalog.json
 *
 * Bundle contents:
 *   - tracks[]           per-staging slim records (trackId / songKey / stage / variantNumber)
 *   - lists{}            per-filter projection of slot data (Season 01-05, DLC 01-03,
 *                        Duet, Explicit, New). Slots are passed through verbatim, since
 *                        they already carry rawText / displayName / released / songKey
 *                        plus optional from / comingSoon / header for the New tab.
 *   - newReleaseSet[]    songKeys flagged NEW (released, not coming soon) — used by the
 *                        UI to highlight cross-tab.
 *   - tags{}             { artists[], stages[] } sorted indices for TAG mode drill.
 *
 * Internal-only fields from _songs.json (BGM paths, motion presets, voice-actor IDs,
 * outfit / hairstyle, R18SV_*-prefixed asset paths) are intentionally dropped.
 *
 * Usage:
 *   node tools/build-catalog.js [<path to plugin Lists folder>]
 *
 * Default plugin Lists folder:
 *   ../../Custom/Scripts/Shadow Venom/Produce 69/Lists
 * relative to this file.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_LISTS_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'Custom',
  'Scripts',
  'Shadow Venom',
  'Produce 69',
  'Lists'
);
const OUTPUT = path.resolve(
  __dirname,
  '..',
  'produce69',
  'profile-editor',
  'catalog.json'
);

// Stage display alias resolution — mirrors the plugin's ResolveStageDisplay
// (src/PlaylistController.cs). Several technical stage names should
// consolidate under a single display label for the BY STAGE drill list.
// The plugin applies this at the UI layer at runtime; the slim public
// catalog applies it at build time so the web editor's stage list matches
// the in-game UI and the i18n `stages` overlay (which is keyed by display
// aliases) resolves correctly.
//
// Family-pattern rules (auto-consolidate any indexed variant — no map
// maintenance when new variants are added):
//   "SP NN Stage"       -> "Multi Stage"     (e.g. SP 01 Stage, SP 02 Stage)
//   "Oriental Stage NN" -> "Oriental Stage"  (e.g. Oriental Stage 01, 06, 07)
//
// STAGE_DISPLAY_ALIAS is a fallback for one-off aliases that don't fit the
// family rules (currently empty; reserved for future cases).
//
// Keep in sync with:
//   - F:\VAM\Produce69 Plugin Dev\docs\STAGE_DISPLAY_ALIAS_NOTE.md
//     (moved out of the plugin folder on 2026-05-21 as part of pre-release cleanup;
//      the plugin itself no longer ships any docs)
//   - Custom/Scripts/Shadow Venom/Produce 69/src/PlaylistController.cs ResolveStageDisplay
const STAGE_DISPLAY_ALIAS = {
};

function isSpStageFamily(s) {
  return /^SP \d+ Stage$/.test(s);
}

function isOrientalStageFamily(s) {
  return /^Oriental Stage \d+$/.test(s);
}

function resolveStageDisplay(s) {
  if (!s) return s;
  if (isSpStageFamily(s)) return 'Multi Stage';
  if (isOrientalStageFamily(s)) return 'Oriental Stage';
  return STAGE_DISPLAY_ALIAS[s] || s;
}

// RC5+ (2026-05-29): RAW list is temporarily HIDDEN from the public Web
// catalog (user decision — visitor-facing surface should not expose WIP
// pool yet). Data sync from plugin remains normal: RAW.list.json keeps
// flowing through Creator → tools, the filter is applied at this build
// step right before publish. Flip back to `new Set()` to re-expose RAW.
//
// Effect on output catalog:
//   - tracks[]:        RAW-only songs dropped (their stagings excluded)
//   - lists{}:         RAW key omitted entirely (buildListsBundle filter)
//   - newReleaseSet:   RAW songKeys dropped (defensive, NEW shouldn't list RAW)
//   - tags.artists:    artists with only RAW songs dropped
//   - tags.stages:     stages with only RAW songs dropped
//
// In-game runtime continues to gate RAW behind `Show Raw List?` toggle
// (off by default) — see PlaylistController.IsEligibleForRandomPool.
const HIDDEN_LISTS = new Set(['RAW']);

// Filter tabs surfaced in the editor right-pane. Order is the canonical
// tab order; the UI uses this to drive its tab strip layout. My Favorites is
// the editor's left pane, not a browse target. RAW appears as the last tab.
const LIST_FILES = [
  { key: 'Season 01', file: 'Season 01.list.json' },
  { key: 'Season 02', file: 'Season 02.list.json' },
  { key: 'Season 03', file: 'Season 03.list.json' },
  { key: 'Season 04', file: 'Season 04.list.json' },
  { key: 'Season 05', file: 'Season 05.list.json' },
  { key: 'DLC 01',    file: 'DLC 01.list.json' },
  { key: 'DLC 02',    file: 'DLC 02.list.json' },
  { key: 'DLC 03',    file: 'DLC 03.list.json' },
  { key: 'Duet',      file: 'Duet.list.json' },
  { key: 'Explicit',  file: 'Explicit.list.json' },
  { key: 'New',       file: '_new_release.list.json' },
  { key: 'RAW',       file: 'RAW.list.json' }
];

function extractVariantNumber(trackId) {
  const m = /^(.+) (\d+)$/.exec(trackId);
  return m ? parseInt(m[2], 10) : 0;
}

function buildTracks(songsRaw, wipSongKeys) {
  // (RC5 2026-05-25: hybrid-set indexing retired — hybrid multi-variant
  //  pattern dissolved upstream. Tracks group by songKey only.)
  const out = [];
  const songKeys = Object.keys(songsRaw.songs).sort();
  for (const songKey of songKeys) {
    if (wipSongKeys && wipSongKeys.has(songKey)) continue;
    const song = songsRaw.songs[songKey];
    if (!Array.isArray(song.stagings)) continue;
    const variants = song.stagings.map(st => ({
      trackId: st.id,
      songKey: song.songKey,
      stage: resolveStageDisplay(st.stage),
      variantNumber: extractVariantNumber(st.id)
    }));
    variants.sort((a, b) => a.variantNumber - b.variantNumber);
    out.push(...variants);
  }
  return out;
}

// Scan ALL list files in listsDir (NOT limited to LIST_FILES whitelist) to
// build the songKey → Set<listName> reverse index. RC5: HIDDEN_LISTS is now
// empty so WIP filtering is effectively disabled; the scan + index machinery
// is retained so we can reintroduce a hide list cheaply in the future.
function buildSongKeyToLists(listsDir) {
  const out = new Map();
  if (!fs.existsSync(listsDir)) return out;
  const entries = fs.readdirSync(listsDir);
  for (const entry of entries) {
    if (!entry.endsWith('.list.json')) continue;
    let data;
    try {
      let txt = fs.readFileSync(path.join(listsDir, entry), 'utf-8');
      if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
      data = JSON.parse(txt);
    } catch (e) {
      console.warn('Failed to parse list file: ' + entry);
      continue;
    }
    const listName = data.name || entry.replace(/\.list\.json$/, '');
    if (!Array.isArray(data.slots)) continue;
    for (const slot of data.slots) {
      if (!slot.songKey) continue;
      if (!out.has(slot.songKey)) out.set(slot.songKey, new Set());
      out.get(slot.songKey).add(listName);
    }
  }
  return out;
}

function computeWipSongKeys(songKeyToLists, hiddenSet) {
  const wip = new Set();
  for (const [sk, lists] of songKeyToLists) {
    if (lists.size === 0) continue;
    let allHidden = true;
    for (const l of lists) {
      if (!hiddenSet.has(l)) { allHidden = false; break; }
    }
    if (allHidden) wip.add(sk);
  }
  return wip;
}

// Songs that appear in at least one hidden list AND at least one visible list
// (= cross-list WIP, distinct from wipSongKeys which are hidden-list-EXCLUSIVE).
// These tracks stay in catalog tracks[] (so user favorites of them resolve
// correctly and TAG drill can surface them as fav-discovery candidates), but
// their slot in the visible list must render as a gray placeholder per spec §46
// — the visible-list slot is a preview/placeholder, not a release entry.
function computeWipCrossListSongKeys(songKeyToLists, hiddenSet) {
  const set = new Set();
  for (const [sk, lists] of songKeyToLists) {
    let hasHidden = false;
    let hasVisible = false;
    for (const l of lists) {
      if (hiddenSet.has(l)) hasHidden = true;
      else                  hasVisible = true;
      if (hasHidden && hasVisible) break;
    }
    if (hasHidden && hasVisible) set.add(sk);
  }
  return set;
}

function computeWipTrackIds(songsRaw, wipSongKeys) {
  const ids = new Set();
  for (const sk of wipSongKeys) {
    const song = songsRaw.songs[sk];
    if (!song || !Array.isArray(song.stagings)) continue;
    for (const st of song.stagings) ids.add(st.id);
  }
  return ids;
}

// (RC5 2026-05-25: filterHybridSets retired — hybrid multi-variant pattern
//  dissolved upstream. No hybridSets to filter.)

function loadList(listsDir, file) {
  const fullPath = path.join(listsDir, file);
  if (!fs.existsSync(fullPath)) return null;
  // Strip UTF-8 BOM if present (some list files carry one from PowerShell edits).
  let txt = fs.readFileSync(fullPath, 'utf-8');
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
  return JSON.parse(txt);
}

function buildListsBundle(listsDir, wipCrossListSongKeys) {
  const out = {};
  const missing = [];
  const hidden = [];
  let crossListFlagged = 0;
  for (const entry of LIST_FILES) {
    // Drop entire list from the bundle if its name is in HIDDEN_LISTS.
    // Complements the per-track WIP filter above so the editor never sees
    // the list as a tab (no chrome leak) — not just empties its content.
    if (HIDDEN_LISTS.has(entry.key)) {
      hidden.push(entry.key);
      continue;
    }
    const data = loadList(listsDir, entry.file);
    if (!data) {
      missing.push(entry.file);
      continue;
    }
    const slots = Array.isArray(data.slots) ? data.slots.map(s => {
      // Mirror plugin §46 ShouldGrayAsCrossListRaw: if this slot's songKey
      // also lives in a hidden list (RAW), tag the slot so the editor
      // renders it as a gray placeholder (same treatment as comingSoon).
      // Slot object is copied (don't mutate the parsed source) and the flag
      // is only added when truthy so existing slots remain byte-identical.
      if (wipCrossListSongKeys && s.songKey && wipCrossListSongKeys.has(s.songKey)) {
        crossListFlagged++;
        return Object.assign({}, s, { wipReference: true });
      }
      return s;
    }) : [];
    out[entry.key] = {
      name: data.name || entry.key,
      slotCount: typeof data.slotCount === 'number' ? data.slotCount : 54,
      slots: slots
    };
  }
  if (missing.length > 0) {
    console.warn('Missing list files (skipped): ' + missing.join(', '));
  }
  if (hidden.length > 0) {
    console.log('Hidden lists  : ' + hidden.join(', ') + ' (per HIDDEN_LISTS, excluded from bundle)');
  }
  if (crossListFlagged > 0) {
    console.log('Cross-list WIP: ' + crossListFlagged + ' slot(s) flagged wipReference=true (gray-render in editor)');
  }
  return out;
}

function deriveNewReleaseSet(newList) {
  // Per data schema: `comingSoon: true` excludes from the NEW lookup set.
  // Header rows (no songKey) are not contributing.
  if (!newList || !Array.isArray(newList.slots)) return [];
  const set = new Set();
  for (const slot of newList.slots) {
    if (slot.songKey && !slot.comingSoon) {
      set.add(slot.songKey);
    }
  }
  return Array.from(set).sort();
}

function deriveArtists(tracks) {
  // SongKey is "<ARTIST> - <TITLE>". Some artist labels include spaces or
  // special chars (e.g., "(G)I-DLE", "BROWN EYED GIRLS", "花澤 香菜") — split
  // on the FIRST " - " only.
  const set = new Set();
  for (const t of tracks) {
    const sk = t.songKey || '';
    const idx = sk.indexOf(' - ');
    if (idx < 0) continue;
    set.add(sk.slice(0, idx));
  }
  return Array.from(set).sort();
}

function deriveStages(tracks) {
  const set = new Set();
  for (const t of tracks) {
    if (t.stage) set.add(t.stage);
  }
  return Array.from(set).sort();
}

function main() {
  const listsDir = process.argv[2] || DEFAULT_LISTS_DIR;
  const songsPath = path.join(listsDir, '_songs.json');
  if (!fs.existsSync(songsPath)) {
    console.error('Source not found: ' + songsPath);
    process.exit(1);
  }

  const songsRaw = JSON.parse(fs.readFileSync(songsPath, 'utf-8'));

  // WIP filter: RC5 disables this (HIDDEN_LISTS = empty Set, so wipSongKeys
  // resolves to {}). RAW is intentionally exposed on Web. Scan kept in place
  // so a future "hide this list" mechanism just needs to add names to the set.
  const songKeyToLists = buildSongKeyToLists(listsDir);
  const wipSongKeys = computeWipSongKeys(songKeyToLists, HIDDEN_LISTS);
  const wipTrackIds = computeWipTrackIds(songsRaw, wipSongKeys);
  const wipCrossListSongKeys = computeWipCrossListSongKeys(songKeyToLists, HIDDEN_LISTS);

  const tracks = buildTracks(songsRaw, wipSongKeys);
  const lists = buildListsBundle(listsDir, wipCrossListSongKeys);
  const newReleaseSet = deriveNewReleaseSet(lists['New'])
    .filter(sk => !wipSongKeys.has(sk));
  const artists = deriveArtists(tracks);
  const stages = deriveStages(tracks);

  const catalog = {
    sourceVersion: 'plugin/_songs.json @ ' + (songsRaw.generatedAt || 'unknown'),
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    songCount: songsRaw.songCount,
    trackCount: tracks.length,
    tracks,
    lists,
    newReleaseSet,
    tags: { artists, stages }
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(catalog, null, 2), 'utf-8');

  const sizeBytes = fs.statSync(OUTPUT).size;
  console.log('Lists dir : ' + listsDir);
  console.log('Output    : ' + OUTPUT);
  console.log('Songs     : ' + catalog.songCount);
  console.log('Tracks    : ' + tracks.length);
  console.log('Lists     : ' + Object.keys(lists).length + ' (' + Object.keys(lists).join(', ') + ')');
  console.log('NEW set   : ' + newReleaseSet.length + ' songs');
  console.log('Artists   : ' + artists.length);
  console.log('Stages    : ' + stages.length);
  console.log('WIP songs : ' + wipSongKeys.size + ' filtered (' + wipTrackIds.size + ' track variants)');
  console.log('Size      : ' + sizeBytes + ' bytes');
}

main();
