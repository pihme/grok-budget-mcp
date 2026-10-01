# grok-budget-mcp

A small, local **MCP server** (stdio) that lets a [Grok Build](https://docs.x.ai/build) CLI agent ask
*"how much of my SuperGrok / Grok Build weekly usage pool is left, and when does it reset?"* —
the same figure the interactive TUI shows under `/usage` (alias `/cost`).

Today an agent has no first-class way to get that number: `/usage` is TUI-only, `grok -p "/usage"` is
treated as a prompt, and the ACP `x.ai/billing` method is not exposed over `grok agent stdio`.
This server reads your existing `grok login` session and returns the figures as JSON.

> [!WARNING]
> **Unofficial, undocumented endpoint.** This server calls
> `https://cli-chat-proxy.grok.com/v1/billing?format=credits`, the private route the Grok Build CLI
> itself uses for `/usage`. It is **not** a public xAI API, has no stability guarantee, and xAI can change
> or remove it at any time. When the shape changes, this server fails loudly (error or `warning` + `null`
> fields) instead of guessing numbers.
>
> **Terms of service / risk.** Calling private product endpoints may conflict with xAI's terms.
> Use it only as a **personal, local helper** with your own account — not as a hosted or shared
> service. You are responsible for how you use it. This project is not affiliated with or endorsed by xAI.

## What it does

| Tool | Purpose |
| --- | --- |
| `get_budget` | **Primary.** Weekly pool usage (`config.creditUsagePercent`), per-product rows, reset time, Extra Usage (on-demand) cap/used. |
| `get_monthly_credits` | **Secondary / optional.** Monthly credit units from `GET /v1/billing` (no `format`). Does **not** gate the weekly Build limit. |

Both tools take no input. Each call re-reads `auth.json` and makes **exactly one** HTTPS request
(15 s timeout, no retries, no caching).

### `get_budget` output

All fields are always present; anything the endpoint did not return is `null` and explained in `warning`.

| Field | Meaning |
| --- | --- |
| `used_percent` | Overall-pool used percent (`config.creditUsagePercent`) — same polarity as the TUI "Weekly limit" |
| `remaining_percent` | `100 - used_percent`, clamped to `[0, 100]` |
| `products` | **Every** `config.productUsage[]` row as `{ product, used_percent, remaining_percent }` (the agent picks the relevant product, e.g. `GrokBuild`) |
| `period_type` | e.g. `USAGE_PERIOD_TYPE_WEEKLY` |
| `period_start` / `period_end` | `currentPeriod.start` / `.end` (fallback `billingPeriodStart` / `billingPeriodEnd`); `period_end` is the reset time |
| `on_demand_cap` / `on_demand_used` | `onDemandCap.val` / `onDemandUsed.val` (Extra Usage / pay-as-you-go) |
| `source` | always `"cli-chat-proxy:/v1/billing?format=credits"` |
| `fetched_at` | ISO-8601 time of the fetch |
| `warning` | Human note when data is partial or the shape looks different; `null` when everything was present |

Example (illustrative values):

```json
{
  "used_percent": 42.5,
  "remaining_percent": 57.5,
  "products": [
    { "product": "GrokBuild", "used_percent": 61.25, "remaining_percent": 38.75 },
    { "product": "GrokChat", "used_percent": 7, "remaining_percent": 93 }
  ],
  "period_type": "USAGE_PERIOD_TYPE_WEEKLY",
  "period_start": "2026-09-28T01:53:09.930537+00:00",
  "period_end": "2026-10-05T01:53:09.930537+00:00",
  "on_demand_cap": 2500,
  "on_demand_used": 120,
  "source": "cli-chat-proxy:/v1/billing?format=credits",
  "fetched_at": "2026-10-01T19:00:00.000Z",
  "warning": null
}
```

Mapping rules: numbers are never invented. If `creditUsagePercent` is omitted but a complete current
period is present, it is reported as `0` (proto3 JSON omits zero values) **with a warning**. A product row
without `usagePercent` is reported with `null` percents and a warning. A response with only monthly fields
is **not** relabelled as weekly. If neither usage nor a period can be parsed, the tool returns an error.

### Errors

Errors are returned as MCP tool errors (`isError: true`) with a code and a readable message:

| Situation | Message |
| --- | --- |
| `auth.json` missing / unreadable | `NOT_LOGGED_IN` — not logged in; run `grok login` |
| No `grok login` (OIDC) entry / no `key` | `AUTH_SHAPE_UNEXPECTED` — run `grok login` |
| `expires_at` is in the past | `SESSION_EXPIRED` — session expired; run `grok login` (no request is made) |
| HTTP 401 / 403 | `UNAUTHORIZED` — billing unauthorized; run `grok login` |
| HTTP 429 | `RATE_LIMITED` — retry later; do not call in a loop |
| HTTP 5xx / other / network / timeout | `REQUEST_FAILED` — includes the HTTP status if any |
| 200 but unparseable / no usage and no period | `SHAPE_CHANGED` — billing response shape changed |

## Token handling (read-only)

- Reads `$GROK_HOME/auth.json` if `GROK_HOME` is set, else `~/.grok/auth.json` — the file written by
  `grok login`.
- Picks the OIDC / `grok login` entry (preferring issuer `https://auth.x.ai`, ignoring bare API-key entries)
  and uses its **`key`** field as the Bearer token; `expires_at` is checked locally.
- **Never refreshes** the token, **never writes** `auth.json`, never calls an auth endpoint. If the session is
  expired or rejected, it tells you to run `grok login` (or simply use the Grok CLI, which refreshes its own session).
- Never logs, prints or returns the token, the Authorization header, or the raw upstream body.
- No secrets go into MCP config `env`.

Request sent (once per tool call):

```http
GET https://cli-chat-proxy.grok.com/v1/billing?format=credits
Authorization: Bearer <key from auth.json>
X-XAI-Token-Auth: xai-grok-cli
Accept: application/json
```

The base URL can be overridden with `GROK_CLI_CHAT_PROXY_BASE_URL` (same variable the Grok CLI honours, e.g.
`https://grok-proxy.example.com/v1`); the server then calls `<base>/billing?format=credits`.

## Install / build

Requires Node.js 18.18+ (20+ recommended).

```bash
git clone https://github.com/pihme/grok-budget-mcp.git
cd grok-budget-mcp
npm install        # also builds dist/ via the prepare script
npm run build      # tsc -> dist/
npm test           # unit + stdio smoke tests (mocked fetch, fixture auth files)
npm run smoke      # optional: start the server over stdio, list tools, call get_budget once with YOUR session
```

Optionally put the `grok-budget-mcp` binary on your PATH with `npm link` (or
`npm install -g github:pihme/grok-budget-mcp`).

## Wiring into Grok Build

Via the CLI (everything after `--` is the server command):

```bash
grok mcp add grok-budget -- node /path/to/grok-budget-mcp/dist/index.js
# or, after `npm link`:
grok mcp add grok-budget -- grok-budget-mcp
```

Or directly in `~/.grok/config.toml`:

```toml
[mcp_servers.grok-budget]
command = "node"
args = ["/path/to/grok-budget-mcp/dist/index.js"]
startup_timeout_sec = 15
tool_timeout_sec = 30
```

Then check it with `grok mcp doctor grok-budget` and `/mcps` in the TUI. The tools appear as
`grok-budget__get_budget` and `grok-budget__get_monthly_credits`. User scope is enough; no `env` is needed.
See the official [Grok Build MCP docs](https://docs.x.ai/build/features/mcp-servers).

A good agent instruction: *"Before starting long or expensive work, call `grok-budget__get_budget` once; if
`remaining_percent` (or the `GrokBuild` product's) is low, tell me and ask before continuing."*

## Not covered

- Not the Management API / console prepaid balance, and not per-request `cost_in_usd_ticks` — those are
  different ledgers.
- No Auto Top Up management, no grok.com scraping, no caching.

## Background

Design notes and the research behind this server: spec concept
[`wiki/grok-budget-mcp.md` in pihme/ideengarten](https://github.com/pihme/ideengarten/blob/main/wiki/grok-budget-mcp.md)
(private notes repo). Community prior art that documents the endpoint and the `auth.json` shape (not endorsements):
[SergioComeron/GrokUsageBar](https://github.com/SergioComeron/GrokUsageBar),
[marcelocantos/claudia `docs/grok-usage-billing.md`](https://github.com/marcelocantos/claudia/blob/master/docs/grok-usage-billing.md),
[robinebers/openusage](https://github.com/robinebers/openusage/blob/main/docs/providers/grok.md),
[ColumbusLabs/QuotaKit](https://github.com/ColumbusLabs/QuotaKit/blob/main/docs/grok.md).

## License

[MIT](LICENSE) © 2026 Peter Ihme
