# Changelog

All notable changes to this project will be documented in this file.
This format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- **Phase 1 Restructure — Scope Triage + Mandatory Reconnaissance**: Split Fleet Action Protocol Phase 1 into two sub-phases: Phase 1a (Scope Triage) limits Admiral-direct file reads to ~2 files for scope classification only; Phase 1b (Vanguard Mandatory) requires Vanguard reconnaissance via `carrier_squadron` when 3+ files or modules are involved or scope is unclear.
- **Delegation Policy — Tighter Direct Handling Threshold**: Reduced "Handle directly" file lookup limit from ~5 to ~2 files (scope triage only). Lowered investigation delegation threshold from 6+ to 3+ files. Vanguard reconnaissance is now mandatory when scope remains unclear after triage.
- **Anti-pattern Addition**: Added "Reading 3+ files directly to gather context instead of sortieing Vanguard/Tempest" to the Delegation Policy anti-patterns list.
- **JobStreamArchive Read-Many Policy**: Full archived results via `carrier_jobs` are no longer invalidated after the first read. Both summary cache and full archive now share the same read-many semantics with a 3-hour TTL. `getAndInvalidate()` renamed to `getFinalized()`.

### Fixed
- **Thought Block Test Alignment**: Two `carrier-job-shared` tests that expected thought blocks in the archive now correctly reflect the thought-exclusion policy introduced in v0.3.2.

## [0.3.2] - 2026-04-27

Release v0.3.2

## [0.3.1] - 2026-04-26

### Changed
- **Dev Mode RISEN Prompt**: Boot extension now injects a RISEN (Role-Instructions-Steps-EndGoal-Narrowing) prompt for pi-fleet development via `before_agent_start` when running `fleet-dev`. Fleet persona/role/tone sections are skipped in dev mode.
- **System Prompt Registration via `before_agent_start`**: Removed `setCliSystemPrompt`/`getCliSystemPrompt` globalThis bridge entirely. All system prompt registration now uses pi's `before_agent_start` Append pattern (boot → fleet → grand-fleet order).
- **Function Renames**: `buildAcpSystemPrompt` → `buildSystemPrompt`, `buildAcpRuntimeContext` → `buildRuntimeContextPrompt`.
- **Prompt Section Tags**: Unified individual XML tags (`<fleet_role>`, `<fleet_persona>`, etc.) into `<fleet-system section="...">` tag format.

### Added
- **Log Category Registry**: Introduced pre-registration system for log categories. Unregistered category logs are silently ignored. Categories can be toggled on/off via `fleet:log:settings` and `fleet:log:category` slash commands.
- **System Prompt Logging**: Full system prompt is now logged under the `acp-system-prompt` category on each ACP request (`hideFromFooter` applied).
- **Documentation Links**: Added `docs/` directory links to README.

## [0.3.0] - 2026-04-26

### Changed
- **`<system-reminder>` Doctrine Realignment**: Restricted `<system-reminder>` wrapping to `pi.sendMessage`-delivered carrier completion pushes only.
    - Synchronous tool responses — launch acceptance text and `carrier_jobs` `notice` field — are now returned as plain text without any XML wrapping.
    - Completion pushes now carry a `source="carrier-completion"` attribute on `<system-reminder>` so the Admiral can identify framework-delivered carrier completion events.
    - `LAUNCH_REMINDER_TEXT` renamed to `JOB_LAUNCH_NOTICE` and compressed to a 2-sentence plain-text guidance referencing the new push attribute.
    - `wrapSystemReminder(text, attrs?)` signature extended to accept optional XML attributes; sole production caller is now `_shared/push.ts`.

## [0.2.0] - 2026-04-26

### Added
- **Carrier Jobs In-band Guidance**: Added a `notice` field to `carrier_jobs` responses for active jobs to deter LLMs from unnecessary polling.
    - Notices are now written in imperative form (e.g., "Stop calling tools now") and wrapped with `wrapSystemReminder` (`<system-reminder>` tag) to ensure LLM compliance.
    - `ACTIVE_STATUS_NOTICE`: Mode-agnostic guidance to wait for the `[carrier:result]` push; reinforces that the push wakes the agent even after the current response ends.
    - `ACTIVE_CANCEL_NOTICE`: Guidance when cancellation fails, clarifying that long-running jobs are expected and the job is not hung.
- **Push Delivery Mode Configuration**:
    - New slash command `/fleet:jobs:mode` to switch between `followUp` (default) and `steer` (advanced) push delivery modes.
    - SettingsOverlay (Alt+/) integration for "Push Mode" selection.
    - Persistent configuration in `~/.pi/fleet/settings.json` under the `fleet-push-mode` section.

### Changed
- **Improved Retry Guidance**: Updated the `retry_after` message for active job results to explicitly instruct against manual retries, reinforcing reliance on the automatic push mechanism.
- **Dynamic Push Delivery**: The `carrier-result` push delivery mode is now dynamic and respects the user-configured setting (defaulting to `followUp`).

## [0.1.3] - 2026-04-26

Tactical Steel rebranding + Ohio commission.

### Added
- **Asynchronous Carrier Operations**: `carriers_sortie`, `carrier_taskforce`, and `carrier_squadron` now operate in fire-and-forget mode.
- **New `carrier_jobs` Meta Tool**: Introduced for managing detached carrier jobs with actions: `status`, `result`, `cancel`, and `list`.
- **Job Stream Archive**: Centralized storage for detached job outputs with 3-hour TTL and 8MB/2000-block capacity limits.
- **Result Push Mechanism**: Framework now pushes `[carrier:result]` signals to notify the Admiral of job completion.
- New `Ohio` carrier (CVN-10, Codex CLI) — sole receiver of `plan_file` (under `.fleet/plans/*.md`), executes WBS waves end-to-end.
- Global executable commands (`fleet`, `gfleet`, `fleet-dev`, `gfleet-dev`).
- CI workflow to auto-tag main pushes with CHANGELOG section as annotated message.
- Pull request template (`.github/PULL_REQUEST_TEMPLATE.md`).
- Admiral workflow reference documentation (`docs/admiral-workflow-reference.md`).

### Changed
- **Worldview-aware `<fleet_role>`**: When the `metaphor.worldview` toggle is OFF, `buildAcpSystemPrompt()` now injects a neutral role prompt (`FLEET_ROLE_PROMPT_NEUTRAL`) that drops naval honorifics, report-form enforcement, and Bridge/Helm metaphors while preserving functional contracts (carrier delegation, pi-tools lazy-loading awareness, Korean-only responses). Persona/tone overlays remain gated by the same toggle.
- **Worldview-aware Grand Fleet role prompts**: When the `metaphor.worldview` toggle is OFF, `extensions/grand-fleet/prompts.ts` now switches Admiralty/Fleet/Fleet ACP role variants to neutral prompts, neutralizes Admiralty designation guidance, and only injects Fleet persona/tone into ACP base prompts when Grand Fleet context is omitted so metaphor tone no longer leaks through worldview-disabled paths.
- **Metaphor Domain Integration**: Unified `improve-prompt` into `directive-refinement` and migrated it to the `metaphor` extension domain.
    - New Settings Path: `metaphor.directiveRefinement` (replaces legacy `core-improve-prompt`).
    - New Slash Command: `fleet:metaphor:directive`.
    - Integrated **3-section (3섹션)** Output Format: Refined directives now follow a structured "Directive / Rationale / Residual Risks" markdown schema.
    - Updated documentation (`AGENTS.md`, `SETUP.md`) to reflect the new naval hierarchy domain boundaries.
- **Tool Contract Refactoring**: Carrier tools now return a `job_id` immediately instead of waiting for full execution.
- **Read-Once Result Policy**: Full archived results via `carrier_jobs` are now invalidated after the first successful retrieval to manage memory footprint.
- Renamed `Oracle` → `Nimitz` (CVN-09, Strategic Command & Judgment, read-only).
- Renamed `Athena` → `Kirov` (CVN-02, Operational Planning Bridge, plan_file author).
- Renamed `Echelon` → `Tempest` (CVN-07, Forward External Intelligence Strike).
- Genesis reverted to single-shot implementation; `plan_file` request block and related principles removed.
- Admiral delegation doctrine replaced "Oracle vs Athena Decision Flow" with "Nimitz → Kirov → Ohio 3-Step Strike Pipeline".
- Reorganized keybind overlay categories for better clarity:
    - `Alt+M` (metaphor-directive-refinement `refine-directive`): `Meta Prompt` → `Metaphor`.
    - `Alt+T` (bridge `launch`): `Bridge` → `Fleet Bridge`.
    - `Alt+O` (fleet `carrier-status`): `Fleet` → `Fleet Bridge`.
- Updated Fleet Bridge status bar hints (`PANEL_MULTI_COL_HINT` and `PANEL_DETAIL_HINT`) by removing retired `alt+x cancel` and `alt+shift+m model` references.
- Refreshed README structure and renamed Agent Panel to Fleet Bridge.
- Split grand fleet role pipelines and fleet wiring, and tightened Kirov planning contract.

### Fixed
- Restored ACP session resume.
- Serialized fleet state writes to prevent race conditions.

### Removed
- `Alt+S` (core-hud `stash`): Removed editor text stashing/restoration and associated session/agent lifecycle management.
- `Alt+Shift+M` (fleet `model-change`): Removed shortcut for changing carrier models. Operators should use the `fleet:agent:models` slash command or the `Alt+O` settings overlay instead.
- `Alt+R` (core-improve-prompt `reasoning-cycle`): Removed meta-prompt reasoning level cycle shortcut. Reasoning levels can still be adjusted via `fleet:prompt:settings`.
- `Alt+X` (fleet `carrier-cancel`): Removed operation cancellation shortcut and retired the underlying abort controller infrastructure (`abortCarrierRun`, `RunnerState`).
- Removed the obsolete root-level `models.json`; model registry data remains in `packages/unified-agent/models.json`.
- `oracle.ts`, `athena.ts`, `echelon.ts` carrier definitions (replaced by `nimitz.ts`, `kirov.ts`, `tempest.ts`).

### Notes
- `states.json` entries keyed by retired carrier IDs are dropped at next boot (no migration code added).

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
