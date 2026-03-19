# unified-agent-direct

Direct mode **framework** + Direct modes for 4 CLIs (claude/codex/gemini/all) + individual agent tools + model selection + status bar + agent panel.

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
| `index.ts` | Entry point: Registers 4 CLI modes, agent tools, model selection command, status bar |
| `framework.ts` | Public API (`registerCustomDirectMode`, `activateMode`, `onStatusUpdate`, etc.). Links agent panel on mode switch |
| `constants.ts` | Shared constants (colors, spinners, border characters, panel colors) |
| `agent-panel.ts` | Agent panel state management + API (`setAgentPanelMode`, `show/hide/toggle`, `startStreaming/stop`, `beginCol/endCol`, `updateCol`) |
| `streaming/mirror.ts` | Single accumulation point for streaming data + Agent panel column bridge (`createStreamingMirror`, `CollectedStreamData`) |
| `streaming/router.ts` | Streaming output router — routes to mirror and/or standalone widget based on panel state, delegates data access to mirror |
| `render/message-renderers.ts` | Default user/response message renderer factory (for chat history) |
| `render/panel-renderer.ts` | Agent panel rendering (`renderPanelFull`, `renderPanelCompact`, `renderModeBanner`), `AgentCol` type |
| `render/ui-utils.ts` | TUI utilities (`makeBorderLine`, `wrapWithSideBorder`, `buildStreamingPreview`) |
| `tools/index.ts` | Registers `claude`, `codex`, `gemini` as individual pi tools with streaming widget |
| `tools/streaming-widget.ts` | Streaming widget renderer for tool execution (`createStreamingWidget`, composite widget manager) |
