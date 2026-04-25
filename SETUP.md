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
# The root postinstall hook also builds packages/unified-agent.
npm install

# Register the fleet wrapper commands globally.
npm link
```

> The repository uses npm workspaces, and the root install is the single setup entry point.
>
> `npm install` installs the workspace dependencies for `packages/unified-agent`, `extensions/core`, and `extensions/fleet`, then builds `packages/unified-agent/dist/` via the root `postinstall` hook so the extensions can consume `@sbluemin/unified-agent` immediately.
>
> `npm link` registers the global wrapper commands from this checkout:
>
> - `fleet` — launches `pi` with the standard Fleet mode.
> - `gfleet` — launches `pi` with Grand Fleet mode enabled for the child process.
> - `fleet-dev` — launches standard Fleet mode and loads each `extensions/*/index.ts` entry directly.
> - `gfleet-dev` — launches Grand Fleet mode and loads each `extensions/*/index.ts` entry directly.
>
> `extensions/core/shell` and `extensions/core/agentclientprotocol` are internal modules of the `extensions/core` workspace, so they no longer require separate `npm install` commands.

## 3. Register extensions in pi settings

Add the `extensions` field to your pi settings file, pointing to the extension directories.

**Global** (`~/.pi/agent/settings.json`):

```json
{
  "extensions": [
    "<path-to-pi-fleet>/extensions"
  ]
}
```

> Replace `<path-to-pi-fleet>` with the actual path where you cloned the repository.
>
> - `extensions/` — unified extension root. pi discovers the nested extension entry points under this directory.
> - `extensions/core/` — single infrastructure extension whose root `index.ts` wires keybind, settings, log, welcome, hud, shell, improve-prompt, thinking-timer, provider-guard, and acp-provider modules
> - `extensions/fleet/` — agent orchestration extension (carrier framework SDK, Admiral/Bridge/Carrier wiring, Agent Panel, unified pipeline)
> - `extensions/fleet/admiral/` — Admiral prompt-policy library consumed by `fleet/index.ts`
> - `extensions/fleet/bridge/` — active ACP provider bridge library consumed by `fleet/index.ts`
> - `extensions/fleet/carriers/` — default carrier definitions consumed by `fleet/index.ts`
>
> With `extensions/` registered, pi discovers the extension entry points under that root, while `fleet/index.ts` internally wires the nested Admiral/Bridge/Carrier libraries.

## 4. Verify

Launch `pi` and run `/reload`, then check:

- No extension load errors in the output
- `unified-agent --help` displays help output correctly
- `unified-agent --list-models` shows the available model list
- `Alt+H` / `Alt+L` to move cursor between carrier slots
- `Ctrl+Enter` to activate the carrier at cursor (exclusive mode)
- `Alt+P` to toggle the Agent Panel
- Claude Code, Codex CLI, Gemini CLI are each authenticated
