# Setup

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated

## 0. Install pi-coding-agent and pnpm

```bash
# pi-coding-agent provides the `pi` runtime.
npm install -g @mariozechner/pi-coding-agent

# pnpm is the package manager for this repository.
npm install -g pnpm
```

> The repository is pinned to a specific pnpm version via the `packageManager` field in `package.json`. If you have [Corepack](https://nodejs.org/api/corepack.html) enabled, that version is used automatically; otherwise the globally installed pnpm is used as a fallback.

## 1. Clone the repository

Before cloning, ask the user whether it is okay to clone the repository under the current working directory. If not, ask for the desired parent directory and clone it there instead.

> The example below assumes the current directory has been approved by the user.

```bash
git clone https://github.com/sbluemin/pi-fleet.git
cd pi-fleet
```

## 2. Install dependencies and register global commands

```bash
# One-time per machine: configure the pnpm global bin directory and add it to PATH.
# Skip if `pnpm setup` was already run on this machine (PNPM_HOME is set).
pnpm setup

# After `pnpm setup`, open a new terminal so PNPM_HOME and PATH take effect, then cd back.
# (In the same terminal you can also `export PNPM_HOME="$LOCALAPPDATA/pnpm"` on Windows
# or `export PNPM_HOME="$HOME/Library/pnpm"` on macOS / `"$HOME/.local/share/pnpm"` on Linux,
# and `export PATH="$PNPM_HOME:$PATH"` to use it without restarting the shell.)

# Install all workspace dependencies. The root postinstall hook runs `pnpm -r build`,
# which builds packages/unified-agent, packages/fleet-core, packages/fleet-wiki,
# and packages/pi-fleet-extension in topological order.
pnpm install

# Approve native build scripts (one-time per machine).
# Required for node-pty, esbuild, koffi, protobufjs, and @google/genai.
# The result is saved to pnpm-workspace.yaml `allowBuilds` — subsequent installs
# run these scripts automatically without a warning.
pnpm approve-builds --all

# Register the fleet wrapper commands globally.
pnpm link --global
```

> The repository uses pnpm workspaces (see `pnpm-workspace.yaml`); the root install is the single setup entry point. `pnpm install` writes a single `pnpm-lock.yaml` at the repo root and links each workspace package's local dependencies via symlinks. Cross-package deps are declared with the `workspace:*` protocol so pnpm orders builds topologically.
>
> `pnpm link --global` registers the global wrapper commands from this checkout:
>
> - `fleet` — launches `pi` with the standard Fleet mode.
> - `fleet-exp` — launches standard Fleet mode with `PI_EXPERIMENTAL=1` enabled for the child process.
> - `gfleet` — launches `pi` with Grand Fleet mode enabled for the child process.
> - `fleet-dev` — launches standard Fleet mode, enables `PI_EXPERIMENTAL=1`, and loads `packages/pi-fleet-extension/src/index.ts` directly from this checkout.
> - `gfleet-dev` — launches Grand Fleet mode, enables `PI_EXPERIMENTAL=1`, and loads `packages/pi-fleet-extension/src/index.ts` directly from this checkout.
>
> Fleet infrastructure, metaphor, carriers, and Agent Panel modules now live under `packages/pi-fleet-extension/src/`; they do not require separate `pnpm install` commands.

## 3. Register extensions in pi settings

Add or update the `extensions` field in your pi settings file so it points to the Fleet PI extension entry in this checkout.

**Global** (`~/.pi/agent/settings.json`):

```json
{
  "extensions": [
    "<path-to-pi-fleet>/packages/pi-fleet-extension/src/index.ts"
  ]
}
```

> Replace `<path-to-pi-fleet>` with the actual path where you cloned the repository.
>
> **Update rules (for AI one-shot setup):**
>
> - **File or directory missing**: create `~/.pi/agent/` if needed, then write the JSON above.
> - **File exists without an `extensions` field**: add the field, preserving every other top-level field.
> - **`extensions` already contains a pi-fleet entry** (e.g. legacy `<path-to-pi-fleet>/extensions` from older checkouts, or any path under `<path-to-pi-fleet>/`): replace that entry with the path above. Do not append a duplicate.
> - **`extensions` references unrelated extensions**: keep them; only add or update the pi-fleet entry.
>
> **Entry options:**
>
> - Development entry: `packages/pi-fleet-extension/src/index.ts`
> - Built entry after `pnpm --filter @sbluemin/pi-fleet-extension build`: `packages/pi-fleet-extension/dist/index.js`
> - Product core: `packages/fleet-core/` contains Pi-agnostic runtime, public APIs, MCP/tool registry, job infrastructure, prompt policy, and metaphor logic.
> - PI extension adapter: `packages/pi-fleet-extension/src/` wires keybind, settings, log, welcome, HUD, shell, thinking-timer, provider guard, ACP provider modules, metaphor UI, carriers, Admiral/Bridge libraries, Agent Panel, and unified pipeline.
>
> PI settings accept TypeScript or JavaScript extension entries. Use the TypeScript entry for local development, or the built JavaScript entry after building the workspace package.

## 4. Verify

Launch `pi` and run `/reload`, then check:

- No extension load errors in the output
- `ait --help` displays help output correctly
- `ait --list-models` shows the available model list
- `Alt+H` / `Alt+L` to move cursor between carrier slots
- `Ctrl+Enter` to activate the carrier at cursor (exclusive mode)
- `Alt+P` to toggle the Agent Panel
- Claude Code, Codex CLI, Gemini CLI are each authenticated
