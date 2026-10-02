# AGENTS.md

This file is for the coding agent working in this repo. Read it at the start of a session.

## What this repo is

**grok-budget-mcp** is a small local MCP server (stdio) that gives a Grok Build CLI agent the weekly usage figure the TUI shows under `/usage`. Spec and decisions: `SPEC.md`. User docs: `README.md`.

License: **MIT** (`LICENSE`). Personal helper, not affiliated with xAI.

## How to work here

- TypeScript on Node, ESM, official MCP SDK (`@modelcontextprotocol/sdk`) as the only runtime dependency. Keep it that way; ask before adding a dependency.
- Layout: `src/index.ts` (stdio entry), `src/server.ts` (tool registration, error mapping), `src/budget.ts` (one call = read auth, one request, map), `src/auth.ts` (read-only `auth.json`), `src/billing.ts` (HTTP client and field mapping), `src/errors.ts` (error codes), `src/version.ts` (version read from `package.json` at runtime), `test/` (`node:test`, mocked fetch, synthetic fixtures in `test/fixtures/`), `scripts/smoke.mjs` (manual check with a real session).
- **Token handling is read-only** (SPEC Q3, do not reopen): read `key` and `expires_at` only; never refresh, never write `auth.json`, never call an auth endpoint. Never log, print or return the token, the `Authorization` header, the raw upstream body, or OS error text (it can contain local paths). stdout is the MCP channel; diagnostics go to stderr.
- One HTTPS request per tool call. No retries, no caching, no polling.
- **Never invent numbers.** Missing fields are `null` plus `warning`; nothing usable is `SHAPE_CHANGED`. Do not report monthly fields as weekly.
- Error codes in `src/errors.ts` match the error tables in `README.md` and `SPEC.md`; change them together.
- The endpoint is unofficial. Keep the README warning and say "unofficial" wherever the endpoint is described.
- Tests stay offline. Do not run `npm run smoke` or call the real billing endpoint as the agent: it uses the maintainer's real `grok login` session. Never commit `auth.json`, tokens or real billing responses.
- **Versions:** one artifact, tag `grok-budget-mcp/vX.Y.Z`. [Conventional Commits](https://www.conventionalcommits.org/): `feat:` minor, `fix:`/`perf:` patch, `feat!:`/`fix!:` or a `BREAKING CHANGE:` footer major (minor while the version is 0.x); `docs:`, `test:`, `chore:`, `ci:` do not bump. A commit only bumps when it touches `src/`, `package.json`, `package-lock.json` or `tsconfig.json`. After CI on a push to `main`, `.github/scripts/release.py` writes the version into `package.json` (commit `chore(release): grok-budget-mcp vX.Y.Z` by github-actions, skipped by CI), creates the GitHub Release and attaches the `npm pack` tarball. Never tag, bump `package.json` or publish by hand; nothing goes to npm. Pull before committing after a release. The version is read from `package.json` at runtime (`src/version.ts`); do not hardcode it.
- **Commit messages:** never write the literal skip-CI token (`[skip ci]` and its variants) in a commit message, not even quoted: GitHub then skips CI and no release is cut.
- **Dependabot** (`.github/dependabot.yml`): runtime deps `fix(deps):` (patch release), dev deps `chore(deps-dev):`, GitHub Actions `ci(deps):`. `@types/node` stays on ^22 (major updates ignored). Merge its PRs (squash, keep the Dependabot title) only with green CI; if a PR conflicts, comment `@dependabot rebase`.
- **CI:** `.github/workflows/ci.yml`: build and test on Node 22 and 24 for pushes and pull requests, then the release job on `main`.
- **Changes on main:** keep them small; `npm test` must pass; CI runs Node 22 and 24. Supported: Node.js 22+ (`engines`); `@types/node` stays on the oldest supported major (^22).
- Outside pull requests are welcome under MIT (see `CONTRIBUTING.md` and `.github/pull_request_template.md`); squash-merge them with a Conventional Commit title.
- Website: <https://pihme.github.io/grok-budget-mcp/>, generated onto the `gh-pages` branch from outside this repo. Do not edit `gh-pages` by hand.

## Do not invent

- Token refresh, writing `auth.json`, or another auth path (API keys, Management API)
- Caching, polling or background refresh
- grok.com scraping, Auto Top Up management (out of scope in SPEC)
- Claims that the endpoint is an official or stable xAI API
