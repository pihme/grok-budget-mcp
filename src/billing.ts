import { BudgetError, LOGIN_HINT } from "./errors.js";
import { VERSION } from "./version.js";

/**
 * Client + field mapping for the UNOFFICIAL cli-chat-proxy billing endpoint the
 * Grok Build CLI uses for `/usage`. The response shape is not a public contract:
 * this module maps by field name, never invents numbers, and reports partial
 * data via `warning` (or fails loudly when nothing usable is present).
 */

export const DEFAULT_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
export const DEFAULT_TIMEOUT_MS = 15_000;
export const CREDITS_SOURCE = "cli-chat-proxy:/v1/billing?format=credits";
export const MONTHLY_SOURCE = "cli-chat-proxy:/v1/billing";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProductUsage {
  product: string | null;
  used_percent: number | null;
  remaining_percent: number | null;
}

export interface BudgetResult {
  used_percent: number | null;
  remaining_percent: number | null;
  products: ProductUsage[];
  period_type: string | null;
  period_start: string | null;
  period_end: string | null;
  on_demand_cap: number | null;
  on_demand_used: number | null;
  source: string;
  fetched_at: string;
  warning: string | null;
}

export interface MonthlyResult {
  monthly_limit: number | null;
  used: number | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  source: string;
  fetched_at: string;
  secondary: true;
  note: string;
  warning: string | null;
}

/** `GROK_CLI_CHAT_PROXY_BASE_URL` (same variable the Grok CLI honours), e.g. https://proxy.example.com/v1 */
export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.GROK_CLI_CHAT_PROXY_BASE_URL?.trim();
  return (raw && raw.length > 0 ? raw : DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export interface RequestOptions {
  baseUrl: string;
  key: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Single GET against `<base>/billing[?format=credits]`. No retries.
 * Returns the parsed JSON body.
 */
export async function requestBilling(
  path: "/billing?format=credits" | "/billing",
  opts: RequestOptions,
): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchImpl(`${opts.baseUrl}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${opts.key}`,
        "X-XAI-Token-Auth": "xai-grok-cli",
        Accept: "application/json",
        "User-Agent": `grok-budget-mcp/${VERSION}`,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new BudgetError(
        "REQUEST_FAILED",
        `Billing request failed: timed out after ${Math.round(timeoutMs / 1000)}s.`,
      );
    }
    const reason = err instanceof Error ? describeNetworkError(err) : "network error";
    throw new BudgetError("REQUEST_FAILED", `Billing request failed: ${reason}.`);
  }

  try {
    const status = res.status;
    if (status === 401 || status === 403) {
      throw new BudgetError(
        "UNAUTHORIZED",
        `Billing unauthorized (HTTP ${status}): the session is expired or was rejected. ${LOGIN_HINT}`,
        status,
      );
    }
    if (status === 429) {
      throw new BudgetError(
        "RATE_LIMITED",
        "Billing endpoint rate limited this request (HTTP 429). Retry later; do not call in a loop.",
        status,
      );
    }
    if (status < 200 || status > 299) {
      throw new BudgetError("REQUEST_FAILED", `Billing request failed (HTTP ${status}).`, status);
    }

    let text: string;
    try {
      text = await res.text();
    } catch {
      if (controller.signal.aborted) {
        throw new BudgetError(
          "REQUEST_FAILED",
          `Billing request failed: timed out after ${Math.round(timeoutMs / 1000)}s.`,
        );
      }
      throw new BudgetError("REQUEST_FAILED", "Billing request failed: could not read response body.");
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new BudgetError("SHAPE_CHANGED", "Billing response shape changed: body is not valid JSON.");
    }
  } finally {
    clearTimeout(timer);
  }
}

function describeNetworkError(err: Error): string {
  // undici puts the useful part (ENOTFOUND, ECONNREFUSED...) in `cause`.
  const cause = (err as { cause?: { code?: unknown } }).cause;
  const code = cause && typeof cause.code === "string" ? cause.code : null;
  return code ? `network error (${code})` : "network error";
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function isObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Finite number, or a numeric string (proto3 JSON encodes int64 as strings). */
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** `{ "val": 123 }` money/units wrapper used by the proxy. Also accepts a bare number. */
function val(v: unknown): number | null {
  if (isObject(v)) return num(v.val);
  return num(v);
}

function isoString(v: unknown): string | null {
  return typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function remaining(used: number | null): number | null {
  if (used === null) return null;
  const r = Math.min(100, Math.max(0, 100 - used));
  return Math.round(r * 1e6) / 1e6;
}

const KNOWN_CONFIG_KEYS = [
  "creditUsagePercent",
  "currentPeriod",
  "productUsage",
  "onDemandCap",
  "onDemandUsed",
  "billingPeriodStart",
  "billingPeriodEnd",
  "monthlyLimit",
  "used",
];

/** Return `body.config`, or the body itself if it looks like an un-wrapped config. */
function extractConfig(body: unknown): Obj | null {
  if (!isObject(body)) return null;
  if (isObject(body.config)) return body.config;
  if (KNOWN_CONFIG_KEYS.some((k) => k in body)) return body;
  return null;
}

/**
 * Map a `GET /v1/billing?format=credits` body to the `get_budget` result.
 * Throws SHAPE_CHANGED when neither usage nor period can be parsed.
 */
export function mapCredits(body: unknown, fetchedAt: Date = new Date()): BudgetResult {
  const config = extractConfig(body);
  if (!config) {
    throw new BudgetError(
      "SHAPE_CHANGED",
      "Billing response shape changed: no `config` object in the response.",
    );
  }
  const notes: string[] = [];
  const missing: string[] = [];

  // --- period -------------------------------------------------------------
  const cp = isObject(config.currentPeriod) ? config.currentPeriod : null;
  const cpStart = cp ? isoString(cp.start) : null;
  const cpEnd = cp ? isoString(cp.end) : null;
  const periodType = cp ? str(cp.type) : null;
  const periodStart = cpStart ?? isoString(config.billingPeriodStart);
  const periodEnd = cpEnd ?? isoString(config.billingPeriodEnd);

  if (!cp) {
    missing.push("currentPeriod");
    if (periodStart || periodEnd) notes.push("period taken from billingPeriodStart/End fallback");
  } else {
    if (!periodType) missing.push("currentPeriod.type");
    if (!cpStart) missing.push("currentPeriod.start");
    if (!cpEnd) missing.push("currentPeriod.end");
  }
  if (!periodEnd) missing.push("reset time (currentPeriod.end / billingPeriodEnd)");
  if (periodType && periodType !== "USAGE_PERIOD_TYPE_WEEKLY") {
    notes.push(`period type is ${periodType}, not weekly`);
  }

  // A real weekly window: what makes "omitted percent == 0" (proto3) plausible.
  const fullWeeklyPeriod = cp !== null && cpStart !== null && cpEnd !== null;
  const monthlyShaped =
    !("creditUsagePercent" in config) &&
    !("productUsage" in config) &&
    ("monthlyLimit" in config || "used" in config);

  // --- overall usage --------------------------------------------------------
  let used = num(config.creditUsagePercent);
  if (used === null) {
    if (config.creditUsagePercent === undefined && fullWeeklyPeriod && !monthlyShaped) {
      used = 0;
      notes.push(
        "creditUsagePercent omitted with a current period present; reported as 0 (proto3 JSON omits zero values)",
      );
    } else if (config.creditUsagePercent !== undefined) {
      notes.push("creditUsagePercent is not a number");
    } else {
      missing.push("creditUsagePercent");
    }
  }
  if (monthlyShaped) {
    notes.push(
      "response only contains monthly fields (monthlyLimit/used); not reporting them as weekly percentages, see get_monthly_credits",
    );
  }

  // --- products -------------------------------------------------------------
  const products: ProductUsage[] = [];
  const productsWithoutPercent: string[] = [];
  if (Array.isArray(config.productUsage)) {
    for (const row of config.productUsage) {
      if (!isObject(row)) {
        notes.push("productUsage contains a non-object row (skipped)");
        continue;
      }
      const product = str(row.product);
      const p = num(row.usagePercent);
      if (p === null) productsWithoutPercent.push(product ?? "(unnamed)");
      products.push({ product, used_percent: p, remaining_percent: remaining(p) });
    }
    if (productsWithoutPercent.length > 0) {
      notes.push(
        `no usagePercent for product(s) ${productsWithoutPercent.join(", ")} (upstream may omit 0); reported as null`,
      );
    }
  } else if (config.productUsage !== undefined) {
    notes.push("productUsage is not an array");
  } else {
    missing.push("productUsage");
  }

  // --- on-demand / extra usage ---------------------------------------------
  const onDemandCap = val(config.onDemandCap);
  const onDemandUsed = val(config.onDemandUsed);
  if (onDemandCap === null) missing.push("onDemandCap");
  if (onDemandUsed === null) missing.push("onDemandUsed");

  // --- sanity: never invent numbers -----------------------------------------
  const anyUsage = used !== null || products.some((p) => p.used_percent !== null);
  const anyPeriod = periodStart !== null || periodEnd !== null;
  if (!anyUsage && !anyPeriod) {
    throw new BudgetError(
      "SHAPE_CHANGED",
      "Billing response shape changed: neither usage (creditUsagePercent / productUsage) nor a billing period could be parsed.",
    );
  }

  if (missing.length > 0) notes.unshift(`missing field(s): ${missing.join(", ")}`);
  const warning =
    notes.length > 0
      ? `Partial data from the unofficial billing endpoint: ${notes.join("; ")}.`
      : null;

  return {
    used_percent: used,
    remaining_percent: remaining(used),
    products,
    period_type: periodType,
    period_start: periodStart,
    period_end: periodEnd,
    on_demand_cap: onDemandCap,
    on_demand_used: onDemandUsed,
    source: CREDITS_SOURCE,
    fetched_at: fetchedAt.toISOString(),
    warning,
  };
}

export const MONTHLY_NOTE =
  "Secondary data: monthly credit units from GET /v1/billing (units as reported upstream). This does NOT gate the weekly Grok Build limit; use get_budget for that.";

/** Map a `GET /v1/billing` (no format) body to the `get_monthly_credits` result. */
export function mapMonthly(body: unknown, fetchedAt: Date = new Date()): MonthlyResult {
  const config = extractConfig(body);
  if (!config) {
    throw new BudgetError(
      "SHAPE_CHANGED",
      "Billing response shape changed: no `config` object in the response.",
    );
  }
  const monthlyLimit = val(config.monthlyLimit);
  const used = val(config.used);
  const start = isoString(config.billingPeriodStart);
  const end = isoString(config.billingPeriodEnd);
  if (monthlyLimit === null && used === null && start === null && end === null) {
    throw new BudgetError(
      "SHAPE_CHANGED",
      "Billing response shape changed: neither monthlyLimit/used nor billingPeriodStart/End could be parsed.",
    );
  }
  const missing: string[] = [];
  if (monthlyLimit === null) missing.push("monthlyLimit");
  if (used === null) missing.push("used");
  if (start === null) missing.push("billingPeriodStart");
  if (end === null) missing.push("billingPeriodEnd");
  return {
    monthly_limit: monthlyLimit,
    used,
    billing_period_start: start,
    billing_period_end: end,
    source: MONTHLY_SOURCE,
    fetched_at: fetchedAt.toISOString(),
    secondary: true,
    note: MONTHLY_NOTE,
    warning:
      missing.length > 0
        ? `Partial data from the unofficial billing endpoint: missing field(s): ${missing.join(", ")}.`
        : null,
  };
}
