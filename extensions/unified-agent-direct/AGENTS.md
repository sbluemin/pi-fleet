# unified-agent-direct

Direct mode **framework** + Direct modes for 4 CLIs (claude/codex/gemini/all) + model selection + status bar + agent panel.

## Core Rules

- State in `framework.ts` is **shared via `globalThis`** — Avoid module-level singletons as pi bundles each extension separately.
- `registerCustomDirectMode` is the public API.
- Mutual exclusivity between modes is automatically managed by the framework (`deactivateAll`).
- Model settings (`/ua-models`) are managed in this extension, and changes are notified via `notifyStatusUpdate()`.
- The status bar (`ua-status`) displays the current model/effort for all CLIs.
- The agent panel is the main UI for streaming — individual CLIs use exclusive view, 'All' uses a 3-split view.
- The panel frame color automatically changes based on the active mode.

## Architecture

### Agent Panel Centric Design

- **Removed existing border widget + animation** → All streaming UIs are integrated into the agent panel.
- **Exclusive View**: alt+1/2/3 → Full-width panel for the corresponding agent (thinking + tools + response).
- **3-Split View (Full)**: alt+0 → Simultaneous query to 3 agents, compact thinking/tools per column.
- **Compact View**: Panel collapsed + while streaming → 1-line status bar.
- **Frame Color**: Applies `DIRECT_MODE_COLORS` of the active mode (`PANEL_COLOR` when inactive).

## Module Structure

| File | Role |
|------|------|
| `index.ts` | Entry point: Registers 4 CLI modes (claude/codex/gemini/all), model selection command, status bar |
| `framework.ts` | Public API (`registerCustomDirectMode`, `activateMode`, `onStatusUpdate`, etc.). Links agent panel on mode switch |
| `constants.ts` | Shared constants (colors, spinners, border characters, panel colors) |
| `renderers.ts` | Default user/response message renderer factory (for chat history) |
| `ui-utils.ts` | TUI utilities (`makeBorderLine`, `wrapWithSideBorder`, `buildStreamingPreview`) |
| `agent-panel.ts` | Agent panel state management + API (`setAgentPanelMode`, `show/hide/toggle`, `startStreaming/stop`, `beginCol/endCol`, `updateCol`) |
| `agent-panel-renderer.ts` | Agent panel rendering (`renderPanelFull` — dynamic switch between 1 col/3 cols based on activeMode, `renderPanelCompact`), `AgentCol` type |
| `direct-panel-mirror.ts` | Individual CLI execution → Agent panel column streaming bridge (`createDirectPanelMirror`). Reflects thinking/tool calls/responses onto the panel |
