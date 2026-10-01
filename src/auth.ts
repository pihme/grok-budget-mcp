import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { BudgetError, LOGIN_HINT } from "./errors.js";

/**
 * READ-ONLY access to the Grok Build CLI session in auth.json.
 *
 * This module never refreshes tokens, never writes auth.json and never logs or
 * returns the token anywhere except to the billing request's Authorization header.
 *
 * Observed auth.json shape (written by `grok login`; see SergioComeron/GrokUsageBar
 * GrokAuthStore.swift and stablyai/orca grok-auth.ts):
 *
 * {
 *   "https://auth.x.ai::<client_id>": {
 *     "auth_mode": "oidc",
 *     "key": "<access token used as Bearer>",
 *     "refresh_token": "...",
 *     "expires_at": "2026-10-01T12:34:56.789Z",
 *     "oidc_issuer": "https://auth.x.ai",
 *     "oidc_client_id": "...",
 *     "email": "...", "user_id": "...", ...
 *   }
 * }
 */

export const PREFERRED_ISSUER = "https://auth.x.ai";

export interface GrokSession {
  /** Bearer token. Never log or return this. */
  readonly key: string;
  /** Expiry in epoch ms, or null if absent/unparseable. */
  readonly expiresAtMs: number | null;
}

export function resolveAuthPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const grokHome = env.GROK_HOME?.trim();
  if (grokHome) return join(grokHome, "auth.json");
  return join(home, ".grok", "auth.json");
}

type Entry = Record<string, unknown>;

function isObject(v: unknown): v is Entry {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseExpiresAt(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Accept epoch seconds or epoch milliseconds.
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

const API_KEY_MODES = new Set(["api_key", "apikey", "api-key", "xai_api_key"]);

function isOidcEntry(id: string, entry: Entry): boolean {
  const mode = typeof entry.auth_mode === "string" ? entry.auth_mode.toLowerCase() : undefined;
  if (mode && API_KEY_MODES.has(mode)) return false;
  if (mode === "oidc") return true;
  if (typeof entry.oidc_issuer === "string" || typeof entry.oidc_client_id === "string") return true;
  if (typeof entry.refresh_token === "string") return true;
  // Entries are keyed "<issuer>::<client_id>" by `grok login`.
  return id.includes("::") || id.startsWith("http");
}

function isPreferred(id: string, entry: Entry): boolean {
  return (
    id === PREFERRED_ISSUER ||
    id.startsWith(`${PREFERRED_ISSUER}::`) ||
    entry.oidc_issuer === PREFERRED_ISSUER
  );
}

/**
 * Pick the OIDC (`grok login`) entry from a parsed auth.json document.
 * Preference: issuer https://auth.x.ai over others; within a group, a
 * non-expired entry over an expired one; otherwise file order.
 */
export function selectSession(doc: unknown, now: number = Date.now()): GrokSession {
  if (!isObject(doc)) {
    throw new BudgetError(
      "AUTH_SHAPE_UNEXPECTED",
      `Auth shape unexpected: auth.json is not a JSON object. ${LOGIN_HINT}`,
    );
  }

  const entries: Array<[string, Entry]> = [];
  // Tolerate a flat single-entry file as well as the usual map of entries.
  if (typeof doc.key === "string") entries.push(["", doc]);
  for (const [id, value] of Object.entries(doc)) {
    if (isObject(value)) entries.push([id, value]);
  }

  const candidates = entries
    .filter(([, e]) => typeof e.key === "string" && e.key.trim() !== "")
    .filter(([id, e]) => isOidcEntry(id, e))
    .map(([id, e]) => ({
      preferred: isPreferred(id, e),
      session: { key: (e.key as string).trim(), expiresAtMs: parseExpiresAt(e.expires_at) },
    }));

  if (candidates.length === 0) {
    throw new BudgetError(
      "AUTH_SHAPE_UNEXPECTED",
      `Auth shape unexpected: no \`grok login\` (OIDC) entry with a \`key\` found in auth.json. ${LOGIN_HINT}`,
    );
  }

  const fresh = (s: GrokSession) => s.expiresAtMs === null || s.expiresAtMs > now;
  const pool = candidates.some((c) => c.preferred)
    ? candidates.filter((c) => c.preferred)
    : candidates;
  const chosen = pool.find((c) => fresh(c.session)) ?? pool[0]!;
  return chosen.session;
}

/** Throws SESSION_EXPIRED if the session's expires_at is in the past. */
export function assertNotExpired(session: GrokSession, now: number = Date.now()): void {
  if (session.expiresAtMs !== null && session.expiresAtMs <= now) {
    const when = new Date(session.expiresAtMs).toISOString();
    throw new BudgetError(
      "SESSION_EXPIRED",
      `Session expired: the \`grok login\` token expired at ${when}. ${LOGIN_HINT} (This server never refreshes tokens.)`,
    );
  }
}

/** Read auth.json (read-only) and return a non-expired session. */
export async function loadSession(
  path: string = resolveAuthPath(),
  now: number = Date.now(),
): Promise<GrokSession> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    // Do not echo the OS error: it may contain local usernames / paths.
    throw new BudgetError(
      "NOT_LOGGED_IN",
      `Not logged in: could not read the Grok auth file ($GROK_HOME/auth.json or ~/.grok/auth.json). ${LOGIN_HINT}`,
    );
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new BudgetError(
      "AUTH_SHAPE_UNEXPECTED",
      `Auth shape unexpected: auth.json is not valid JSON. ${LOGIN_HINT}`,
    );
  }
  const session = selectSession(doc, now);
  assertNotExpired(session, now);
  return session;
}
