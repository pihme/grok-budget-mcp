# gh-pages source

This branch holds the static GitHub Pages site for `pihme/grok-budget-mcp`.

Generated on 2026-10-02 from `main` at commit `6b05cc3ff3c57930238937561c9f6c2645138c75`.
Self-contained `index.html`, `chronik/index.html` (Chronicles) `jigsaw/index.html` (family page, from `family.json`) and, where present, `namesake/index.html` (from `namesake-<repo>.json`), all with inline CSS, no build step, no trackers; plus favicons (`favicon.svg`, `favicon.png`, `apple-touch-icon.png`) and `.nojekyll`.
Generator: `gen.py` (layout B, sidebar handbook) + per-site content script + `chronik-<repo>.json` chronicle data + `family.json` project-family registry + `status-<repo>.json` (Current status; open issues and releases pulled live via `gh` at build time).
Regenerate when `main` changes; do not merge this branch into `main`.
