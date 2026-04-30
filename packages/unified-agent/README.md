# @sbluemin/unified-agent

> A TypeScript SDK that unifies Codex CLI, Claude Code, and Gemini CLI under a single interface.

## Overview

Unified Agent provides two ways to control Gemini, Claude, and Codex under a single interface.

- **CLI Binary** — One-shot prompt execution from the command line
- **TypeScript SDK** — Full programmatic control with event-based streaming

### Supported CLIs

| CLI | Protocol | Spawn Command |
|-----|----------|---------------|
| **Gemini** | ACP | `gemini --acp` |
| **Claude** | ACP | `npx --package=@agentclientprotocol/claude-agent-acp@0.29.2 claude-agent-acp` |
| **Codex** | `acp` (default bridge) / `codex-app-server` (internal alternate path) | `npx --package=@zed-industries/codex-acp@0.12.0 codex-acp` / `codex app-server --listen stdio://` |

### Prerequisites

- Node.js >= 18.0.0
- At least one of the above CLIs installed and authenticated

---

## CLI Usage

### Installation

Clone the repository and link globally:

```bash
git clone https://github.com/sbluemin/unified-agent.git
cd unified-agent
pnpm install
pnpm build
pnpm link --global
```

After linking, the `ait` command is available globally:

```bash
ait --help
```

To unlink:

```bash
npm unlink -g @sbluemin/unified-agent
```

### REPL Mode

Running `ait` without any arguments enters the interactive REPL mode:

```bash
ait
```

#### REPL Prompt
The prompt displays the current model, and shows reasoning effort only for CLIs that support it:
`ait (model) (effort) ❯`

#### Slash Commands
| Command | Description |
|---------|-------------|
| `/model <name>` | Change the current model |
| `/effort <level>` | Change reasoning effort when supported; Claude/Gemini ignore it with a notice |
| `/status` | Show connection status and session info |
| `/clear` | Clear the terminal screen |
| `/help` | Show available commands |
| `/exit` | Exit the REPL |

#### Keyboard Shortcuts
- **Ctrl+C**:
  - While streaming: Cancels the current response generation.
  - While waiting for input: Double-tap to exit the REPL.

### Basic Usage (One-shot)

```bash
# Auto-detect available CLI and run
ait "Analyze this project"

# Select a specific CLI
ait -c claude "Review this code"

# Select a model
ait -c claude -m opus "Find bugs"

# Set reasoning effort (Codex)
ait -c codex -e high "Refactor this module"

# Claude ACP ignores `-e` because `claude-agent-acp` does not expose
# a `reasoning_effort` session config option on the ACP path
ait -c claude -e high "Review this code"

# Pipe from stdin
cat error.log | ait -c gemini "Explain this error"

# Resume a previous session
ait -c claude -s <sessionId> "Continue this conversation"

# JSON output (for scripting / AI agents)
ait --json -c claude "Summarize" | jq .response
```

### Options

| Option | Short | Description |
|--------|-------|-------------|
| `--cli <name>` | `-c` | CLI selection (`gemini` \| `claude` \| `codex`) |
| `--session <id>` | `-s` | Resume a previous session (requires `--cli`) |
| `--model <name>` | `-m` | Model override |
| `--effort <level>` | `-e` | Reasoning effort when supported by the selected CLI |
| `--cwd <path>` | `-d` | Working directory (default: current directory) |
| `--yolo` | | Auto-approve all permissions (mapped to `--approval-mode=yolo` for Gemini internally) |
| `--json` | | JSON output mode |
| `--help` | `-h` | Show help |

### Output Modes

**Pretty mode** (default) — streams the AI response to stdout with status on stderr:

```
● ait (claude)

The project is a TypeScript SDK that...

  ▶ Read file: src/index.ts
  ▶ Read file: package.json

● Done (12.3s)
```

**JSON mode** (`--json`) — outputs a single JSON object to stdout:

```json
{"response":"The project is a TypeScript SDK that...","cli":"claude"}
```

On error:

```json
{"error":"No available CLI found"}
```

### Reasoning Effort Support

- **Codex**: supported; the default `acp` path uses the Codex ACP bridge and ACP `session/set_config_option`, and the internal app-server path keeps native pending turn config handling
- **Claude (ACP via `claude-agent-acp`)**: unsupported, `ait -c claude -e high ...` is ignored with a notice
- **Gemini**: unsupported, `ait -c gemini -e high ...` is ignored with a notice

Claude is marked as unsupported because the official `claude-agent-acp` implementation does not expose a `reasoning_effort` session config option on the ACP path. Its agent implementation resolves config options from the session's advertised option list and throws on unknown option IDs, while the upstream source contains no `reasoning_effort` option in that path. See the official sources:

- `src/index.ts`: https://github.com/agentclientprotocol/claude-agent-acp/blob/main/src/index.ts
- `src/acp-agent.ts`: https://github.com/agentclientprotocol/claude-agent-acp/blob/main/src/acp-agent.ts

---

## SDK Usage

### Installation

Add as a dependency via git URL:

```bash
npm install github:sbluemin/unified-agent
```

In `package.json`:

```json
{
  "dependencies": {
    "@sbluemin/unified-agent": "github:sbluemin/unified-agent"
  }
}
```

### Quick Start

```typescript
import { UnifiedAgent } from '@sbluemin/unified-agent';

const client = await UnifiedAgent.build();

// Set up event listeners
client.on('messageChunk', (text) => process.stdout.write(text));
client.on('toolCall', (title, status) => console.log(`Tool: ${title} (${status})`));

// Connect (auto-detects available CLI)
await client.connect({
  cwd: '/my/workspace',
  autoApprove: true,
});

// Send a message
await client.sendMessage('Analyze this project');

// Disconnect
await client.disconnect();
```

### API

#### `connect(options: UnifiedClientOptions): Promise<ConnectResult>`

Connects to a CLI agent.

```typescript
const result = await client.connect({
  cwd: '/my/workspace',       // Working directory (required)
  cli: 'gemini',               // CLI selection (auto-detected if omitted)
  autoApprove: true,           // Auto-approve permissions
  yoloMode: false,             // CLI-specific YOLO approval mode
  model: 'gemini-pro',         // Model override
  clientInfo: { name: 'MyApp', version: '1.0.0' },
});
```

For Codex, the public provider remains `codex`. Internally, `UnifiedCodexAgentClient` keeps both ACP bridge and `codex-app-server` flows explicit in one file. The current default path starts `npx --package=@zed-industries/codex-acp@0.12.0 codex-acp` with Codex-style `-c` overrides including `mcp_servers.*.tool_timeout_sec`. The ACP bridge receives `systemPrompt` through `_meta.systemPrompt.append`, while the app-server path still preserves `developerInstructions` thread creation semantics.

#### `sendMessage(content: string | AcpContentBlock[]): Promise<PromptResponse>`

Sends a message to the agent.

#### `cancelPrompt(): Promise<void>`

Cancels the currently running prompt.

#### `setModel(model: string): Promise<void>`

Changes the model.

#### `setConfigOption(configId: string, value: string): Promise<void>`

Updates a session configuration option (e.g. `reasoning_effort`).

#### `setMode(mode: string): Promise<void>`

Sets the agent mode (e.g. `plan`, `yolo`, `bypassPermissions`).

#### `loadSession(sessionId: string): Promise<void>`

Reloads an existing session.

#### `detectClis(): Promise<CliDetectionResult[]>`

Detects available CLIs on the system.

#### `getAvailableModels(): AvailableModelsResult | null`

Returns the list of available models for the connected CLI.

#### `disconnect(): Promise<void>`

Closes the connection and terminates the child process.

### Events

| Event | Parameters | Description |
|-------|------------|-------------|
| `messageChunk` | `(text, sessionId)` | AI response text streaming |
| `thoughtChunk` | `(text, sessionId)` | AI thinking process |
| `toolCall` | `(title, status, sessionId)` | Tool invocation |
| `plan` | `(plan, sessionId)` | Plan update |
| `userMessageChunk` | `(text, sessionId)` | User message replay streaming |
| `permissionRequest` | `(params, resolve)` | Permission request callback |
| `promptComplete` | `(sessionId)` | Prompt completion |
| `stateChange` | `(state)` | Connection state change |
| `error` | `(error)` | Error |

### Submodules

| Module | Description |
|--------|-------------|
| `AcpConnection` | Direct ACP protocol access |
| `CliDetector` | CLI auto-detection |
| `cleanEnvironment` | Environment variable sanitization |
| `killProcess` | Safe process termination |

---

## Architecture

```
UnifiedAgent
  +-- UnifiedClaudeAgentClient
  +-- UnifiedGeminiAgentClient
  +-- UnifiedCodexAgentClient
```

## License

MIT
