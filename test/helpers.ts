import { readFileSync } from "node:fs";
import { mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FetchLike } from "../src/billing.js";

// Compiled tests live in .test-build/test/, fixtures stay in test/fixtures/.
export const FIXTURES = fileURLToPath(new URL("../../test/fixtures/", import.meta.url));

export const authFixture = (name: string) => join(FIXTURES, "auth", name);
export const billingFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, "billing", name), "utf8"));

/** Copy an auth fixture into a fresh temp GROK_HOME as auth.json. */
export function tempGrokHome(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), "grok-budget-test-"));
  copyFileSync(authFixture(fixture), join(dir, "auth.json"));
  return dir;
}

export interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

export type Responder = (url: string, init?: RequestInit) => Response | Promise<Response>;

export function mockFetch(responder: Responder): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  return { fetch, calls };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export function header(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

export const FIXED_NOW = () => new Date("2026-10-01T19:00:00.000Z");
