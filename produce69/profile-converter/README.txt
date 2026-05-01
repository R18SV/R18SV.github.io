Produce 69 - Profile Converter
==============================

What this is
------------
Converts legacy "My Favorites" data presets (.vap) from the older
Produce 69 plugin into the new .p69save profile format used by the
current plugin.

How to use
----------
1. Double-click index.html to open it in your browser. (No internet
   connection or installation needed - everything runs locally.)

2. Drag and drop your old "Preset_My Favorites_Data*.vap" file onto
   the drop zone (or click to browse and pick it).

3. Review the extracted track list shown on screen.

4. Click "Download .p69save" - your browser will save the new file
   as "produce69_profile_<today>.p69save".

5. Copy the downloaded file into:
     <your VAM folder>\Custom\Scripts\Shadow Venom\Produce 69\Saves\

6. Inside VAM, open the Produce 69 playlist UI and click slot 56
   (Profile Import). Pick the file you just saved. Your favorites
   should be restored.

Notes
-----
- The file produced by this converter contains only the "favorites"
  field. Any RECENT or MOST PLAYED data already in the plugin will
  NOT be overwritten - it is left as-is (partial-patch import).

- Track IDs that are not in your current song catalog will be
  silently skipped during display, but the data is preserved inside
  the .p69save file (in case the catalog changes later).

- Make sure you upload the *Data* preset, not the *UI* preset. The
  Data preset holds your track IDs; the UI preset only holds the
  buttons.

Privacy
-------
This tool is fully offline: your file never leaves your computer.
No upload, no server, no analytics.
