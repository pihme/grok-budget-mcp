import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { getBudget, getMonthlyCredits } from "../src/budget.js";
import { BudgetError } from "../src/errors.js";
import { FIXED_NOW, authFixture, billingFixture, header, json, mockFetch } from "./helpers.js";

const VALID = authFixture("valid.json");
const BASE = "https://cli-chat-proxy.grok.com/v1";
const TOKEN = "FAKE-OIDC-ACCESS-TOKEN-valid";

test("get_budget: single GET with the exact URL and headers", async () => {
  const m = mockFetch(() => json(billingFixture("credits-full.json")));
  const r = await getBudget({ authPath: VALID, baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW });
  assert.equal(m.calls.length, 1, "exactly one request, no refresh, no retry");
  const [call] = m.calls;
  assert.equal(call!.url, "https://cli-chat-proxy.grok.com/v1/billing?format=credits");
  assert.equal(call!.init?.method, "GET");
  assert.equal(header(call!.init, "authorization"), `Bearer ${TOKEN}`);
  assert.equal(header(call!.init, "x-xai-token-auth"), "xai-grok-cli");
  assert.equal(header(call!.init, "accept"), "application/json");
  assert.ok(call!.init?.signal, "request has an abort signal (timeout)");
  assert.equal(r.used_percent, 42.5);
  assert.equal(r.products.length, 3);
  assert.equal(r.fetched_at, "2026-10-01T19:00:00.000Z");
});

test("token never appears in the result", async () => {
  const m = mockFetch(() => json(billingFixture("credits-full.json")));
  const r = await getBudget({ authPath: VALID, baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW });
  assert.doesNotMatch(JSON.stringify(r), /FAKE/);
});

test("base URL override (GROK_CLI_CHAT_PROXY_BASE_URL) is used", async () => {
  const prev = process.env.GROK_CLI_CHAT_PROXY_BASE_URL;
  process.env.GROK_CLI_CHAT_PROXY_BASE_URL = "https://grok-proxy.acme.example/v1/";
  try {
    const m = mockFetch(() => json(billingFixture("credits-complete.json")));
    await getBudget({ authPath: VALID, fetchImpl: m.fetch, now: FIXED_NOW });
    assert.equal(m.calls[0]!.url, "https://grok-proxy.acme.example/v1/billing?format=credits");
  } finally {
    if (prev === undefined) delete process.env.GROK_CLI_CHAT_PROXY_BASE_URL;
    else process.env.GROK_CLI_CHAT_PROXY_BASE_URL = prev;
  }
});

test("auth.json is never modified (read-only)", async () => {
  const before = readFileSync(VALID, "utf8");
  const mtime = statSync(VALID).mtimeMs;
  for (const status of [200, 401]) {
    const m = mockFetch(() =>
      status === 200 ? json(billingFixture("credits-full.json")) : new Response("no", { status }),
    );
    await getBudget({ authPath: VALID, baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW }).catch(() => undefined);
  }
  assert.equal(readFileSync(VALID, "utf8"), before);
  assert.equal(statSync(VALID).mtimeMs, mtime);
});

test("expired token -> SESSION_EXPIRED and NO network request", async () => {
  const m = mockFetch(() => json({}));
  await assert.rejects(
    getBudget({ authPath: authFixture("expired.json"), baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW }),
    (e: unknown) => e instanceof BudgetError && e.code === "SESSION_EXPIRED" && /grok login/.test(e.message),
  );
  assert.equal(m.calls.length, 0);
});

for (const status of [401, 403]) {
  test(`HTTP ${status} -> UNAUTHORIZED telling the user to run grok login (no retry)`, async () => {
    const m = mockFetch(() => new Response(`{"error":"unauthorized ${TOKEN}"}`, { status }));
    await assert.rejects(
      getBudget({ authPath: VALID, baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW }),
      (e: unknown) => {
        assert.ok(e instanceof BudgetError);
        assert.equal(e.code, "UNAUTHORIZED");
        assert.equal(e.status, status);
        assert.match(e.message, new RegExp(`HTTP ${status}`));
        assert.match(e.message, /grok login/);
        assert.doesNotMatch(e.message, /FAKE/, "upstream body is not echoed");
        return true;
      },
    );
    assert.equal(m.calls.length, 1);
  });
}

test("HTTP 429 -> RATE_LIMITED (retry later), single request", async () => {
  const m = mockFetch(() => new Response("slow down", { status: 429 }));
  await assert.rejects(getBudget({ authPath: VALID, baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW }), {
    code: "RATE_LIMITED",
  });
  assert.equal(m.calls.length, 1);
});

test("HTTP 503 -> REQUEST_FAILED including status, single request", async () => {
  const m = mockFetch(() => new Response("oops", { status: 503 }));
  await assert.rejects(
    getBudget({ authPath: VALID, baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW }),
    (e: unknown) => e instanceof BudgetError && e.code === "REQUEST_FAILED" && /HTTP 503/.test(e.message),
  );
  assert.equal(m.calls.length, 1);
});

test("network error -> REQUEST_FAILED", async () => {
  const m = mockFetch(() => {
    throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
  });
  await assert.rejects(
    getBudget({ authPath: VALID, baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW }),
    (e: unknown) => e instanceof BudgetError && e.code === "REQUEST_FAILED" && /ENOTFOUND/.test(e.message),
  );
});

test("timeout -> REQUEST_FAILED (timed out), aborts the request", async () => {
  const m = mockFetch(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  );
  await assert.rejects(
    getBudget({ authPath: VALID, baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW, timeoutMs: 50 }),
    (e: unknown) => e instanceof BudgetError && e.code === "REQUEST_FAILED" && /timed out/.test(e.message),
  );
  assert.equal(m.calls.length, 1);
});

test("200 with non-JSON body -> SHAPE_CHANGED", async () => {
  const m = mockFetch(() => new Response("<html>login</html>", { status: 200 }));
  await assert.rejects(getBudget({ authPath: VALID, baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW }), {
    code: "SHAPE_CHANGED",
  });
});

test("200 with changed shape -> SHAPE_CHANGED", async () => {
  const m = mockFetch(() => json(billingFixture("shape-changed.json")));
  await assert.rejects(getBudget({ authPath: VALID, baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW }), {
    code: "SHAPE_CHANGED",
  });
});

test("missing auth file -> NOT_LOGGED_IN and no request", async () => {
  const m = mockFetch(() => json({}));
  await assert.rejects(
    getBudget({ authPath: "/does/not/exist/auth.json", baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW }),
    { code: "NOT_LOGGED_IN" },
  );
  assert.equal(m.calls.length, 0);
});

test("get_monthly_credits calls /billing without format=credits", async () => {
  const m = mockFetch(() => json(billingFixture("monthly.json")));
  const r = await getMonthlyCredits({ authPath: VALID, baseUrl: BASE, fetchImpl: m.fetch, now: FIXED_NOW });
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0]!.url, "https://cli-chat-proxy.grok.com/v1/billing");
  assert.equal(header(m.calls[0]!.init, "authorization"), `Bearer ${TOKEN}`);
  assert.equal(r.monthly_limit, 15000);
  assert.equal(r.secondary, true);
});
