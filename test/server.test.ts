import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Deps } from "../src/budget.js";
import { createServer } from "../src/server.js";
import { FIXED_NOW, authFixture, billingFixture, json, mockFetch } from "./helpers.js";

async function connect(deps: Deps) {
  const server = createServer(deps);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client, close: () => client.close() };
}

const text = (r: unknown) => ((r as { content: unknown }).content as Array<{ type: string; text: string }>)[0]!.text;

test("lists get_budget and get_monthly_credits (secondary)", async () => {
  const { client, close } = await connect({});
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["get_budget", "get_monthly_credits"]);
  const monthly = tools.find((t) => t.name === "get_monthly_credits")!;
  assert.match(monthly.description ?? "", /SECONDARY/);
  const budget = tools.find((t) => t.name === "get_budget")!;
  assert.equal(budget.annotations?.readOnlyHint, true);
  await close();
});

test("get_budget returns JSON text + structuredContent", async () => {
  const m = mockFetch(() => json(billingFixture("credits-full.json")));
  const { client, close } = await connect({
    authPath: authFixture("valid.json"),
    baseUrl: "https://x.example/v1",
    fetchImpl: m.fetch,
    now: FIXED_NOW,
  });
  const r = await client.callTool({ name: "get_budget", arguments: {} });
  assert.notEqual(r.isError, true);
  const parsed = JSON.parse(text(r));
  assert.equal(parsed.used_percent, 42.5);
  assert.deepEqual(r.structuredContent, parsed);
  assert.doesNotMatch(text(r), /FAKE/);
  await close();
});

test("errors surface as MCP tool errors (isError) with clear messages", async () => {
  const cases: Array<[Deps, RegExp]> = [
    [{ authPath: authFixture("expired.json") }, /SESSION_EXPIRED.*Session expired.*grok login/],
    [{ authPath: "/nope/auth.json" }, /NOT_LOGGED_IN.*Not logged in.*grok login/],
    [{ authPath: authFixture("api-key-only.json") }, /AUTH_SHAPE_UNEXPECTED.*grok login/],
    [
      { authPath: authFixture("valid.json"), fetchImpl: mockFetch(() => new Response("", { status: 401 })).fetch },
      /UNAUTHORIZED.*Billing unauthorized \(HTTP 401\).*grok login/,
    ],
    [
      { authPath: authFixture("valid.json"), fetchImpl: mockFetch(() => json(billingFixture("shape-changed.json"))).fetch },
      /SHAPE_CHANGED.*shape changed/,
    ],
  ];
  for (const [deps, re] of cases) {
    const { client, close } = await connect({ baseUrl: "https://x.example/v1", now: FIXED_NOW, ...deps });
    const r = await client.callTool({ name: "get_budget", arguments: {} });
    assert.equal(r.isError, true);
    assert.match(text(r), re);
    assert.doesNotMatch(text(r), /FAKE/);
    await close();
  }
});

test("unexpected internal errors are not echoed", async () => {
  const { client, close } = await connect({
    authPath: authFixture("valid.json"),
    baseUrl: "https://x.example/v1",
    now: FIXED_NOW,
    fetchImpl: mockFetch(() => {
      throw new Error("secret detail FAKE-OIDC-ACCESS-TOKEN-valid");
    }).fetch,
  });
  const r = await client.callTool({ name: "get_budget", arguments: {} });
  assert.equal(r.isError, true);
  assert.doesNotMatch(text(r), /FAKE|secret/);
  await close();
});
