# Contributing

Issues and pull requests are welcome.

## Setup

You need Claude Code 2.1.29x or newer.

```bash
git clone https://github.com/terryuser/claude-token-ledger.git
```

```bash
claude --plugin-dir ./claude-token-ledger/token-ledger
```

`--plugin-dir` loads the plugin for that session only, and reloads it when you save a file. If you also
have the plugin installed, disable that copy while developing, or every request is counted twice:

```bash
claude plugin disable token-ledger@token-ledger
```

## Checks

Run both before you open a pull request. CI runs the same two.

```bash
claude plugin validate .
```

```bash
claude plugin test token-ledger
```

Once Claude Code has loaded the plugin, it writes the API's type declarations to
`token-ledger/.claude-plugin/types/`. Then `tsc -p token-ledger` type-checks the code. Don't commit that
folder; it's generated.

## Packaging

Build the file that Claude's **Customize → Plugins → Upload** takes:

```bash
python scripts/pack.py
```

It writes `dist/token-ledger-<version>.plugin`. Watch out: the desktop app prefers an uploaded copy over a
local install of the same plugin. While an upload exists, edits in your clone don't reach the desktop app.
Remove the upload while developing, or upload the new package after each change.

An installed copy also runs from Claude Code's plugin cache, which is keyed by version. After a change,
bump `version` in `token-ledger/.claude-plugin/plugin.json`, run the command below, then start a new session:

```bash
claude plugin update token-ledger@token-ledger
```

## Code layout

| File | Role |
|---|---|
| `hooks/register.tsx` | The only file that talks to Claude Code (`$`): hooks, storage, files, commands, tools |
| `hooks/ledger.ts` | Window and session accounting |
| `hooks/pause.ts` | Pause and resume decisions |
| `hooks/report.ts` | Usage reports and the status text |
| `hooks/bars.ts`, `format.ts`, `csv.ts` | Bar maths, number formatting, CSV rendering |
| `hooks/view.tsx` | The band's drawing; takes elements and data, never `$` |
| `types/index.d.ts` | The plugin's state contract |
| `tests/` | `claude plugin test` suites; `harness.ts` mocks Claude Code |

Every module except `register.tsx` is pure. Keep it that way: the engine only follows `$` into functions
declared in the hooks module itself, and pure code is what the unit tests cover.

## Pull requests

- Add or update tests for any behaviour change.
- Add a line to `CHANGELOG.md` under an `Unreleased` heading.
- Never log or store prompt or response text. The plugin records counts only.
