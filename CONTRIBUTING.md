# Contributing

grok-budget-mcp is open source under the [MIT License](LICENSE).

## Issues

Issues, bug reports and ideas are very welcome. Pick the matching [issue form](https://github.com/pihme/grok-budget-mcp/issues/new/choose) (bug report, endpoint or login change, documentation, feature request, question). A good report names the grok-budget-mcp version or commit, your OS, Node.js and Grok CLI versions, how the server is wired into Grok Build, which tool you called, what you expected and what happened.

## Pull requests

Pull requests are welcome; contributions are accepted under the [MIT License](LICENSE). For anything bigger than a small fix, please open an issue first so we can agree on the change. Keep a pull request to one change, fill in the [pull request template](.github/pull_request_template.md), give it a [Conventional Commit](https://www.conventionalcommits.org/) title (`fix: …`, `feat: …`, `docs: …`; it becomes the squash commit and decides the next release), and make sure `npm test` passes.

## Keep secrets out

The tracker is public. Never paste your `auth.json`, a token, an `Authorization` header or the raw billing response. Field names and their types are enough to look into a changed endpoint. If you find a way the server could leak your token, please report it privately through the [private reporting form](https://github.com/pihme/grok-budget-mcp/security/advisories/new), as described in [SECURITY.md](SECURITY.md), not as a public issue.

## Build and test locally

Needs Node.js 22+ and npm. The tests need no Grok account: they mock the billing endpoint and use synthetic auth files.

```bash
npm install
npm run build
npm test
```

`npm run smoke` is optional: it starts the server over stdio and calls `get_budget` once with **your** real `grok login` session, which is one request to the unofficial endpoint.
