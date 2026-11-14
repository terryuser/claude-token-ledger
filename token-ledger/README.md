# token-ledger

A Claude Code plugin that records the tokens you spend, per session and per 5-hour plan window. It pauses
work just before the 5-hour or weekly limit and continues it by itself after the reset.

- **Band above the prompt:** a bar of the session's input, output, cache-read and cache-write tokens, and a
  meter of the 5-hour window's % used with a reset countdown.
- **CSV logs** in `~/.claude/token-log/`: one row per model request, plus per-session and per-window summaries.
- **Pause and resume:** when a limit reaches 95% (configurable), the turn stops before its next tool calls.
  A "continue" prompt is sent two minutes after the reset.
- **Ask in plain words:** "how many tokens did I use this week?" Claude answers through the plugin's tools.

Install it from the Claude Code prompt:

```
/plugin install token-ledger --marketplace terryuser/claude-token-ledger
```

Commands: `/tokens`, `/tokens-report [period]`, `/tokens-status`, `/tokens resume | cancel | limit <n>`.
Settings in `/config`: `pauseAtPercent` (default 95) and `autoResume` (default on).

Runs in Claude Code 2.1.29x or newer (terminal or desktop Code tab). It doesn't run in Chat.
Full documentation: https://github.com/terryuser/claude-token-ledger
