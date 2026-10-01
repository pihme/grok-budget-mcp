import { loadSession, resolveAuthPath } from "./auth.js";
import {
  type BudgetResult,
  type FetchLike,
  type MonthlyResult,
  mapCredits,
  mapMonthly,
  requestBilling,
  resolveBaseUrl,
} from "./billing.js";

export interface Deps {
  /** Path to auth.json. Default: $GROK_HOME/auth.json or ~/.grok/auth.json */
  authPath?: string;
  /** Default: $GROK_CLI_CHAT_PROXY_BASE_URL or https://cli-chat-proxy.grok.com/v1 */
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => Date;
}

function resolved(deps: Deps) {
  return {
    authPath: deps.authPath ?? resolveAuthPath(),
    baseUrl: deps.baseUrl ?? resolveBaseUrl(),
    now: deps.now ?? (() => new Date()),
  };
}

/** Weekly pool usage (same figure as the TUI `/usage`). auth.json is re-read on every call. */
export async function getBudget(deps: Deps = {}): Promise<BudgetResult> {
  const { authPath, baseUrl, now } = resolved(deps);
  const session = await loadSession(authPath, now().getTime());
  const body = await requestBilling("/billing?format=credits", {
    baseUrl,
    key: session.key,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });
  return mapCredits(body, now());
}

/** Secondary: monthly credit units (does not gate the weekly Build limit). */
export async function getMonthlyCredits(deps: Deps = {}): Promise<MonthlyResult> {
  const { authPath, baseUrl, now } = resolved(deps);
  const session = await loadSession(authPath, now().getTime());
  const body = await requestBilling("/billing", {
    baseUrl,
    key: session.key,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });
  return mapMonthly(body, now());
}
