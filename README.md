# token-ledger

[![CI](https://github.com/terryuser/claude-token-ledger/actions/workflows/ci.yml/badge.svg)](https://github.com/terryuser/claude-token-ledger/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [Claude Code](https://code.claude.com) plugin that shows where your tokens go. When you get close to your plan's
usage limit, it pauses the work and carries on by itself after the limit resets.

```
╭──────────────────────────────────────────────────────────────────────────────────╮
│ ◆ Session   1.24M  ███▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▓                                 │
│                    ● input 3.4k  ● output 12k  ● cache read 1.1M  ● cache write 80k │
│ ◷ 5h window 4.2M   █████░░░░░░░░░░░░░░░░░░░  23% used · resets 15:00 · 2h 14m left   │
╰──────────────────────────────────────────────────────────────────────────────────╯
```

## Features

- **Live band above the prompt.** One bar shows the session's tokens split by type (input, output, cache
  read, cache write). A meter shows the 5-hour window's % used, turning from green to amber to red, with a
  live reset countdown.
- **Complete accounting.** Every model request is counted: the main conversation, subagents and compaction.
- **CSV logs.** One row per request, plus per-session and per-window summaries, in `~/.claude/token-log/`.
  They open directly in Excel or any data tool.
- **Pause before the limit.** When the 5-hour or weekly limit reaches 95% (configurable), the running turn
  stops right after a model reply, before its tool calls run. Nothing is left half-done. Subagents stop too:
  each one ends at its next step and tells the main chat its task is unfinished.
- **Auto-resume.** Two minutes after the limit resets, a "continue" prompt is sent and the task picks up
  where it stopped.
- **Ask in plain words.** "How many tokens did I use this week?", "which project used the most?", "pause at
  90%". Claude answers through the plugin's tools.

## Install

Requires Claude Code **2.1.29x or newer**, in the terminal or the desktop app's Code tab. Type this at the
Claude Code prompt:

```
/plugin install token-ledger --marketplace terryuser/claude-token-ledger
```

Answer `y` to add the marketplace, then choose the **user** scope so every session loads the plugin.

<details>
<summary>Install from a local clone</summary>

```bash
git clone https://github.com/terryuser/claude-token-ledger.git
```

```bash
claude plugin marketplace add ./claude-token-ledger
```

```bash
claude plugin install token-ledger@token-ledger --scope user
```

</details>

## Usage

| Command | What it does |
|---|---|
| `/tokens` | Show or hide the band, and print the log folder |
| `/tokens-report [today\|yesterday\|week\|month\|window\|session\|all]` | Usage by project, model and day |
| `/tokens-status` | This session, the 5-hour window and the pause state |
| `/tokens resume` | Continue a paused session now |
| `/tokens cancel` | Stay paused, with no auto-resume |
| `/tokens limit <50-100>` | Change the pause threshold |

You can also just ask Claude. The plugin gives it two tools, `usage_report` and `usage_control`, and a skill
that tells it when to use them.

### Settings

Both settings appear in `/config`:

| Setting | Default | |
|---|---|---|
| `pauseAtPercent` | `95` | Pause when the 5-hour or weekly limit reaches this % |
| `autoResume` | `true` | Send a "continue" prompt after the limit resets |

### Log files

| File | Contents |
|---|---|
| `responses/<date>_<session>.csv` | One row per model request: time, session, project, agent, model, the four token counts, window |
| `sessions.csv` | One row per Claude Code session |
| `windows.csv` | One row per 5-hour window, with the plan's % used |

## How it works

The plugin is a Claude Code *mod*: function hooks that run inside Claude Code.

- It reads each model request's token usage as the request completes.
- It reads the plan's 5-hour and weekly limits, which Claude Code reports.
- It stops a turn with `turn.abort`, and resumes with a queued prompt once the session is idle.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and its trade-offs.

## Limitations

- **Claude Code only.** Mods don't run in Claude's Chat tab or in `claude -p`. Chat ignores hooks and can't
  read local files. To check usage from Chat, use Settings → Usage.
- **Subscription plans only, for pause and resume.** With an API key there is no 5-hour window, so pausing
  stays off and the band shows an estimate.
- **"% used" counts every app.** It comes from your plan, so it includes claude.ai web and mobile. Token
  totals count Claude Code only.
- **Claude Code must stay open, and the computer awake, for an on-time resume.** After the computer wakes
  from sleep, it resumes within 30 seconds.
- **Concurrent sessions.** Two sessions that finish a request at the same instant can race on the
  per-session/per-window summaries. The per-request CSV rows are always exact.

## Privacy

Everything stays on your machine. The plugin makes no network calls. It writes only to `~/.claude/token-log/`
and to Claude Code's own plugin store. It never records prompt or response text, only counts.

## Development

```bash
claude plugin validate .
```

```bash
claude plugin test token-ledger
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Terry Lau
