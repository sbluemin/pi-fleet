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
# 코어 SDK 빌드 + CLI 전역 등록
cd packages/unified-agent && npm install && npm link && cd ../..

# Extensions 의존성 설치
cd extensions/fleet && npm install && cd ../..
cd extensions/dock/shell && npm install && cd ../../..
```

> `npm install`이 `prepare` 스크립트를 통해 자동 빌드하고, `npm link`가 `unified-agent` CLI를 전역으로 등록합니다.
> 해제하려면: `npm unlink -g @sbluemin/unified-agent`

## 3. Register extensions in pi settings

Add the `extensions` field to your pi settings file, pointing to all three extension directories.

**Global** (`~/.pi/agent/settings.json`):

```json
{
  "extensions": [
    "<path-to-pi-fleet>/extensions/fleet",
    "<path-to-pi-fleet>/extensions/dock",
    "<path-to-pi-fleet>/extensions/tender"
  ]
}
```

**Or project-local** (`.pi/settings.json` in your project root):

```json
{
  "extensions": [
    "<path-to-pi-fleet>/extensions/fleet",
    "<path-to-pi-fleet>/extensions/dock",
    "<path-to-pi-fleet>/extensions/tender"
  ]
}
```

> Replace `<path-to-pi-fleet>` with the actual path where you cloned the repository.
>
> - `extensions/fleet/` — agent orchestration extension
> - `extensions/dock/` — infrastructure extensions (hud, keybind, settings, welcome, shell, experimental) + shared config files
> - `extensions/tender/` — utility extensions (improve-prompt, summarize, thinking-timer)

## 4. Verify

Launch `pi` and run `/reload`, then check:

- No extension load errors in the output
- `unified-agent --help` 가 정상 출력되는지 확인
- `unified-agent --list-models` 로 모델 목록 확인
- `Alt+1` / `Alt+2` / `Alt+3` to enter each agent's direct mode
- `Alt+T` popup opens correctly
- Claude Code, Codex CLI, Gemini CLI are each authenticated
