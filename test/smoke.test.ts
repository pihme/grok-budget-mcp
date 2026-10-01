/**
 * End-to-end smoke test: spawn the real stdio server (compiled src/index.ts) as
 * a child process, list tools, and call get_budget against a local HTTP mock of
 * the billing proxy (via GROK_CLI_CHAT_PROXY_BASE_URL) with a fixture GROK_HOME.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { billingFixture, tempGrokHome } from "./helpers.js";

const ENTRY = fileURLToPath(new URL("../src/index.js", import.meta.url));

test("stdio server: list tools and call get_budget end-to-end", async () => {
  const seen: Array<{ url: string; headers: IncomingHttpHeaders }> = [];
  const http = createServer((req, res) => {
    seen.push({ url: req.url ?? "", headers: req.headers });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(billingFixture("credits-full.json")));
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const port = (http.address() as AddressInfo).port;

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.GROK_HOME = tempGrokHome("valid.json");
  env.GROK_CLI_CHAT_PROXY_BASE_URL = `http://127.0.0.1:${port}/v1`;

  const transport = new StdioClientTransport({ command: process.execPath, args: [ENTRY], env, stderr: "pipe" });
  const client = new Client({ name: "smoke", version: "0.0.0" });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, "grok-budget");
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["get_budget", "get_monthly_credits"]);

    const r = await client.callTool({ name: "get_budget", arguments: {} });
    assert.notEqual(r.isError, true);
    const body = r.structuredContent as Record<string, unknown>;
    assert.equal(body.used_percent, 42.5);
    assert.equal(body.remaining_percent, 57.5);
    assert.equal((body.products as unknown[]).length, 3);

    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.url, "/v1/billing?format=credits");
    assert.equal(seen[0]!.headers.authorization, "Bearer FAKE-OIDC-ACCESS-TOKEN-valid");
    assert.equal(seen[0]!.headers["x-xai-token-auth"], "xai-grok-cli");
    assert.equal(seen[0]!.headers.accept, "application/json");
  } finally {
    await client.close();
    http.close();
  }
});

test("stdio server: expired session is a tool error, no HTTP call", async () => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.GROK_HOME = tempGrokHome("expired.json");
  env.GROK_CLI_CHAT_PROXY_BASE_URL = "http://127.0.0.1:9/v1"; // discard port; must not be contacted

  const transport = new StdioClientTransport({ command: process.execPath, args: [ENTRY], env, stderr: "pipe" });
  const client = new Client({ name: "smoke", version: "0.0.0" });
  try {
    await client.connect(transport);
    const r = await client.callTool({ name: "get_budget", arguments: {} });
    assert.equal(r.isError, true);
    const t = (r.content as Array<{ text: string }>)[0]!.text;
    assert.match(t, /Session expired.*grok login/);
  } finally {
    await client.close();
  }
});
