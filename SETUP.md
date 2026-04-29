# Setup

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated

## 0. Install pi-coding-agent

```bash
npm install -g @mariozechner/pi-coding-agent
```

## 1. Clone the repository

Before cloning, ask the user whether it is okay to clone the repository under the current working directory. If not, ask for the desired parent directory and clone it there instead.

> The example below assumes the current directory has been approved by the user.

```bash
git clone https://github.com/sbluemin/pi-fleet.git
cd pi-fleet
```

## 2. Install dependencies

```bash
# Install all workspace dependencies from the repository root.
# The root postinstall hook also builds packages/unified-agent, packages/fleet-core,
# and packages/pi-fleet-extension.
npm install

# Register the fleet wrapper commands globally.
npm link
```

> The repository uses npm workspaces, and the root install is the single setup entry point.
>
> `npm install` installs the workspace dependencies for `packages/unified-agent`, `packages/fleet-core`, and `packages/pi-fleet-extension`, then builds all three workspace packages via the root `postinstall` hook so the PI extension can consume current local artifacts immediately.
>
> `npm link` registers the global wrapper commands from this checkout:
>
> - `fleet` — launches `pi` with the standard Fleet mode.
> - `fleet-exp` — launches standard Fleet mode with `PI_EXPERIMENTAL=1` enabled for the child process.
> - `gfleet` — launches `pi` with Grand Fleet mode enabled for the child process.
> - `fleet-dev` — launches standard Fleet mode, enables `PI_EXPERIMENTAL=1`, and loads `packages/pi-fleet-extension/src/index.ts` directly from this checkout.
> - `gfleet-dev` — launches Grand Fleet mode, enables `PI_EXPERIMENTAL=1`, and loads `packages/pi-fleet-extension/src/index.ts` directly from this checkout.
>
> Fleet infrastructure, metaphor, carriers, and Agent Panel modules now live under `packages/pi-fleet-extension/src/`; they do not require separate `npm install` commands.

## 3. Register extensions in pi settings

Add the `extensions` field to your pi settings file, pointing to the Fleet PI extension entry.

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
> - Development entry: `packages/pi-fleet-extension/src/index.ts`
> - Built entry after `npm run build -w packages/pi-fleet-extension`: `packages/pi-fleet-extension/dist/index.js`
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
