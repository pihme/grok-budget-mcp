# Contributing

grok-budget-mcp is open source under the [MIT License](LICENSE).

## Issues

Issues, bug reports and ideas are very welcome. Pick the matching [issue form](https://github.com/pihme/grok-budget-mcp/issues/new/choose) (bug report, endpoint or login change, documentation, feature request, question). A good report names the grok-budget-mcp version or commit, your OS, Node.js and Grok CLI versions, how the server is wired into Grok Build, which tool you called, what you expected and what happened.

If you would like to change code, please open an issue first and describe the change, so we can agree on it before you spend time on it.

## Keep secrets out

The tracker is public. Never paste your `auth.json`, a token, an `Authorization` header or the raw billing response. Field names and their types are enough to look into a changed endpoint. If you find a way the server could leak your token, open an issue that only names the affected area and ask for a private channel.

## Build and test locally

Needs Node.js 18.18+ (20+ recommended) and npm. The tests need no Grok account: they mock the billing endpoint and use synthetic auth files.

```bash
npm install
npm run build
npm test
```

`npm run smoke` is optional: it starts the server over stdio and calls `get_budget` once with **your** real `grok login` session, which is one request to the unofficial endpoint.
