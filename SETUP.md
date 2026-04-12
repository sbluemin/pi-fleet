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
# Build core SDK and register CLI globally
cd packages/unified-agent && npm install && npm link && cd ../..

# Install extension dependencies
cd extensions/fleet && npm install && cd ../..
cd extensions/core/agent && npm install && cd ../../..
cd extensions/core/shell && npm install && cd ../../..
```

> `npm install` automatically builds via the `prepare` script, and `npm link` registers the `unified-agent` CLI globally.
> To unregister: `npm unlink -g @sbluemin/unified-agent`

## 3. Register extensions in pi settings

Add the `extensions` field to your pi settings file, pointing to the extension directories.

> `extensions/admiral/` is required if you want Admiral prompt injection and worldview controls. If it is missing, pi will show: `Warning: Admiral extension is not loaded. Add extensions/admiral to restore Admiral prompts and worldview controls.`

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
> - `extensions/admiral/` — Admiral prompt policy (system prompt injection, worldview toggle, settings section)
> - `extensions/bridge/` — active ACP provider bridge (Alt+T overlay shell launcher)
> - `extensions/fleet/` — agent orchestration extension (carrier framework SDK, Agent Panel, unified pipeline)
> - `extensions/carriers/` — default carrier registrations (genesis, athena, oracle, sentinel, vanguard, echelon, chronicle)
>
> With `extensions/` registered, `core/`, `admiral/`, `bridge/`, `fleet/`, and `carriers/` are discovered from that root automatically.

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
