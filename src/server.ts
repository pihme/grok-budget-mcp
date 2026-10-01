import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type Deps, getBudget, getMonthlyCredits } from "./budget.js";
import { BudgetError } from "./errors.js";

export const SERVER_NAME = "grok-budget";
export const SERVER_VERSION = "0.1.0";

const GET_BUDGET_DESCRIPTION =
  "Return current Grok Build / SuperGrok weekly pool usage and reset time (same figure as the TUI `/usage`). " +
  "Top-level used_percent/remaining_percent are the overall pool (config.creditUsagePercent); `products` lists every " +
  "per-product row (e.g. GrokBuild) so you can pick the relevant one. period_end is the reset time. " +
  "Data comes from an UNOFFICIAL, undocumented endpoint; null fields plus `warning` mean partial data. Call it once " +
  "before expensive work; do not poll in a loop.";

const GET_MONTHLY_DESCRIPTION =
  "SECONDARY / optional: monthly credit units (monthly_limit, used, billing period) from the unofficial billing " +
  "endpoint without format=credits. This does NOT gate the weekly Grok Build limit; prefer get_budget.";

function ok(data: object): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

export function toolError(err: unknown): CallToolResult {
  const message =
    err instanceof BudgetError
      ? err.message
      : "Unexpected internal error in grok-budget-mcp."; // never echo unknown errors (could contain secrets)
  const code = err instanceof BudgetError ? err.code : "INTERNAL";
  return {
    isError: true,
    content: [{ type: "text", text: `Error [${code}]: ${message}` }],
  };
}

export function createServer(deps: Deps = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "get_budget",
    {
      title: "Grok weekly usage budget",
      description: GET_BUDGET_DESCRIPTION,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async () => {
      try {
        return ok(await getBudget(deps));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "get_monthly_credits",
    {
      title: "Grok monthly credit units (secondary)",
      description: GET_MONTHLY_DESCRIPTION,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async () => {
      try {
        return ok(await getMonthlyCredits(deps));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  return server;
}
