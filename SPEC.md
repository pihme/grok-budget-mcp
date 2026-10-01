# Grok Build budget MCP server — design spec

**Status:** design specification — implemented in this repository (see [README](README.md)).  
**Date:** 2026-10-01  
**Audience:** Grok Build CLI agents that need to know remaining SuperGrok / Grok Build usage before starting expensive work.

This is the design spec for the small local MCP server implemented in this repository. It is a personal helper, not an official xAI product.

## Goal

Give the Grok Build CLI agent a **single MCP tool** that returns the same weekly usage figure the interactive TUI shows under `/usage` (alias `/cost`): how much of the shared weekly pool is used, how much remains, and when the window resets.

Today the agent has no first-class way to ask that question. `/usage` is TUI-only; `grok -p "/usage"` is treated as a model prompt, not a slash command; and the ACP method `x.ai/billing` is pager-internal (returns “Method not found” over `grok agent stdio`).

## Research (as of 2026-10-01)

### Official programmatic API for SuperGrok / Grok Build weekly budget?

**No.** Searched xAI docs, Grok Build user guide, and community write-ups. Findings:

| Surface | What it covers | Programmatic for weekly Build budget? |
| --- | --- | --- |
| TUI `/usage` / `/cost` | Weekly limit %, next reset, Extra Credits, Auto Top Up | No — interactive only |
| ACP `x.ai/billing` | Same data for the pager | No — not exposed on agent stdio |
| Public inference API (`api.x.ai`) | Per-request `cost_in_usd_ticks` | No — not a subscription pool |
| Management API (`management-api.x.ai`) | API **team** prepaid / invoices | No — different ledger; needs management key |

Sources: [claudia `docs/grok-usage-billing.md`](https://github.com/marcelocantos/claudia/blob/master/docs/grok-usage-billing.md) (research notes, 2026-08), [xAI cost tracking](https://docs.x.ai/developers/cost-tracking), [xAI MCP servers](https://docs.x.ai/build/features/mcp-servers), QuotaKit / OpenUsage / GrokUsageBar community docs.

### Undocumented endpoint the community (and the CLI itself) uses

The Grok Build CLI and several community tools call:

```http
GET https://cli-chat-proxy.grok.com/v1/billing?format=credits
Authorization: Bearer <token from ~/.grok/auth.json>
X-XAI-Token-Auth: xai-grok-cli
Accept: application/json
```

Useful response fields under `config` (names only; shape is not a public contract):

- `creditUsagePercent` — **used** percent of the weekly pool (same polarity as `/usage` “Weekly limit”)
- `currentPeriod.start` / `currentPeriod.end` — rolling window; `end` is the reset time
- `currentPeriod.type` — e.g. `USAGE_PERIOD_TYPE_WEEKLY`
- `productUsage[]` — per-product rows; look for `product == "GrokBuild"` and its `usagePercent`
- `onDemandCap` / `onDemandUsed` — Extra Usage / pay-as-you-go (often `{ "val": … }`)
- `billingPeriodStart` / `billingPeriodEnd` — fallbacks when `currentPeriod` is absent

Without `?format=credits`:

```http
GET https://cli-chat-proxy.grok.com/v1/billing
```

returns monthly credit **units** (`monthlyLimit`, `used`, history) — secondary; not what gates the weekly Build limit.

Optional companion (plan label):

```http
GET https://cli-chat-proxy.grok.com/v1/settings
```

→ `subscription_tier_display` when present.

Community references (not endorsements):

- [SergioComeron/GrokUsageBar](https://github.com/SergioComeron/GrokUsageBar)
- [marcelocantos/claudia `docs/grok-usage-billing.md`](https://github.com/marcelocantos/claudia/blob/master/docs/grok-usage-billing.md)
- [robinebers/openusage](https://github.com/robinebers/openusage/blob/main/docs/providers/grok.md) and [ColumbusLabs/QuotaKit](https://github.com/ColumbusLabs/QuotaKit/blob/main/docs/grok.md) (and similar usage-bar / agent-usage providers)
- Upstream CLI wiring visible in [xai-org/grok-build `billing.rs`](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/extensions/billing.rs) (pager → same proxy)

**Polarity:** remaining percent = `100 - creditUsagePercent`. Verified in community notes against the TUI (“Weekly limit left: 0%” when `creditUsagePercent` is 100).

## Proposed MCP tools

Server name in config: `grok-budget` (tools appear as `grok-budget__…`).

Prefer **one primary tool**. A second tool is optional for monthly units.

### Tool 1: `get_budget` (required)

**Description:** Return current Grok Build / SuperGrok weekly pool usage and reset time (same figure as TUI `/usage`).

**Input:** none (or empty object). No account selectors in v1.

**Output (JSON object, all fields always present or explicitly null):**

| Field | Type | Meaning |
| --- | --- | --- |
| `used_percent` | number \| null | Overall-pool used percent from `config.creditUsagePercent` |
| `remaining_percent` | number \| null | `100 - used_percent`, clamped to `[0, 100]` |
| `products` | array | One entry per `config.productUsage[]` row: `{ product, used_percent, remaining_percent }`; `remaining_percent` is `100 - used_percent`, clamped to `[0, 100]`, and is null when the product usage percent is missing |
| `period_type` | string \| null | e.g. `USAGE_PERIOD_TYPE_WEEKLY` |
| `period_start` | string \| null | ISO-8601 from `currentPeriod.start` |
| `period_end` | string \| null | ISO-8601 reset time (`currentPeriod.end`, else `billingPeriodEnd`) |
| `on_demand_cap` | number \| null | from `onDemandCap.val` if present |
| `on_demand_used` | number \| null | from `onDemandUsed.val` if present |
| `source` | string | always `"cli-chat-proxy:/v1/billing?format=credits"` |
| `fetched_at` | string | ISO-8601 when this server fetched the data |
| `warning` | string \| null | human note if data is partial, shape changed, or endpoint is unofficial |

Do **not** return raw tokens, auth file paths with secrets, or the full upstream body by default.

### Tool 2: `get_monthly_credits` (optional, secondary)

Same auth path; calls `GET …/v1/billing` **without** `format=credits`. Returns `monthly_limit`, `used`, `billing_period_start`, `billing_period_end` from `config`. Mark clearly as secondary (does not gate the weekly Build limit).

## Data source

1. Resolve auth file: `$GROK_HOME/auth.json` if `GROK_HOME` is set, else `~/.grok/auth.json`.
2. Select the OIDC / `grok login` entry (not a bare API key). Community tools treat the bearer as the entry’s **`key`** field (not `access_token`); read its `expires_at` for the expiration check. Do not refresh or modify the entry.
3. Call `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` with:
   - `Authorization: Bearer <key>`
   - `X-XAI-Token-Auth: xai-grok-cli`
   - `Accept: application/json`
4. Map fields as above, including every `config.productUsage[]` row in `products`; the agent picks which product is relevant. Treat absent numeric scalars as 0 only when the rest of the period is present (proto3 JSON may omit zeros); if neither usage nor period can be parsed, fail with an error — never invent a percent.

Base URL override: if the environment sets `GROK_CLI_CHAT_PROXY_BASE_URL`, use that host’s `/billing?format=credits` instead of the default (enterprise proxy setups).

## Token handling (read-only)

**Decision for v1:** do not refresh the token and do not write `auth.json`. Read the existing credentials only; if the token is expired or rejected, return a clear MCP tool error telling the user to run `grok login`.

Auth file fields used by name only (never log values):

- `key` — access token used as Bearer
- `expires_at` — expiration time used for the local check

Flow:

1. Read `key` and `expires_at` from the selected auth entry.
2. If `expires_at` is in the past, return a clear MCP tool error: session expired; run `grok login`.
3. Otherwise make the billing request once with the existing `key`.
4. If the billing call returns 401/403, return a clear MCP tool error: billing unauthorized; run `grok login`.

The server never calls a refresh endpoint, writes `auth.json`, or retries the billing request. There is no retry loop.

## Error cases

| Situation | Tool result |
| --- | --- |
| Auth file missing / unreadable | Error: not logged in; run `grok login` |
| No suitable OIDC entry / no `key` | Error: auth shape unexpected; run `grok login` |
| Token expired (`expires_at` is in the past) | Error: session expired; run `grok login` |
| HTTP 401/403 | Error: billing unauthorized; run `grok login` |
| HTTP 5xx / network / timeout | Error: billing request failed (include status if any) |
| 200 but unparseable / missing usage **and** period | Error: billing response shape changed |
| Only monthly endpoint available (no weekly fields) | For `get_budget`: error or `warning` + null percents — do not silently report monthly as weekly |
| Rate limited | Error: retry later; do not hammer |

Timeouts: ~10–15 s for billing. Do not retry.

## Risks

1. **Unofficial.** The `cli-chat-proxy` billing route is not a documented public API. xAI can change path, headers, or JSON at any time. The server must fail loud with `warning` / error, never fabricate usage.
2. **Token safety.** The MCP process reads `~/.grok/auth.json`. Never print, log, or return `key` or Authorization headers. Redact in any debug mode. Do not commit auth files or paste them into chats.
3. **Shared session.** Read-only token handling avoids corrupting the CLI session; the server never refreshes or writes the auth file used by Grok Build.
4. **Wrong ledger.** Do not confuse this with the Management API prepaid balance or with per-request `cost_in_usd_ticks`. Those answer different questions.
5. **Policy / ToS.** Scraping private product endpoints may violate terms; keep this as a personal local helper, not a distributed SaaS.
6. **Stale cache.** If a future implementation caches results, cache briefly (tens of seconds) and always expose `fetched_at`.

## Wiring into `~/.grok/config.toml`

Stdio MCP server: TypeScript on Node using the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`), with minimal dependencies. Example once built:

```toml
[mcp_servers.grok-budget]
command = "node"
args = ["/path/to/grok-budget-mcp/dist/index.js"]
enabled = true
startup_timeout_sec = 15
tool_timeout_sec = 30
```

Or via CLI:

```bash
grok mcp add grok-budget -- node /path/to/grok-budget-mcp/dist/index.js
```

Notes:

- No secrets in `env` — the server reads `$GROK_HOME/auth.json` / `~/.grok/auth.json` itself.
- User scope (`~/.grok/config.toml`) is enough; project scope is optional.
- After adding: `grok mcp doctor grok-budget` and `/mcps` in the TUI.
- Official MCP docs: [docs.x.ai/build/features/mcp-servers](https://docs.x.ai/build/features/mcp-servers).

## Out of scope (this spec)

- Auto Top Up rule management (`/auto-topup-rule`).
- Management API / console prepaid.
- Scraping grok.com gRPC-web as a primary path (optional later fallback only).
- Changing Grok Build itself or requesting an official `grok usage --json`.

## Decisions (2026-10-01)

- **Q1 — Percentages:** `get_budget` returns all percentages per product. Top-level `used_percent` and `remaining_percent` come from `config.creditUsagePercent` (the overall pool), and `products` contains one `{ product, used_percent, remaining_percent }` entry for every `config.productUsage[]` row. The agent picks which product is relevant; there is no single `product` field or preference for GrokBuild.
- **Q2 — Stack:** TypeScript on Node using the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`), stdio transport, and minimal dependencies. The config wiring uses `node` to run the built `dist/index.js` entry point.
- **Q3 — Refresh:** v1 does not refresh the token or write `auth.json`. It reads `key` and `expires_at`; an expired token or billing 401/403 produces a clear error telling the user to run `grok login`, with no retry loop.
