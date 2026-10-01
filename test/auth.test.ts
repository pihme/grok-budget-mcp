import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadSession, parseExpiresAt, resolveAuthPath, selectSession } from "../src/auth.js";
import { BudgetError } from "../src/errors.js";
import { authFixture } from "./helpers.js";

const NOW = Date.parse("2026-10-01T19:00:00Z");

test("resolveAuthPath honours GROK_HOME, else ~/.grok/auth.json", () => {
  assert.equal(resolveAuthPath({ GROK_HOME: "/custom/grok" }, "/home/u"), join("/custom/grok", "auth.json"));
  assert.equal(resolveAuthPath({}, "/home/u"), join("/home/u", ".grok", "auth.json"));
  assert.equal(resolveAuthPath({ GROK_HOME: "  " }, "/home/u"), join("/home/u", ".grok", "auth.json"));
});

test("picks the OIDC entry's `key`, not a bare API key", async () => {
  const s = await loadSession(authFixture("valid.json"), NOW);
  assert.equal(s.key, "FAKE-OIDC-ACCESS-TOKEN-valid");
  assert.equal(s.expiresAtMs, Date.parse("2099-01-01T00:00:00.000Z"));
});

test("prefers a fresh https://auth.x.ai entry over alternate issuers and stale entries", async () => {
  const s = await loadSession(authFixture("multi-issuer.json"), NOW);
  assert.equal(s.key, "FAKE-XAI-FRESH-TOKEN");
});

test("missing auth file -> NOT_LOGGED_IN without leaking the path", async () => {
  await assert.rejects(loadSession("/nonexistent/dir/auth.json", NOW), (e: unknown) => {
    assert.ok(e instanceof BudgetError);
    assert.equal(e.code, "NOT_LOGGED_IN");
    assert.match(e.message, /grok login/);
    assert.doesNotMatch(e.message, /nonexistent/);
    return true;
  });
});

test("invalid JSON -> AUTH_SHAPE_UNEXPECTED", async () => {
  await assert.rejects(loadSession(authFixture("invalid-json.txt"), NOW), { code: "AUTH_SHAPE_UNEXPECTED" });
});

test("API-key-only file -> AUTH_SHAPE_UNEXPECTED", async () => {
  await assert.rejects(loadSession(authFixture("api-key-only.json"), NOW), (e: unknown) => {
    assert.ok(e instanceof BudgetError);
    assert.equal(e.code, "AUTH_SHAPE_UNEXPECTED");
    assert.match(e.message, /grok login/);
    assert.doesNotMatch(e.message, /FAKE/);
    return true;
  });
});

test("OIDC entry without `key` -> AUTH_SHAPE_UNEXPECTED", async () => {
  await assert.rejects(loadSession(authFixture("no-key.json"), NOW), { code: "AUTH_SHAPE_UNEXPECTED" });
});

test("non-object document -> AUTH_SHAPE_UNEXPECTED", () => {
  assert.throws(() => selectSession([1, 2, 3], NOW), { code: "AUTH_SHAPE_UNEXPECTED" });
  assert.throws(() => selectSession("x", NOW), { code: "AUTH_SHAPE_UNEXPECTED" });
});

test("expired token -> SESSION_EXPIRED, token not in message", async () => {
  await assert.rejects(loadSession(authFixture("expired.json"), NOW), (e: unknown) => {
    assert.ok(e instanceof BudgetError);
    assert.equal(e.code, "SESSION_EXPIRED");
    assert.match(e.message, /Session expired/);
    assert.match(e.message, /grok login/);
    assert.doesNotMatch(e.message, /FAKE-OIDC/);
    return true;
  });
});

test("entry without expires_at is used (server relies on 401 instead)", async () => {
  const s = await loadSession(authFixture("no-expiry.json"), NOW);
  assert.equal(s.expiresAtMs, null);
});

test("parseExpiresAt accepts ISO strings and epoch seconds/ms", () => {
  assert.equal(parseExpiresAt("2026-10-01T00:00:00Z"), Date.parse("2026-10-01T00:00:00Z"));
  assert.equal(parseExpiresAt(1_790_000_000), 1_790_000_000_000);
  assert.equal(parseExpiresAt(1_790_000_000_000), 1_790_000_000_000);
  assert.equal(parseExpiresAt("garbage"), null);
  assert.equal(parseExpiresAt(undefined), null);
});
