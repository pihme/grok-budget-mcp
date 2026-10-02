# AGENTS.md

This file is for the coding agent working in this repo. Read it at the start of a session.

## What this repo is

**grok-budget-mcp** is a small local MCP server (stdio) that gives a Grok Build CLI agent the weekly usage figure the TUI shows under `/usage`. Spec and decisions: `SPEC.md`. User docs: `README.md`.

License: **MIT** (`LICENSE`). Personal helper, not affiliated with xAI.

## How to work here

- TypeScript on Node, ESM, official MCP SDK (`@modelcontextprotocol/sdk`) as the only runtime dependency. Keep it that way; ask before adding a dependency.
- Layout: `src/index.ts` (stdio entry), `src/server.ts` (tool registration, error mapping), `src/budget.ts` (one call = read auth, one request, map), `src/auth.ts` (read-only `auth.json`), `src/billing.ts` (HTTP client and field mapping), `src/errors.ts` (error codes), `test/` (`node:test`, mocked fetch, synthetic fixtures in `test/fixtures/`), `scripts/smoke.mjs` (manual check with a real session).
- **Token handling is read-only** (SPEC Q3, do not reopen): read `key` and `expires_at` only; never refresh, never write `auth.json`, never call an auth endpoint. Never log, print or return the token, the `Authorization` header, the raw upstream body, or OS error text (it can contain local paths). stdout is the MCP channel; diagnostics go to stderr.
- One HTTPS request per tool call. No retries, no caching, no polling.
- **Never invent numbers.** Missing fields are `null` plus `warning`; nothing usable is `SHAPE_CHANGED`. Do not report monthly fields as weekly.
- Error codes in `src/errors.ts` match the error tables in `README.md` and `SPEC.md`; change them together.
- The endpoint is unofficial. Keep the README warning and say "unofficial" wherever the endpoint is described.
- Tests stay offline. Do not run `npm run smoke` or call the real billing endpoint as the agent: it uses the maintainer's real `grok login` session. Never commit `auth.json`, tokens or real billing responses.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `perf:`, `feat!:` or a `BREAKING CHANGE:` footer, `docs:`, `test:`, `chore:`, `ci:`. There is no release automation and no release yet; do not tag or publish by hand. The version lives in `package.json` and is repeated in `src/server.ts` and the User-Agent in `src/billing.ts` (issue #2).
- **Dependabot** (`.github/dependabot.yml`): runtime deps `fix(deps):`, dev deps `chore(deps-dev):`, GitHub Actions `ci(deps):`. Merge its PRs only with green CI; merge them (squash, keep the Dependabot prefix) once CI is green.
- **CI:** the workflow is not on GitHub yet (the token lacks the `workflow` scope). Never commit anything under `.github/workflows/`.
- **Changes on main:** keep them small; `npm test` must pass; CI runs Node 22 and 24. Supported: Node.js 22+ (`engines`); `@types/node` stays on the oldest supported major (^22).
- Outside pull requests: not decided yet (see `CONTRIBUTING.md`); issues are welcome.
- Website: <https://pihme.github.io/grok-budget-mcp/>, generated onto the `gh-pages` branch from outside this repo. Do not edit `gh-pages` by hand.

## Do not invent

- Token refresh, writing `auth.json`, or another auth path (API keys, Management API)
- Caching, polling or background refresh
- grok.com scraping, Auto Top Up management (out of scope in SPEC)
- Claims that the endpoint is an official or stable xAI API
