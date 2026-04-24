# Changelog

All notable changes to this project will be documented in this file.
This format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.2] - 2026-04-24

### Added
- `PI_EXPERIMENTAL` environment flag to opt into experimental extensions during boot.
- GPT-5.5 Codex model entry in `packages/unified-agent/models.json`.
- Provider-specific unified-agent clients for Claude, Codex, and Gemini.
- Codex app-server connection path with dedicated event and lifecycle coverage.
- Unified-agent provider contract E2E coverage.
- `/fleet:update` slash command in the welcome extension that instructs the active PI agent to pull the local `pi-fleet` checkout and apply the `SETUP.md` update steps.
- Prominent full-width update alert banner rendered above the welcome box when the local branch is behind its remote; replaces the duplicate right-column `Update available` block while active, and is fully hidden when up-to-date or no upstream is configured.

### Changed
- Split the monolithic `UnifiedAgentClient` implementation into provider-specific clients.
- Reworked ACP provider execution and stream handling around the new client contracts.
- Updated unified-agent examples, README, and AGENTS guidance for the provider-client architecture.
- Added `@anthropic-ai/claude-agent-sdk` as a root dependency.

### Fixed
- Echelon repo cloning now uses the OS-native temporary directory.
- Admiral prompts now explicitly require the `pi-tools` MCP availability check.
- Codex commentary events are routed as message chunks.
- Fleet bridge panel widget synchronization now detaches stale panel contexts.
- Welcome extension now renders the current branch name and Fleet version even when the local branch has no upstream configured.

### Removed
- Legacy `ProcessPool` implementation and related benchmark/pool tests.
- Legacy raw ACP session E2E test in favor of provider-level E2E coverage.

### Security
- Welcome extension sanitizes C0 / DEL / C1 control characters from `gitUpdate.branch` and `gitUpdate.version` before rendering to prevent terminal escape injection via crafted branch names or `package.json` version values. The original `GitUpdateStatus` object is not mutated — sanitization is display-only.

## [0.1.1] - 2026-04-23

### Added
- MCP keepalive mechanism (`provider-mcp.ts`): improved MCP server connection stability
- `diagnostics` extension extracted as a standalone module (`extensions/diagnostics/`): dedicated `dummy-arith` diagnostic tool
- Fleet version display in Welcome screen update status line (e.g., `Up to date (main) · v0.1.1`)
- ACP↔MCP bridge redesigned with a robust queue/router model
  - Per-session FIFO tool-call queues and Bearer token isolation for the singleton MCP server
  - Router lifetime preserved across `done="toolUse"` handoffs within the same logical prompt
  - Explicit cleanup logic on `stop`, `error`, or `abort`
  - Single-instance HTTP server with UUID-based opaque paths

### Changed
- Upgraded `pi-sdk` to 0.69 (`package.json`)
- Consolidated sub-package `package-lock.json` files (`core/agentclientprotocol`, `core`, `core/shell`, `fleet`) into the root and removed them
- Updated `SETUP.md` to reflect project setup and structural changes

### Fixed
- Windows: fixed Codex/Claude CLI `spawn` path error (`packages/unified-agent/src/utils/npx.ts`, `BaseConnection.ts`)
- Welcome extension: use `import.meta.url`-based `__dirname` instead of `process.cwd()` for git update check (`extensions/core/welcome/welcome.ts`)

## [0.1.0] - 2026-04-22

Initial release.

### Added
- **unified-agent package** (`packages/unified-agent/`): unified CLI agent SDK supporting Claude, Codex, and Gemini
  - Core components: `AcpConnection`, `UnifiedAgentClient`, `ModelRegistry`
- **Core extensions** (`extensions/core/`):
  - `agentclientprotocol`: ACP↔MCP bridge and tool-call management
  - `hud`: status bar customization (colors, editor state, git status, etc.)
  - `welcome`: welcome screen and Git remote update detection (`✓ Up to date`, `⚠ Update available`)
  - `keybind`, `settings`, `shell`, `log`, `summarize`, `improve-prompt`, `thinking-timer`: system utilities
- **Fleet extensions** (`extensions/fleet/`):
  - `admiral`: Admiral prompt system and Standing Orders
  - `bridge`: Fleet Bridge panel UI
    - Inline slot navigation: `Alt+H`/`Alt+L` (move), `Ctrl+Enter` (activate immediately)
    - Visual cursor highlight (`▸` prefix + highlight color)
    - Dynamic CliType Overrides: change CLI type instantly with `c` key in `Alt+O` overlay; saved permanently to `states.json`
  - `carriers`: 7 carrier definitions — Athena, Genesis, Oracle, Sentinel, Vanguard, Echelon, Chronicle
  - `shipyard`: Carrier sortie, Squadron, and Taskforce management
- **Grand Fleet extension** (`extensions/grand-fleet/`): centralized control of multiple PI instances with JSON-RPC IPC
- **Metaphor extension** (`extensions/metaphor/`): persona and worldview system
- **Boot extension** (`extensions/boot/`): system bootstrap entry point

### Removed
- Legacy modules removed: `unified-agent-core`, `unified-agent-direct`, `unified-agent-tools`, `utils-improve-prompt`, `utils-summarize`
- HUD legacy consolidation: `hud-core`, `hud-editor`, `hud-welcome` merged into `core/hud`

### Breaking Changes
- Removed `Alt+1~9` individual carrier shortcut keys (replaced by Fleet Bridge navigation)
