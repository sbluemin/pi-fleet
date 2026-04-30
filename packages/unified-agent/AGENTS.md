# AGENTS.md — @sbluemin/unified-agent

## Project Overview

A minimal-dependency TypeScript SDK that integrates Gemini CLI, Claude Code, and Codex CLI into a single interface.

## Tech Stack

- **Language**: TypeScript (ES2022, strict mode)
- **Build**: tsup (ESM + CJS dual output)
- **Test**: Vitest
- **Runtime Dependencies**: `@agentclientprotocol/sdk`, `zod`, `picocolors`
- **Node.js**: >= 18.0.0

## Project Structure

```
src/
├── index.ts                    # Public exports (SDK entry point)
├── cli.ts                      # CLI entry point (Mode branching: oneshot vs REPL)
├── cli-oneshot.ts              # Oneshot execution logic (CLI argument handling)
├── cli-repl.ts                 # REPL mode logic (Interactive interface)
├── cli-renderer.ts             # CLI result rendering (Pretty/JSON output)
├── types/
│   ├── common.ts               # JSON-RPC 2.0 base types
│   ├── acp.ts                  # ACP protocol types (Based on official schema)
│   └── config.ts               # CLI config/detection types
├── connection/
│   ├── BaseConnection.ts       # Abstract base (spawn + JSON-RPC stdio)
│   ├── AcpConnection.ts        # ACP protocol implementation (Wraps official SDK ClientSideConnection)
│   └── CodexAppServerConnection.ts # Codex app-server v2 native JSON-RPC implementation
├── client/
│   ├── IUnifiedAgentClient.ts  # Public API contract + UnifiedAgent builder
│   ├── UnifiedClaudeAgentClient.ts # Claude-specific client
│   ├── UnifiedGeminiAgentClient.ts # Gemini-specific client
│   └── UnifiedCodexAgentClient.ts  # Codex-specific client
├── detector/
│   └── CliDetector.ts          # CLI auto-detection
├── models/
│   ├── schemas.ts              # Model registry Zod schemas + types
│   └── ModelRegistry.ts        # Static model registry (Based on models.json)
├── config/
│   └── CliConfigs.ts           # spawn settings per CLI
└── utils/
    ├── env.ts                  # Environment variable sanitization
    ├── process.ts              # Safe process termination
    └── npx.ts                  # npx path resolution

tests/
└── e2e/                        # E2E tests per CLI (Executing actual CLIs)
    ├── helpers.ts              # Shared helper functions
    ├── claude.test.ts           # Claude E2E
    ├── codex.test.ts            # Codex E2E
    └── gemini.test.ts           # Gemini E2E
```

## Core Commands

```bash
# Type check
pnpm lint

# E2E tests per CLI (Requires actual CLI, local only)
pnpm exec vitest run tests/e2e/claude.test.ts
pnpm exec vitest run tests/e2e/codex.test.ts
pnpm exec vitest run tests/e2e/gemini.test.ts

# Run all tests
pnpm test

# Build
pnpm build
```

## CLI (`ait`)

Binary name: `ait` (`bin` field in `package.json`)

```bash
# Oneshot mode — Executes immediately and exits if arguments are provided
ait "prompt"
ait -c claude -m opus "code review"
echo "error" | ait -c gemini

# REPL mode — Executes in TTY without arguments
ait
ait -c claude -m opus
```

### REPL Prompt
```
ait (model) (effort) ❯ {input}
ait (gemini) ❯ {input}           # Omitted if effort is not supported
```

### Slash Commands
| Command | Action |
|---------|--------|
| `/model <id>` | Change model (list if no argument) |
| `/effort <lv>` | Change reasoning effort |
| `/status` | Show current status |
| `/clear` | Clear screen |
| `/help` | Show help |
| `/exit` | Exit |

## Coding Rules

### Language
- All code comments **MUST be written in Korean**.
- JSDoc descriptions for `@param` and `@returns` are also written in Korean.

### TypeScript
- `strict: true` — No `any` or implicit `any`.
- `noUnusedLocals: true`, `noUnusedParameters: true` — No unused variables/parameters.
- Include `.js` extensions in imports (ESM compatibility).
- Use `as unknown as Record<string, unknown>` pattern for JSON-RPC params type casting.

### Protocol
- ACP types based on [Official ACP Schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/schema.json).
- `protocolVersion` is a number (uint16), currently `1`.
- `session/new` params: `{ cwd: string, mcpServers: [] }` (Required).
- `session/prompt` params: `{ sessionId, prompt: ContentBlock[] }`.
- `session/set_config_option` params: `{ sessionId, configId, value }`.

### Testing
- **E2E Tests** (`tests/e2e/`): Independent files per CLI and protocol. Spawn actual CLIs, so run only in authenticated local environments.
- Filename convention: `<cli>.test.ts` (e.g., `claude.test.ts`, `codex.test.ts`).
- Automatically skip uninstalled CLIs using `describe.skipIf(!isCliInstalled('xxx'))`.
- Test timeout: 180,000ms (3 mins), Session resume: 360,000ms (6 mins).

### Dependencies
- **Minimize Runtime Dependencies**: `@agentclientprotocol/sdk` (Official ACP SDK) + `zod` (Schema validation) + `picocolors` (CLI styling).
- Add only development tools to `devDependencies`: `typescript`, `tsup`, `vitest`, `@types/node`.

## Protocol Support Status per CLI

| CLI | Protocol | spawn Method | set_config_option | set_mode |
|-----|----------|--------------|-------------------|----------|
| Gemini | ACP | `gemini --acp` | ❌ | ❌ |
| Claude | ACP (npx bridge) | `npx --package=@agentclientprotocol/claude-agent-acp@0.29.2 claude-agent-acp` | ✅ | ✅ |
| Codex | `codex-app-server` | `codex app-server --listen stdio://` | Reflected in next turn/thread via pending override | Interpreted pending mode as next thread policy |

## Architecture Decisions

1. **Specialized Clients per CLI**: The `UnifiedAgent` builder selects the provider client, and `UnifiedClaudeAgentClient` / `UnifiedGeminiAgentClient` / `UnifiedCodexAgentClient` directly hold each CLI specialization.
2. **ACP SDK used only for Claude/Gemini**: Codex handles stdio JSON-RPC directly in `CodexAppServerConnection`.
3. **Config-driven + provider seam**: Maintain common contracts while encapsulating CLI differences in `CliConfigs.ts` and internal connection seams.
4. **Event-driven Streaming**: Real-time response processing based on `EventEmitter` (`messageChunk`, `toolCall`, etc.).
5. **Graceful Process Management**: 2-stage termination (SIGTERM → SIGKILL), and environment sanitization to prevent child process interference.
6. **System Prompt Injection (Provider-aware)**:
   - **Claude**: `AcpConnection` appends to the native system prompt via `_meta.systemPrompt.append` when calling `session/new`. The `claude-agent-acp` bridge handles this.
   - **Codex**: Passes `systemPrompt` as `developerInstructions` when creating/resuming a thread. Does not use first user turn prefixing.
   - **Gemini**: `UnifiedGeminiAgentClient` manages `firstPromptPending` state and prefixes the first `sendMessage()` after a new session with the system text `ContentBlock`. This is not a true system-role guarantee.
   - **Session Persistence Contract**: Re-armed for new sessions after `resetSession()`. Codex resume/load paths via `sessionId` re-pass the current client's `systemPrompt`, policies (`approvalPolicy`/`sandbox`), and thread config to `thread/resume`. Claude/Gemini session resume follows a best-effort policy prioritizing conversation continuity; if intentional drift cleanup is needed, the caller must invoke `resetSession()`.
