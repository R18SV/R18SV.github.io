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

// Stage display alias map — mirrors the plugin's `_stageDisplayAlias`
// (src/PlaylistController.cs). Several technical stage names that the
// preset-loader uses internally should consolidate under a single
// display label for the BY STAGE drill list. The plugin applies this
// at the UI layer at runtime; the slim public catalog applies it at
// build time so the web editor's stage list matches the in-game UI
// (34 distinct entries) and the i18n `stages` overlay (which is keyed
// by display aliases) resolves correctly.
//
// Keep in sync with:
//   - Custom/Scripts/Shadow Venom/Produce 69/STAGE_DISPLAY_ALIAS_NOTE.md
//   - PlaylistController.cs `_stageDisplayAlias`
const STAGE_DISPLAY_ALIAS = {
  'SP 01 Stage':       'Multi Stage',
  'SP 02 Stage':       'Multi Stage',
  'SP 03 Stage':       'Multi Stage',
  'Oriental Stage 01': 'Oriental Stage',
  'Oriental Stage 06': 'Oriental Stage'
};

function resolveStageDisplay(s) {
  return STAGE_DISPLAY_ALIAS[s] || s;
}

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

function buildTracks(songsRaw) {
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
  const tracks = buildTracks(songsRaw);
  const lists = buildListsBundle(listsDir);
  const newReleaseSet = deriveNewReleaseSet(lists['New']);
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
    hybridSets: songsRaw.hybridSets || {},
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
  console.log('Size      : ' + sizeBytes + ' bytes');
}

main();
