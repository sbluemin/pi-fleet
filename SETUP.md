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
cd extensions/unified-agent-core
npm install
cd ../..
```

## 3. Register extensions in pi settings

Add the `extensions` field to your pi settings file, pointing to the cloned `extensions` directory.

**Global** (`~/.pi/agent/settings.json`):

```json
{
  "extensions": ["<path-to-pi-fleet>/extensions"]
}
```

**Or project-local** (`.pi/settings.json` in your project root):

```json
{
  "extensions": ["<path-to-pi-fleet>/extensions"]
}
```

> Replace `<path-to-pi-fleet>` with the actual path where you cloned the repository.

## 4. Verify

Launch `pi` and run `/reload` — all extensions should load automatically.
