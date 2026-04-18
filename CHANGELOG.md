# Changelog

## [Unreleased]
- **Refactor**: Redesigned ACP↔MCP bridge with a robust queue/router model
  - Implemented per-session FIFO tool-call queues and Bearer token isolation for the singleton MCP server.
  - Extended router lifetime to persist across `done="toolUse"` handoffs within the same logical prompt.
  - Added explicit terminal cleanup logic to detach routers and fail stale requests on `stop`, `error`, or `abort`.
  - Switched to a single-instance HTTP server with UUID-based opaque paths for enhanced security and efficiency.
- **Breaking**: Completely removed `Alt+1~9` individual carrier shortcuts
- **Feature**: Added Git remote update detection to `welcome` extension
  - Automatically checks if the current branch is behind its remote tracking branch
  - Displays `✓ Up to date (branch)` in green (#A8D08D) when synchronized
  - Displays `⚠ Update available` in orange (#FFB347) with commit count when behind
- **Feature**: Introduced inline slot navigation
  - `Alt+H / Alt+L`: Move cursor to left/right slots within the Fleet Bridge panel
  - `Ctrl+Enter`: Immediately activate the carrier at the current cursor position in Exclusive mode
- **Feature**: Introduced Dynamic CliType Overrides
  - Press `c` key in `Alt+O` (Fleet Status Overlay) to immediately change the CLI type (Claude/Codex/Gemini) of a specific carrier
  - Changed settings are permanently saved in `states.json` and maintained after session restart
  - Changes to CLI type are immediately reflected in the model's theme color and sorting order
- **UX**: Added visual highlight to the cursor position slot (`▸` prefix + highlight color)
- Merged unified-agent-status functionality into the status subpackage inside unified-agent-direct, and cleaned up to display each CLI status inline in the footer
- Added basic functionality
