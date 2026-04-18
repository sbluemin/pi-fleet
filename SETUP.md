# Setup

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated

## 0. Install pi-coding-agent

```bash
npm install -g @mariozechner/pi-coding-agent
```

## 1. Clone the repository

```bash
git clone https://github.com/sbluemin/pi-fleet.git
cd pi-fleet
```

## 2. Install dependencies

```bash
# Install all workspace dependencies from the repository root
npm install
```

> The repository uses npm workspaces, so a single root `npm install` installs dependencies for `packages/unified-agent`, `extensions/core`, `extensions/core/agentclientprotocol`, `extensions/core/shell`, and `extensions/fleet` together.
>
> The root `postinstall` script runs `npm run build -w packages/unified-agent`, so `packages/unified-agent` is built automatically after install. The bootstrap flow no longer relies on the package-local `prepare` script.
>
> `extensions/core/` and `extensions/fleet/` consume `@sbluemin/unified-agent` from the workspace during root install, so no per-package `npm install` step is required.

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
> - `extensions/core/` — single infrastructure extension whose root `index.ts` wires keybind, settings, log, welcome, hud, shell, improve-prompt, summarize, thinking-timer, provider-guard, and acp-provider modules
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
- `Alt+X` to cancel active carrier execution
- Claude Code, Codex CLI, Gemini CLI are each authenticated
