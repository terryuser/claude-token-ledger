---
name: token-usage
description: Use when the person asks about their Claude Code token usage or plan limits in plain words — "how many tokens did I use today / this week / in this session", "which project used the most", "how close am I to the 5-hour limit", "pause at 90%", "resume", "stop auto-resume", "hide the token band". Answers come from the token-ledger plugin's tools.
---

# Token usage (token-ledger)

The token-ledger plugin records every model request (main chat, subagents, compaction) and can pause a
session near the 5-hour or weekly plan limit, then resume it after the reset. Two tools reach it:

| Ask | Tool call |
|---|---|
| Usage for a span | `mcp__token-ledger__usage_report` with `period`: `today`, `yesterday`, `week` (7 days), `month` (30 days), `window` (current 5-hour window), `session`, `all` |
| Where things stand now | `mcp__token-ledger__usage_control` `{ "action": "status" }` |
| Change when it pauses | `usage_control` `{ "action": "set_threshold", "value": 90 }` (50–100) |
| Carry on after a pause | `usage_control` `{ "action": "resume" }`, then continue the paused task yourself |
| Stay paused, no auto-resume | `usage_control` `{ "action": "cancel_resume" }` |
| Show / hide the band | `usage_control` `{ "action": "show_band" }` / `{ "action": "hide_band" }` |

## How to answer

- Pick the period from the person's words; "this week" is `week`, "lately" is `week`, "ever" is `all`.
- The report comes back as Markdown tables. Lead with the one number they asked for, then keep the tables
  that answer the question (by project, by model, by day); drop the rest.
- Totals include cache reads, which are usually most of the tokens and cost far less than input. Say so
  when someone is surprised by a large number.
- The plan's "% used" counts claude.ai web and mobile too, so it can be higher than these tokens suggest.
- Never change the threshold or cancel an auto-resume unless the person asked for it.

Slash commands do the same without the model: `/tokens-report [period]`, `/tokens-status`,
`/tokens [resume | cancel | limit <n>]`, and `/tokens` alone toggles the band.
Raw CSV logs live in `~/.claude/token-log/` (per-request rows, `sessions.csv`, `windows.csv`).
