# Changelog

## [Unreleased]
- **Breaking**: Completely removed `Alt+1~9` individual carrier shortcuts
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
