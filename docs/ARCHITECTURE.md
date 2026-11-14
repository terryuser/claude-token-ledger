# Architecture

token-ledger is a Claude Code mod: a plugin whose `hooks/hooks.json` names one hooks module,
`hooks/register.tsx`. Claude Code loads that module into an isolated environment with no DOM and no Node.
The module reaches the outside world only through the engine interface `$`.

## Data flow

```
model request ──► turn.step hook ──► record()  ──► $.store  (windows, sessions: summaries)
                       │                    └────► CSV files (responses/<date>_<session>.csv,
                       │                                       sessions.csv, windows.csv)
                       └──► limit check ──► pauseSession() ──► $.store (pauses) + turn.abort
                                                                    │
30 s clock tick ──► resumeIfDue() ◄─────────────────────────────────┘
                       └──► prompt.submit("Continue where you left off…")

ui.render(AbovePrompt) ──► view.tsx (band)       commands / tools ──► report.ts (reads the CSVs)
```

## Hooks

| Event | Why |
|---|---|
| `turn.step` | Every model request, main loop and subagents, with its token usage. Also the limit check. |
| `session.compact` | The summarizer's request is not a turn step, so it's counted here. |
| `turn.start` / `turn.complete` | Track the main turn to abort. Detect a request refused at the limit. |
| `session.start` | Register commands and tools, restore a saved pause, start the 30-second clock. |
| `ui.render` (`AbovePrompt`) | Draw the band. |
| `command.run`, `tool.call` | `/tokens*` commands and the `usage_report` / `usage_control` tools. |

## Decisions

**The real window, not an estimate.** `$.session.usage().rateLimits` reports the plan's `five_hour` and
`seven_day` windows, each with `resetsAt` and `percentUsed`. Windows are keyed by their reset time. When no
reading exists (API-key auth), an estimated window starts at the top of the hour; the band marks it with `~`.

**Pause after a reply, before its tools.** The limit is checked after each response. The turn is aborted only
when that response asked for tools, or came from a subagent: those are the only cases where more work would
follow. Aborting at that point means no tool runs half-way. A reply that ends the turn just raises a toast.

**Readings go stale.** After a reset, the last reading still shows the old window until a new response
arrives. A reading whose `resetsAt` has passed is ignored, so a resumed turn isn't paused again at once.

**Both limits.** If both the 5-hour and the weekly limit are hit, the pause waits for the later reset.

**The pause is taken once.** While a pause is recorded, prompts you type run normally and are never aborted.
The scheduled resume still fires.

**Model-asked resume.** When Claude calls `usage_control resume`, the pause is cleared without queuing a
"continue" prompt, because the turn that asked already is the continuation.

**CSV per session per day.** `$.fs` has no append, and a single read or write is capped at 4 MiB. Small
files keep each read-modify-write cheap, and reports read only the day files a period touches. Summaries
live in `$.store`, capped at 1,000 windows and 3,000 sessions to stay far below its 4 MiB limit.

**Serialized writes.** Parallel subagents can finish together. Each record goes through one promise queue,
so the read-modify-write of the store and files never interleaves within a session.

**Registration can fail without breaking the rest.** If registering commands or tools fails, counting, the
band and the resume clock still start.

**Pure modules.** The engine follows `$` only into functions declared in the hooks module. All logic other
than I/O sits in pure modules (`ledger`, `pause`, `report`, `bars`, `csv`, `format`, `view`), which the
unit tests cover directly.

## Known limits

- Two sessions finishing a request at the same instant can race on the summaries in `$.store`. Per-request
  CSV rows are unaffected.
- Model calls made by other plugins through `$.model.complete` aren't counted.
- An auto-resume needs Claude Code running and the computer awake. A sleep delays it until the next tick
  after waking.
