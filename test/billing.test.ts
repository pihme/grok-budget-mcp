import { test } from "node:test";
import assert from "node:assert/strict";
import { CREDITS_SOURCE, mapCredits, mapMonthly, resolveBaseUrl } from "../src/billing.js";
import { billingFixture } from "./helpers.js";

const FETCHED = new Date("2026-10-01T19:00:00.000Z");

const EXPECTED_KEYS = [
  "used_percent",
  "remaining_percent",
  "products",
  "period_type",
  "period_start",
  "period_end",
  "on_demand_cap",
  "on_demand_used",
  "source",
  "fetched_at",
  "warning",
].sort();

test("maps every field of a full credits response", () => {
  const r = mapCredits(billingFixture("credits-full.json"), FETCHED);
  assert.deepEqual(Object.keys(r).sort(), EXPECTED_KEYS);
  assert.equal(r.used_percent, 42.5);
  assert.equal(r.remaining_percent, 57.5);
  assert.equal(r.period_type, "USAGE_PERIOD_TYPE_WEEKLY");
  assert.equal(r.period_start, "2026-09-28T01:53:09.930537+00:00");
  assert.equal(r.period_end, "2026-10-05T01:53:09.930537+00:00");
  assert.equal(r.on_demand_cap, 2500);
  assert.equal(r.on_demand_used, 120, "numeric strings in {val} are accepted");
  assert.equal(r.source, CREDITS_SOURCE);
  assert.equal(r.source, "cli-chat-proxy:/v1/billing?format=credits");
  assert.equal(r.fetched_at, "2026-10-01T19:00:00.000Z");
});

test("products array contains ALL productUsage rows; missing usagePercent -> null + warning", () => {
  const r = mapCredits(billingFixture("credits-full.json"), FETCHED);
  assert.deepEqual(r.products, [
    { product: "GrokBuild", used_percent: 61.25, remaining_percent: 38.75 },
    { product: "GrokChat", used_percent: 7, remaining_percent: 93 },
    { product: "GrokImagine", used_percent: null, remaining_percent: null },
  ]);
  assert.match(r.warning ?? "", /GrokImagine/);
});

test("complete response has warning null; remaining is clamped to [0, 100]", () => {
  const r = mapCredits(billingFixture("credits-complete.json"), FETCHED);
  assert.equal(r.warning, null);
  assert.equal(r.used_percent, 100);
  assert.equal(r.remaining_percent, 0);
  assert.deepEqual(r.products, [{ product: "GrokBuild", used_percent: 104, remaining_percent: 0 }]);
});

test("negative usage clamps remaining to 100", () => {
  const r = mapCredits(
    { config: { creditUsagePercent: -3, currentPeriod: { start: "2026-09-28T00:00:00Z", end: "2026-10-05T00:00:00Z" } } },
    FETCHED,
  );
  assert.equal(r.remaining_percent, 100);
});

test("omitted creditUsagePercent with a full current period -> 0 (proto3) with warning", () => {
  const r = mapCredits(billingFixture("credits-omitted-zero.json"), FETCHED);
  assert.equal(r.used_percent, 0);
  assert.equal(r.remaining_percent, 100);
  assert.match(r.warning ?? "", /omitted/);
  assert.deepEqual(r.products, [{ product: "GrokBuild", used_percent: null, remaining_percent: null }]);
});

test("falls back to billingPeriodStart/End when currentPeriod is absent", () => {
  const r = mapCredits(billingFixture("credits-fallback-period.json"), FETCHED);
  assert.equal(r.period_start, "2026-09-28T00:00:00+00:00");
  assert.equal(r.period_end, "2026-10-05T00:00:00+00:00");
  assert.equal(r.period_type, null);
  assert.equal(r.used_percent, 12);
  assert.match(r.warning ?? "", /fallback/);
});

test("missing fields are null with a warning, never invented", () => {
  const r = mapCredits(
    { config: { currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-10-05T00:00:00Z" } } },
    FETCHED,
  );
  assert.equal(r.used_percent, null, "no 0-default without a full period");
  assert.equal(r.remaining_percent, null);
  assert.deepEqual(r.products, []);
  assert.equal(r.on_demand_cap, null);
  assert.equal(r.on_demand_used, null);
  assert.equal(r.period_start, null);
  assert.equal(r.period_end, "2026-10-05T00:00:00Z");
  assert.match(r.warning ?? "", /creditUsagePercent/);
  assert.match(r.warning ?? "", /onDemandCap/);
  assert.match(r.warning ?? "", /productUsage/);
});

test("non-numeric creditUsagePercent -> null + warning", () => {
  const r = mapCredits(
    { config: { creditUsagePercent: "lots", currentPeriod: { start: "2026-09-28T00:00:00Z", end: "2026-10-05T00:00:00Z" } } },
    FETCHED,
  );
  assert.equal(r.used_percent, null);
  assert.match(r.warning ?? "", /not a number/);
});

test("non-weekly period type is flagged", () => {
  const r = mapCredits(
    {
      config: {
        creditUsagePercent: 5,
        currentPeriod: { type: "USAGE_PERIOD_TYPE_MONTHLY", start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" },
      },
    },
    FETCHED,
  );
  assert.match(r.warning ?? "", /not weekly/);
});

test("monthly-only body is NOT reported as weekly percentages", () => {
  const r = mapCredits(billingFixture("monthly.json"), FETCHED);
  assert.equal(r.used_percent, null);
  assert.equal(r.remaining_percent, null);
  assert.deepEqual(r.products, []);
  assert.match(r.warning ?? "", /monthly/);
  assert.match(r.warning ?? "", /get_monthly_credits/);
});

test("shape changed (no usage, no period) -> SHAPE_CHANGED error", () => {
  assert.throws(() => mapCredits(billingFixture("shape-changed.json"), FETCHED), { code: "SHAPE_CHANGED" });
  assert.throws(() => mapCredits({}, FETCHED), { code: "SHAPE_CHANGED" });
  assert.throws(() => mapCredits(null, FETCHED), { code: "SHAPE_CHANGED" });
  assert.throws(() => mapCredits([1], FETCHED), { code: "SHAPE_CHANGED" });
  assert.throws(() => mapCredits({ config: { productUsage: "nope" } }, FETCHED), { code: "SHAPE_CHANGED" });
});

test("unwrapped config at top level is tolerated", () => {
  const r = mapCredits(
    { creditUsagePercent: 10, currentPeriod: { start: "2026-09-28T00:00:00Z", end: "2026-10-05T00:00:00Z" } },
    FETCHED,
  );
  assert.equal(r.used_percent, 10);
});

test("mapMonthly maps monthly units and marks them secondary", () => {
  const r = mapMonthly(billingFixture("monthly.json"), FETCHED);
  assert.equal(r.monthly_limit, 15000);
  assert.equal(r.used, 2931);
  assert.equal(r.billing_period_start, "2026-09-01T00:00:00+00:00");
  assert.equal(r.billing_period_end, "2026-10-01T00:00:00+00:00");
  assert.equal(r.secondary, true);
  assert.match(r.note, /does NOT gate the weekly/);
  assert.equal(r.source, "cli-chat-proxy:/v1/billing");
  assert.equal(r.warning, null);
  assert.throws(() => mapMonthly(billingFixture("shape-changed.json"), FETCHED), { code: "SHAPE_CHANGED" });
});

test("resolveBaseUrl: default, override, trailing slash", () => {
  assert.equal(resolveBaseUrl({}), "https://cli-chat-proxy.grok.com/v1");
  assert.equal(
    resolveBaseUrl({ GROK_CLI_CHAT_PROXY_BASE_URL: "https://proxy.example.com/v1/" }),
    "https://proxy.example.com/v1",
  );
});
