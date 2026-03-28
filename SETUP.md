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
# 코어 SDK 선행 빌드
cd packages/unified-agent && npm install && cd ../..

# Extensions 의존성 설치
cd extensions/unified-agent-direct && npm install && cd ../..
cd extensions/utils-interactive-shell && npm install && cd ../..
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

Launch `pi` and run `/reload`, then check:

- No extension load errors in the output
- `Alt+1` / `Alt+2` / `Alt+3` to enter each agent's direct mode
- `Alt+T` popup opens correctly
- Claude Code, Codex CLI, Gemini CLI are each authenticated
