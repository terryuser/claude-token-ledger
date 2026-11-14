# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-11-14

First public release.

### Added
- Band above the prompt: a stacked bar of the session's input, output, cache-read and cache-write tokens,
  and a 5-hour window meter with % used and a live reset countdown. It has a compact layout below 64 columns.
- Per-request CSV logs, plus `sessions.csv` and `windows.csv`, in `~/.claude/token-log/`.
- The real 5-hour window comes from Claude Code's rate-limit readings. Without one, it falls back to an
  estimated window.
- Pause at a configurable % (default 95) of the 5-hour or weekly limit, or when a request is refused at
  the limit. The turn stops after a model reply, before its tool calls run.
- Auto-resume two minutes after the limit resets. The pause survives a reload or a resumed session.
- `/tokens`, `/tokens-report`, `/tokens-status`. The `usage_report` and `usage_control` tools, plus a
  `token-usage` skill, so Claude can answer usage questions in plain words.
- Settings: `pauseAtPercent`, `autoResume`.

[0.4.0]: https://github.com/terryuser/claude-token-ledger/releases/tag/v0.4.0
