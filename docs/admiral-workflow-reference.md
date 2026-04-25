# Admiral Workflow Reference

> This document is a **reference for future Admiral sessions**.
> Each Admiral session is backed by a different LLM instance (Claude / Codex / Gemini),
> and LLMs frequently forget or misassume the non-obvious constraints of the PI codebase.
> Before starting any task, you **must** re-read **§4 PI Agent Loop Constraints**,
> **§7 Fire-and-Forget Essence**, and **§12 Common LLM Pitfalls**.
>
> Code-line citations are intentionally minimised — code changes, but the workflow and
> doctrine survive. When you need concrete files or functions, consult the
> `extensions/fleet/AGENTS.md` hierarchy.

---

## 1. Role hierarchy

```
Admiral of the Navy   = the user (project owner) — the source of all PI TUI input.
   │
   │ orders
   ▼
Admiral               = the main LLM session running inside PI host (claude/codex/gemini).
   │                    ─ This is "you", the reader of this document.
   │ tool_use
   ▼
Captain / Carrier     = a separate ACP CLI process (its own LLM instance).
                        ─ Eight Captain personas (Nimitz · Kirov · Genesis · Ohio · Sentinel ·
                          Vanguard · Tempest · Chronicle) are defined under carriers/.
```

Key asymmetry:
- **Exactly one Admiral** instance exists. It is "active" only while it is streaming a turn.
- **Many Carrier** instances may exist concurrently, each with its own ACP session.
- The Admiral's active-run lifecycle and a Carrier's active-run lifecycle are **independent**.

---

## 2. Operational tool surface (immutable)

These four tools are the **only** carrier delegation surface. Names and schemas are fixed
as doctrine units:

| Tool | Semantics | Input shape (conceptual) |
|------|-----------|--------------------------|
| `carriers_sortie` | Distribute work to **heterogeneous carriers** | N carriers × 1 request each |
| `carrier_squadron` | Fan out N subtasks on a **single carrier** | 1 carrier + N subtasks |
| `carrier_taskforce` | Cross-validate one carrier persona across **≥2 CLI backends** | 1 carrier + 1 request |
| `carrier_jobs` | **Meta tool** — no doctrine of its own | action: status / result / cancel / list |

> ⚠️ Do not consolidate, shrink, or rename these four. Tool surface = doctrine unit (invariant).

---

## 3. End-to-end flow: user input → result delivery

```
[Admiral of the Navy]                                     PI TUI
   │ keystroke / slash command
   ▼
[PI host process]
   │ admin LLM is invoked (active run begins)
   ▼
[admin LLM]
   │ streams a response and decides on a tool_use
   ▼
[carrier delegation tool execute()]
   │ 1. validate
   │ 2. concurrency-guard.acquire (busy reject / cap 5)
   │ 3. createJobArchive
   │ 4. void runJobInBackground(...)         ← NOT awaited
   │ 5. return { job_id, accepted: true }    ← immediate (FIFO HEAD drained)
   ▼
[admin LLM]
   │ receives {job_id} and either ends the turn or issues another tool call
   ▼
[admin idle]                                              ─ active run terminates
   ⋮
   ⋮  (the background promise is still running, on its own time axis)
   ⋮
[background promise]
   │ runAgentRequestBackground(cwd snapshot, no admin ctx)
   │   → ACP/MCP → carrier CLI → stream chunks / tool_call events
   │   → dual-write to stream-store (UI) and JobStreamArchive (AI)
   │ finalize
   │ LRU summary put
   │ enqueue completion push
   ▼
[push: pi.sendMessage(custom, display:false, triggerTurn:true)]
   │ <system-reminder>
   │   [carrier:result] {jobId} {summary}
   │ </system-reminder>
   ▼
[admin LLM]                                               ─ a fresh active run
   │ recognises the system-reminder and produces a response
   │ may call carrier_jobs(action:"result") to absorb full detail
   ▼
[natural-language report to the Admiral of the Navy]
```

**Key observations**:
- An Admiral turn is *short* — every tool call resolves immediately.
- Carrier work proceeds on a **separate time axis** (seconds to minutes).
- The only automatic channel that re-couples those two axes is the **push (`triggerTurn:true`)**.

---

## 4. PI Agent Loop core constraints (must internalise)

### 4-1. Active Run

> The PI agent loop is in an "active run" only while the admin LLM is streaming a response.
> If a registered listener fires after the active run has ended, the SDK throws
> `Agent listener invoked outside active run` as a fail-fast guard.

Implications:
- While the Admiral is idle, PI itself cannot invoke admin-LLM-related listeners.
- Any `setInterval` that ends up calling an admin LLM listener will throw once the run ends.
- Background promises in carrier tools **must not couple to admin agent listeners**.

### 4-2. FIFO serialisation (provider-mcp)

> MCP tool calls between the CLI backends and the PI host are serialised by `toolCallId`
> in a per-session FIFO queue. Within a single admin session, only one tool is awaited
> at a time.

Implications:
- Multiple tool calls in the same admin turn are processed **sequentially**.
- When a carrier delegation tool resolves immediately, the FIFO HEAD is drained at once,
  allowing the next tool call to flow.
- **The FIFO is intentional**, protecting the ACP/MCP contract (toolCallId ordering and
  HTTP stream state). Do not change it.

### 4-3. ExtensionContext (admin ctx)

> The `ctx` parameter passed to a tool's `execute` is an object **bound to the Admiral's
> lifecycle**. If a background promise captures and reuses it, you will trigger stale
> calls once the Admiral becomes idle.

Implications:
- Background code **must not** call `ctx.ui.*` or `ctx.sessionManager.*`.
- Background has no admin ctx — it relies only on fleet-owned globalThis assets
  (stream-store / archive / LRU / log API).
- Only the foreground synchronous path may use ctx (operation-runner's dual-mode split).

---

## 5. Meaning of the ACP/MCP bridge

```
PI host process (single)
 │
 ├─ in-process MCP HTTP server (127.0.0.1, opaque path, bearer token)
 │   └─ pendingToolCalls: Map<sessionToken, FIFO queue>
 │
 ├─ AcpConnection × N  (one per carrier id, ACP stdio)
 │
 └─ CLI process × N    (claude / codex / gemini)
     │
     └─ issues tool calls back to PI over MCP HTTP
```

Key facts:
- **Carrier ACP sessions are independent of the Admiral's LLM session**, each with its own
  active run.
- `sessionUpdate` events from a carrier (text / thought / toolCall) flow over the carrier
  ACP channel into PI and accumulate in stream-store and archive.
- The Admiral LLM does **not** receive carrier-session streams directly — fleet-owned
  stores act as the relay.

---

## 6. What each delegation tool actually does

| Tool | When it answers the Admiral | What runs inside |
|------|-----------------------------|------------------|
| `carriers_sortie` | **Immediately** ({job_id, accepted}) | Distributes the request to N carriers, each on its own ACP session. The background promise collects results via `Promise.allSettled`. |
| `carrier_squadron` | **Immediately** | Fans out N subtasks on a single carrier persona. |
| `carrier_taskforce` | **Immediately** | Runs one carrier persona on ≥2 CLI backends concurrently for cross-validation. |
| `carrier_jobs` | Returns immediately (simple LRU/archive lookup) | No background work. Pure meta tool. |

> ⚠️ Only `carrier_jobs` is a truly synchronous tool. The other three are fire-and-forget.

---

## 7. The fire-and-forget essence

> **A carrier delegation tool's response is not "the result" — it is a "job acceptance receipt".**

Response schema (immutable):
```
{ job_id: string, accepted: boolean, error?: string }
```

There are exactly two paths that deliver the actual work result:
1. **Push** — when the job finishes, the framework auto-delivers a `<system-reminder>`-wrapped
   follow-up custom message to the Admiral. `triggerTurn: true` even wakes an idle Admiral.
2. **carrier_jobs** — explicit lookup by the Admiral. In normal operation this is a fallback
   for missed pushes or detail confirmation.

> ⛔ **Do not poll `carrier_jobs(action:"status")` immediately after launch.** The push
> mechanism notifies you automatically, so polling burns admin context and tokens.
> Doctrine: "If there is independent work, do it; otherwise wait."

---

## 8. UI rendering flow

```
admin streaming OR active background job > 0
 │
 ▼
panel/lifecycle: animTimer (100 ms) — increments frame
 │
 ▼
panel/widget-sync: applyWidgetSync(ctx)
   ├─ aboveEditor single line (carrier status spinner) — directly above the input box
   └─ main panel widget (when expanded — Alt-O, etc.)
 │
 ▼ (graceful skip when ctx is stale or outside active run)
PI render
```

**The carrier panel reads its content from stream-store.**
**JobStreamArchive is exclusively for `carrier_jobs`** — the panel UI never reads from
the archive (separation doctrine).

---

## 9. The intentional separation of two stores

|  | stream-store | JobStreamArchive |
|--|--|--|
| Purpose | **UI rendering only** | **AI (admin LLM) lookup only** |
| Key | carrierId | jobId (PI toolCallId) |
| Lifecycle | Tied to panel display | TTL 3 h, finalised at job end, invalidated after a full read |
| Serialisation | Includes ANSI colour (terminal) | LLM-friendly markdown (ANSI stripped + redacted) |
| Storage policy | All chunks | text/thought only (tool_call filtered, secrets redacted at append) |

> ⛔ Never source AI-lookup data from stream-store. The two stores are deliberately split.

---

## 10. Result delivery — the push mechanism

```
job completion
 │
 ▼
2 s batching window — multiple completions in the same session are merged into one push
 │
 ▼
pi.sendMessage({
  customType: "carrier-result",
  content: <system-reminder>
    [carrier:result] {jobId} {tool}: {summary}
  </system-reminder>,
  display: false,                ← not rendered in TUI
  details: { jobIds, summaries },
}, {
  triggerTurn: true,             ← guarantees idle-Admiral wake-up
  deliverAs: "followUp",
});
 │
 ▼
admin LLM begins a new turn — it must recognise the system-reminder as a framework signal
                              (not user input — encoded as doctrine in admiral/prompts.ts)
```

> Thanks to `display: false`, the Admiral of the Navy never sees the push in the TUI.
> The Admiral LLM still receives it in context — `CustomMessage` is forwarded to the LLM
> by `transformToLlm`.

---

## 11. Invariants — verify before every change

| # | Invariant |
|---|-----------|
| 1 | **Tool surface = doctrine unit** — the four tool names and schemas are immutable. ToolPromptManifest 1:1. |
| 2 | **Carrier calls are fire-and-forget** — no synchronous response path exists. Response schema is `{job_id, accepted, error?}`. |
| 3 | **Background ⊥ admin ExtensionContext** — background promises must never capture the admin ctx. |
| 4 | **`provider-mcp.ts` FIFO is frozen** — preserves the ACP/MCP contract. |
| 5 | **Avoid pi-coding-agent SDK changes** — fixes live in fleet-owned code. |
| 6 | **No persistence** — process-level globalThis only. Archive, cache, and verbose state are lost on extension reload (acceptable). |
| 7 | **stream-store (UI) ⊥ JobStreamArchive (AI)** — keys, lifecycles, and serialisation are all separate. |
| 8 | **Archive policy** — text/thought only, tool_call filtered, secret redaction at append boundary, head 20 + tail 50 + truncated marker, TTL 3 h, summary read-many · full read-once. |
| 9 | **Push** — `pi.sendMessage` custom + `display:false` + `<system-reminder>` wrapping + `[carrier:result]` prefix. `triggerTurn:true` for idle wake-up. |
| 10 | **Animation tick** — alive while admin is streaming OR an active background job exists. Graceful skip is reserved for stale ctx only. |

---

## 12. Common LLM pitfalls (re-read every time)

> Re-read this section before every task.

### Pitfall 1 — "If I call the tool, I'll get a synchronous result."
**Wrong.** Carrier delegation tools are fire-and-forget. The response is only
`{job_id, accepted}`. The actual result arrives via push (automatic) or `carrier_jobs`
(manual).

### Pitfall 2 — "I should poll `carrier_jobs` status right after launch."
**Unnecessary.** Push notifies you automatically. Polling wastes admin context and tokens.
Do other independent work, or just wait.

### Pitfall 3 — "Maybe the background promise can use ctx too."
**Forbidden.** While the Admiral is idle, ctx becomes stale and triggers
"Agent listener invoked outside active run". Background code uses only fleet-owned
globalThis assets (stream-store / archive / LRU / log).

### Pitfall 4 — "Let me read AI-facing data from stream-store."
**Forbidden.** stream-store is UI-only. AI lookups go through JobStreamArchive.
Their serialisation, keys, and lifecycles all differ.

### Pitfall 5 — "Tool-call details should be in the archive."
**They aren't.** `tool_call` blocks are intentionally filtered out of the archive.
Tool-call statistics are kept only as `toolCallCount` in the summary metadata.

### Pitfall 6 — "Secrets are auto-redacted, so storing raw is fine."
**Conditionally safe.** A secret split across chunk boundaries can bypass per-chunk
redaction. Real redaction is applied after merging at append time. Be aware of this
boundary when adding new code.

### Pitfall 7 — "The user is reading the carrier_jobs output, so verbose is fine."
**No.** `carrier_jobs` defaults to **Quiet** — a single line, with detail hidden.
Verbose is enabled only by the explicit `/fleet:jobs:verbose on` toggle.
The Admiral of the Navy does not see pushes either (`display:false`).

### Pitfall 8 — "Lifting the concurrency cap will be faster."
**A violation.** The cap of 5 simultaneous detachments is a hard cap (protecting
carrier resources and admin context). A duplicate call to a busy carrier is rejected
(`carrier busy`) — never queued.

### Pitfall 9 — "If I bypass invariant 4, cross-tool parallelism becomes possible."
**No structural effect.** Even if you remove the provider-mcp FIFO, the PI agent loop
awaits one tool at a time inside `ToolExecutionComponent`. Real parallelism would
require an SDK change, which directly conflicts with invariant 5.

### Pitfall 10 — "Fire-and-forget means the user can't see progress."
**Wrong.** The carrier panel reflects progress in real time via stream-store. The
single-line status above the input box keeps spinning while a background job is
active. User-facing visibility is preserved.

---

## 13. Pre-task checklist

If your change touches the fleet/shipyard area, walk through this list before you start.

- [ ] Does the change touch any of the **four tool surfaces**? → Forbidden (invariant 1).
- [ ] Does it modify the **launch response schema** (`{job_id, accepted, error?}`)? → Forbidden (invariant 2).
- [ ] Does it introduce **ctx usage on the background path**? → Forbidden (invariant 3).
- [ ] Does it produce a diff in **`provider-mcp.ts`**? → Forbidden (invariant 4).
- [ ] Does it produce a diff in the **pi-coding-agent SDK**? → Forbidden (invariant 5).
- [ ] Does it add any new **persistence** (file/DB)? → Requires a separate doctrine decision (invariant 6).
- [ ] Does it read AI-lookup data from **stream-store**? → Forbidden (invariant 7).
- [ ] Does it re-store **tool_call** in the archive or move redaction to the chunk stage? → Forbidden (invariant 8).
- [ ] Does it use `pi.sendUserMessage` for push? → Forbidden — use `pi.sendMessage` (custom) instead (invariant 9).
- [ ] Does it tie the panel animation timer to admin streaming alone? → Forbidden — must include active background jobs (invariant 10).

---

## 14. Operational telemetry (recommended observation)

The implementation is complete; doctrine tuning becomes more precise as field telemetry
accumulates.

- carrier work duration distribution (p50 / p90 / p99)
- push round-trip latency
- archive memory footprint (rate of hitting the 8 MB cap)
- saturation rate of the detach concurrency cap (5)
- carrier-busy reject hit rate
- read-once invalidate races (hypothetical multi-Admiral scenarios)

When any of these crosses an escalation trigger, re-evaluate the relevant invariants
through the formal doctrinal procedure (Nimitz sortie).

---

## 15. Quick reference — module ownership

A layered map for finding the right place to work:

```
extensions/fleet/
├─ admiral/                    Standing Orders, Protocols, system-prompt SSOT
├─ shipyard/
│  ├─ carrier/                 carriers_sortie tool (fire-and-forget)
│  ├─ squadron/                carrier_squadron tool (fire-and-forget)
│  ├─ taskforce/               carrier_taskforce tool (fire-and-forget)
│  ├─ carrier_jobs/            meta tool (status/result/cancel/list, Quiet/Verbose render)
│  └─ _shared/                 shared infra (job-id, archive, serializer, LRU, push,
│                              concurrency-guard, job-cancel-registry, push-renderer,
│                              job-reminders)
├─ bridge/
│  ├─ panel/                   Panel UI (lifecycle animTimer, widget-sync graceful skip)
│  ├─ streaming/stream-store   Carrier-panel chunk store (UI only)
│  ├─ render/                  Block renderer
│  └─ carrier-ui/              Status overlay, status renderer (the aboveEditor line)
├─ carriers/                   Eight Captain personas (persona · request blocks · output format)
└─ operation-runner.ts         Dual mode: foreground (uses ctx) vs background (ctx-free)

extensions/core/agentclientprotocol/   ACP infrastructure (provider-mcp FIFO, executor, pool)
extensions/core/{hud,settings,keybind} Infrastructure
```

---

## 16. Update policy for this document

This document is the SSOT for **workflow and doctrine**. Update it when:

1. An invariant is added, modified, or retired (highest priority).
2. A new tool surface is added (currently 4 — update §2 and §6).
3. The user-input → result-delivery flow changes structurally (update §3, §10).
4. The push mechanism changes (update §10).
5. The PI SDK or ACP/MCP contract changes (update §4-2, §5).

> Code-line citations are intentionally minimised, so routine refactors do not require
> updating this document. Update only when workflow or doctrine itself changes.

---

**End of reference. Re-read §4 · §7 · §11 · §12 · §13 before starting any task.**
