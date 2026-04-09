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
cd extensions/core/claude-provider && npm install && cd ../../..
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
    "<path-to-pi-fleet>/extensions/core",
    "<path-to-pi-fleet>/extensions/admiral",
    "<path-to-pi-fleet>/extensions/fleet",
    "<path-to-pi-fleet>/extensions/carriers"
  ]
}
```

> Replace `<path-to-pi-fleet>` with the actual path where you cloned the repository.
>
> - `extensions/core/` — infrastructure + utility extensions (hud, keybind, settings, welcome, shell, improve-prompt, summarize, thinking-timer)
> - `extensions/admiral/` — Admiral prompt policy (system prompt injection, worldview toggle, settings section). This should normally be treated as a standard fleet install component, not an optional add-on.
> - `extensions/fleet/` — agent orchestration extension (carrier framework SDK, Agent Panel, unified pipeline)
> - `extensions/carriers/` — **(optional)** default carrier registrations (genesis, athena, oracle, crucible, sentinel, raven, vanguard, echelon, chronicle). Omit this line if you do not want the built-in carriers — the fleet framework will still function without any registered carriers.
>
> `extensions/core/` should be loaded before `extensions/admiral/` so the settings bridge is available immediately during extension startup.

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
