# Shadow Venom

Hub site for Shadow Venom's independent game projects and their companion tools.

Hosted via GitHub Pages.

## Projects

- **Produce 69** — `/produce69/` — companion tools: profile converter, online profile editor. _In development._
- **Casino 69** — `/casino69/` — _placeholder; companion content TBD._

Future projects added under their own subroute.

## Tech stack

Pure static HTML + JavaScript. No build step, no backend. Per-project pages live under their own folder.

Standalone offline zips of individual tools are a future port, not a current constraint — functional parity is the goal there, not pixel parity. Build for online first; trim for offline later when the need arrives.

## Local dev

Open `index.html` directly in a browser, or serve via any static file server:

    python -m http.server 8000

then visit `http://localhost:8000`.

## License

TBD
