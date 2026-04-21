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

# Build the shared workspace package used by the extensions
npm run build -w packages/unified-agent

# Workaround: npm 10.x skips deps for workspaces nested inside another
# workspace (`extensions/core/shell`, `extensions/core/agentclientprotocol`
# live under the `extensions/core` workspace). Install them directly until
# the workspace layout is flattened.
npm install --workspaces=false --install-strategy=nested --prefix extensions/core/shell
npm install --workspaces=false --install-strategy=nested --prefix extensions/core/agentclientprotocol
```

> The repository uses npm workspaces, so the root `npm install` installs dependencies for `packages/unified-agent`, `extensions/core`, and `extensions/fleet`.
>
> Run `npm run build -w packages/unified-agent` after installing dependencies so `packages/unified-agent/dist/` exists before the extensions consume `@sbluemin/unified-agent`.
>
> `extensions/core/` and `extensions/fleet/` consume `@sbluemin/unified-agent` from the workspace during root install, so no per-package `npm install` step is required for them.
>
> **Known limitation — nested workspaces.** npm 10.x does not reliably install dependencies for workspaces that live inside another workspace directory. `extensions/core/shell` (declares `node-pty`, `@xterm/*`) and `extensions/core/agentclientprotocol` (declares `@mariozechner/pi-coding-agent`) are registered as workspaces but sit under `extensions/core/`, which is also a workspace. As a result the root `npm install` records their entries in `package-lock.json` yet never creates `extensions/core/shell/node_modules/` nor `extensions/core/agentclientprotocol/node_modules/`, and `pi` fails at startup with `Cannot find module 'node-pty'`. The two explicit commands above install each nested workspace locally with its own `node_modules/`. A future cleanup will flatten the workspace layout so a single `npm install` is sufficient again.

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
