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
//   - Custom/Scripts/Shadow Venom/Produce 69/STAGE_DISPLAY_ALIAS_NOTE.md
//   - PlaylistController.cs ResolveStageDisplay
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

// Plugin-side hidden lists: TABs the plugin hides from normal players (only
// reachable via the in-plugin dev dropdown). Tracks whose ENTIRE list
// membership falls inside this set are WIP — they must NOT leak into the
// public catalog (TAG drills, song/track indices, hybrid set grouping,
// newReleaseSet). A track that appears in any non-hidden list (e.g. promoted
// from Season 06 to Season 01 while keeping the S6 archive entry) is public
// and stays. Mirror plugin's hardcoded hidden-set; long-term should migrate
// to a `hidden:true` flag on _index.json so both sides read one source.
const HIDDEN_LISTS = new Set(['Season 06', 'Season 07', 'Season 08']);

// Filter tabs surfaced in the editor right-pane. Order is the canonical
// tab order; the UI uses this to drive its tab strip layout. Skip Season 06,
// Wishbox, and My Favorites (My Favorites is the editor's left pane, not a
// browse target).
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
  { key: 'New',       file: '_new_release.list.json' }
];

function extractVariantNumber(trackId) {
  const m = /^(.+) (\d+)$/.exec(trackId);
  return m ? parseInt(m[2], 10) : 0;
}

function buildTracks(songsRaw, wipSongKeys) {
  // Build a per-trackId → hybridSetId index from the songs file's hybridSets
  // top-level map. Tracks belonging to a hybrid set get a `hybridSet` field
  // on their per-staging record so the editor can group click targets by
  // hybrid set OR songKey (whichever is present). See produce69_hybrid_multivariant
  // memory + Web Hybrid Variant Popover handoff.
  const hybridSets = (songsRaw && songsRaw.hybridSets) || {};
  const trackIdToHybridSet = new Map();
  for (const setId of Object.keys(hybridSets)) {
    const info = hybridSets[setId] || {};
    for (const memberId of (info.members || [])) {
      trackIdToHybridSet.set(memberId, setId);
    }
  }

  const out = [];
  const songKeys = Object.keys(songsRaw.songs).sort();
  for (const songKey of songKeys) {
    if (wipSongKeys && wipSongKeys.has(songKey)) continue;
    const song = songsRaw.songs[songKey];
    if (!Array.isArray(song.stagings)) continue;
    const variants = song.stagings.map(st => {
      const rec = {
        trackId: st.id,
        songKey: song.songKey,
        stage: resolveStageDisplay(st.stage),
        variantNumber: extractVariantNumber(st.id)
      };
      const hs = trackIdToHybridSet.get(st.id);
      if (hs) rec.hybridSet = hs;
      return rec;
    });
    variants.sort((a, b) => a.variantNumber - b.variantNumber);
    out.push(...variants);
  }
  return out;
}

// Scan ALL list files in listsDir (NOT limited to LIST_FILES whitelist) to
// build the songKey → Set<listName> reverse index. Required to determine WIP
// status: a songKey is WIP iff every list it appears in is in HIDDEN_LISTS,
// which means we MUST see the hidden lists too (S6 etc.) — otherwise we
// couldn't tell "lives only in S6" from "lives nowhere".
function buildSongKeyToLists(listsDir) {
  const out = new Map();
  if (!fs.existsSync(listsDir)) return out;
  const entries = fs.readdirSync(listsDir);
  for (const entry of entries) {
    if (!entry.endsWith('.list.json')) continue;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(listsDir, entry), 'utf-8'));
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

function computeWipTrackIds(songsRaw, wipSongKeys) {
  const ids = new Set();
  for (const sk of wipSongKeys) {
    const song = songsRaw.songs[sk];
    if (!song || !Array.isArray(song.stagings)) continue;
    for (const st of song.stagings) ids.add(st.id);
  }
  return ids;
}

function filterHybridSets(hybridSets, wipTrackIds) {
  const out = {};
  for (const setId of Object.keys(hybridSets || {})) {
    const info = hybridSets[setId] || {};
    const members = (info.members || []).filter(m => !wipTrackIds.has(m));
    if (members.length === 0) continue;
    out[setId] = Object.assign({}, info, { members });
  }
  return out;
}

function loadList(listsDir, file) {
  const fullPath = path.join(listsDir, file);
  if (!fs.existsSync(fullPath)) return null;
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
}

function buildListsBundle(listsDir) {
  const out = {};
  const missing = [];
  for (const entry of LIST_FILES) {
    const data = loadList(listsDir, entry.file);
    if (!data) {
      missing.push(entry.file);
      continue;
    }
    out[entry.key] = {
      name: data.name || entry.key,
      slotCount: typeof data.slotCount === 'number' ? data.slotCount : 54,
      slots: Array.isArray(data.slots) ? data.slots : []
    };
  }
  if (missing.length > 0) {
    console.warn('Missing list files (skipped): ' + missing.join(', '));
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

  // WIP filter: scan ALL list files (incl. hidden) to compute songKey →
  // listSet, then derive the WIP songKey set. Anything WIP is removed from
  // tracks / hybridSets / newReleaseSet so the public catalog never exposes
  // dev-only songs via TAG drills, search, or any other cross-list surface.
  // See HIDDEN_LISTS comment above + Plugin_WIP_Repository_Hidden_List_Filter
  // handoff for the design rationale.
  const songKeyToLists = buildSongKeyToLists(listsDir);
  const wipSongKeys = computeWipSongKeys(songKeyToLists, HIDDEN_LISTS);
  const wipTrackIds = computeWipTrackIds(songsRaw, wipSongKeys);

  const tracks = buildTracks(songsRaw, wipSongKeys);
  const lists = buildListsBundle(listsDir);
  const newReleaseSet = deriveNewReleaseSet(lists['New'])
    .filter(sk => !wipSongKeys.has(sk));
  const artists = deriveArtists(tracks);
  const stages = deriveStages(tracks);
  const hybridSets = filterHybridSets(songsRaw.hybridSets || {}, wipTrackIds);

  const catalog = {
    sourceVersion: 'plugin/_songs.json @ ' + (songsRaw.generatedAt || 'unknown'),
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    songCount: songsRaw.songCount,
    trackCount: tracks.length,
    tracks,
    lists,
    newReleaseSet,
    hybridSets,
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
  console.log('HybridSets: ' + Object.keys(catalog.hybridSets).length);
  console.log('WIP songs : ' + wipSongKeys.size + ' filtered (' + wipTrackIds.size + ' track variants)');
  console.log('Size      : ' + sizeBytes + ' bytes');
}

main();
