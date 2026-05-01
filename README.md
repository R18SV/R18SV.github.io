# Shadow Venom

Hub site for Shadow Venom's independent game projects and their companion tools.

Hosted via GitHub Pages.

## Projects

- **Produce 69** — `/produce69/` — companion tools: profile converter, online profile editor. _In development._
- **Casino 69** — `/casino69/` — _placeholder; companion content TBD._

Future projects added under their own subroute.

## Tech stack

Pure static HTML + JavaScript. No build step, no backend. Per-project pages live under their own folder.

## Design principle: tools must work offline

Every tool under a project folder (e.g. `/produce69/profile-converter/`) is built so that the folder can be zipped, shipped to a user, and run by double-clicking `index.html` — no installation, no server, no internet required.

Concretely this means each tool's `index.html`:
- inlines all HTML, CSS, and JS (no external `<link>` or `<script src>`)
- depends on system fonts only (no fetched webfonts)
- makes zero network calls (uses only browser-local APIs like File API)
- gracefully hides any cross-folder navigation (breadcrumbs, back-links) when run via `file://`
- ships a plain `README.txt` next to it for users who unzip and look around

Hub pages (`/index.html`, `/produce69/index.html`) are online-only — they exist for navigation between tools and are not meant to be distributed standalone.

## Local dev

Open `index.html` directly in a browser, or serve via any static file server:

    python -m http.server 8000

then visit `http://localhost:8000`.

## License

TBD
