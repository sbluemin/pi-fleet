# Pi Extensions Development Guidelines

This directory is where custom extensions for pi-coding-agent are collected and managed.
It is symlinked to `~/.pi/agent/extensions`, so they are automatically loaded when pi is executed.

## Directory Structure and Domain Rules

### Extensions — Directories with `index.ts`

These are extension units automatically loaded by pi. Each extension must provide **independent UI features**.
Do not create intermediate layers that simply wrap official TUI APIs (e.g., `setWidget`, `setFooter`, `setEditorComponent`).

| Extension | Role | Main Files |
|-----------|------|------------|
| `fleet/` | Agent orchestration framework — carrier SDK (`shipyard/carrier/`), Admiral/Bridge/Carrier wiring, unified pipeline, Agent Panel, model selection. Provides the carrier framework consumed by `fleet/carriers/`. | `index.ts` (wiring), `shipyard/carrier/` (framework), `admiral/`, `bridge/`, `carriers/` |
| `core/` | Unified infrastructure extension — root entry point that wires keybind, settings, log, welcome, hud, shell, improve-prompt, thinking-timer, provider-guard, and the unified `agentclientprotocol/` module | `index.ts` (root wiring), `<module>/register.ts` (module wiring), `agentclientprotocol/` (shared ACP infra + provider boundary) |
| `metaphor/` | Metaphor framework extension — Centralized management of PERSONA/TONE for the 4-tier naval hierarchy, provides `metaphor:worldview` toggle/settings and `operation-name/` session operation naming. | `index.ts`, `worldview.ts`, `prompts.ts`, `operation-name/` |
| `diagnostics/` | MCP transport layer verification tools — long-running dummy arithmetic for timeout testing. | `index.ts`, `dummy-arith/tool.ts` |

### Shared Libraries — Directories without `index.ts`

These are pure libraries not recognized as extensions by pi.

| Library | Role | Main Consumers |
|---------|------|----------------|
| `core/agentclientprotocol/` | Unified ACP infrastructure — shared execution/runtime/session/service-status files plus provider integration files | `fleet/`, `carriers/` |
| `core/hud/` (also a library) | Status Bar rendering engine (segments, layout, colors, themes, presets) | `core/index.ts`, `core/welcome` |

### Extension Separation Criteria

Apply these criteria when creating a new extension or separating an existing one:

1. **Does it provide its own UI feature?** — If it has independent rendering logic, its own components, or standalone functionality, **separate it into an extension**.
2. **Is it just wrapping TUI APIs?** — If it acts as a router/relay for `setWidget`, inline it in the consumer extension instead of separating it. Note that `setFooter` is discouraged for external extensions; use `setWidget` with appropriate placement instead.
3. **Is it pure logic shared by multiple extensions?** — Separate it into a **shared library directory** without an `index.ts`.

## Modularization Principles

- **`index.ts` is for wiring only** — Keep only `registerTool`, `registerCommand`, `on`, `registerShortcut` calls, top-level initialization, and imports. Do not inline business logic or UI code here.
- **UI/Rendering must be in separate files** — Such as `ui.ts`, `editor.ts`, `welcome.ts`. Do not put TUI component assembly code in `index.ts`.
- **Constants/Types must be in `types.ts`** — Values shared across modules (especially globalThis keys/bridge interfaces) must be in a separate file.
- **AI prompts should normally be in `prompts.ts`** — All prompts sent to AI models (system prompts, instructions, tool descriptions, guidelines, etc.) should normally be defined in a dedicated `prompts.ts` file. Do not embed prompt text inline in business logic, tool registration, or constants files unless a child `AGENTS.md` explicitly documents a narrower domain-specific exception.
- **Use `globalThis` only for "sharing actions/data of independent features"** — Use it only when an extension exposes its functionality to other extensions (e.g., the dismiss action of welcome). Do not use globalThis to relay TUI framework data.

### Prompt Separation Rules (`prompts.ts`)

Any string that is ultimately consumed by an AI model should live in `prompts.ts` by default:

| Category | Examples | Location |
|----------|----------|----------|
| System prompt / instruction | `SYSTEM_PROMPT`, `SYSTEM_INSTRUCTION` | `prompts.ts` by default |
| Tool prompt fields | `description`, `promptSnippet`, `promptGuidelines` | `prompts.ts` by default, or inline in the owning module when a child `AGENTS.md` explicitly allows it |
| Short UI-only labels | button text, notification messages | `constants.ts` or inline (NOT `prompts.ts`) |

> **Fleet 전역 정책**: `systemPrompt`는 공개 API(`UnifiedAgentRequestOptions`)에서 비노출되며, `admiral` 확장 내 `setCliSystemPrompt()`를 통해 **Admiral (제독)**의 전역 지침으로 관리됩니다. `unified-agent`는 이를 `connect` 옵션으로 소비하여 하이브리드(native append 또는 첫 user-turn prefix) 방식으로 주입합니다. Carrier 도구 실행 경로는 **Admiral (제독)**의 지침을 상속하지 않으며, 각 **Captain (함장)**의 페르소나와 임무 가이드는 각 요청 본문 조립 경로가 담당합니다.

## 4-Tier Naval Hierarchy (4계층 해군 위계)

모든 확장은 동일한 4계층 위계를 따릅니다:
1. **Admiral of the Navy (ATN, 대원수)**: **사용자 (User)**.
2. **Fleet Admiral (사령관)**: `grand-fleet` Admiralty LLM 페르소나.
3. **Admiral (제독)**: 워크스페이스 **Host PI 인스턴스**.
4. **Captain (함장)**: 개별 **Carrier 에이전트 페르소나**.

**Why separate?** Prompt text often needs independent review, A/B testing, or iteration without touching business logic. Keeping prompts in a single file per extension makes them easy to locate, audit, and modify.

**Allowed exception:** If a child `AGENTS.md` explicitly states that prompt text is part of the owning module's domain contract and is expected to diverge per module, prompts may live inline in that module instead of a shared `prompts.ts`.

**Naming conventions:**
- Static prompts → `export const SYSTEM_PROMPT = \`...\``
- Dynamic prompts (parameterized) → `export function toolDescription(name: string): string`
- Inline prompt exceptions must be documented by a child `AGENTS.md` and kept near the owning module's registration logic
- Re-export from `constants.ts` if consumers currently import from there → `export { SYSTEM_PROMPT } from "./prompts.js"`

### globalThis Usage Rules

```
Allowed: core/welcome → globalThis["__pi_core_welcome__"] = { dismiss }
         (Exposes actions of an independent feature)

Forbidden: core/hud-footer → globalThis["__pi_hud_footer__"] = { footerDataRef, tuiRef }
           (Wraps and relays TUI framework data)
```

The globalThis key and bridge interface should be **defined in the `types.ts` of the extension that owns the feature** (not in shared libraries, but in the owner extension).

#### State Persistence Across Module Reloads

pi-coding-agent v0.65.0+ reloads extension modules on every session switch (resume, new, fork). When modules are reloaded, **module-level variables are reset** (new module instance), but **globalThis persists**.

**Rule: Any state that must survive session switches MUST be stored on globalThis. Module-level variables are only safe for single-session caches.**

Examples of correctly placed state:
| Extension | State | Location | Reload-safe |
|-----------|-------|----------|-------------|
| `fleet/panel/state.ts` | Panel UI state | `globalThis["__pi_agent_panel_state__"]` | ✅ |
| `fleet/stream-store.ts` | Stream data | `globalThis["__pi_stream_store__"]` | ✅ |
| `carrier/framework.ts` | Framework state | `globalThis["__pi_bridge_framework__"]` | ✅ |
| `core/keybind/registry.ts` | Keybinding list | module-level `const bindings[]` | ❌ BUG — must migrate to globalThis |

Pattern for globalThis-backed state:
```typescript
// types.ts — define the shape
const GLOBAL_KEY = "__my_extension_state__";
interface MyState { items: Item[]; }

// Lazy-init guard: only create if not already present
if (!(globalThis as any)[GLOBAL_KEY]) {
  (globalThis as any)[GLOBAL_KEY] = { items: [] };
}

// Access functions (in registry.ts or similar)
export function getItems(): Item[] {
  return ((globalThis as any)[GLOBAL_KEY] as MyState).items;
}
```

Anti-pattern:
```typescript
// ❌ Module-level state — reset on reload, causes silent data loss
const items: Item[] = [];
export function getItems() { return items; }
```

> **Defense-in-Depth:** For services that must survive reloads (like keybindings), use the `_bootstrapKeybind` migration pattern to move existing state to `globalThis` if found, and always re-register essential hooks/shortcuts during `session_start` to ensure the new module instance is correctly wired to the persistent state. The `core/keybind` extension serves as the canonical example for this pattern.

## Extension Authoring Guide

### Basic Structure

```
extensions/
├── AGENTS.md
├── <extension-name>/
│   └── index.ts          ← Entry point (required)
├── <extension-name>/
│   ├── index.ts
│   ├── ui.ts             ← UI/Rendering separated
│   ├── prompts.ts        ← AI prompts (if the extension uses LLM calls or registers tools with prompt fields)
│   └── types.ts          ← Types/Constants
└── <shared-lib>/         ← No index.ts = Pure library, not an extension
    ├── types.ts
    └── utils.ts
```

### Rules

- **Each extension must be a subdirectory with an `index.ts` file**.
- **`core/` is the canonical composite example** — only `core/index.ts` is auto-loaded; submodules under `core/*/register.ts` are internal wiring modules, not standalone extensions.
- Do not place `.ts` files in the root — pi will mistakenly recognize them as extensions.
- `index.ts` must have a default export function of type `(pi: ExtensionAPI) => void`.

### Basic Template

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => { ... });
  pi.registerTool({ name: "...", ... });
  pi.registerCommand("name", { ... });
}
```

### Allowed Imports

| Package | Purpose |
|---------|---------|
| `@mariozechner/pi-coding-agent` | Extension types (`ExtensionAPI`, `ExtensionContext`, etc.) |
| `@sinclair/typebox` | Tool parameter schema definition (`Type.Object`, `Type.String`, etc.) |
| `@mariozechner/pi-ai` | AI utilities (`StringEnum` — Google API compatible enum) |
| `@mariozechner/pi-tui` | TUI components (custom rendering) |

`@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`, and `@mariozechner/pi-tui` are provided by the pi runtime.
`@sinclair/typebox` is no longer transitively provided in `pi-coding-agent@0.69.0+`, so the workspace must declare it explicitly when extensions import it.
If an external npm package is required, place a `package.json` in the respective extension subdirectory and run `npm install`.

### Notes

- String enums must use `StringEnum` (`@mariozechner/pi-ai`). `Type.Union`/`Type.Literal` do not work with the Google API.
- Tool outputs must adhere to the **50KB / 2000 lines** limit. Use `truncateHead`/`truncateTail` utilities if exceeded.
- Signal errors using `throw new Error()` (returning an object won't set `isError`).

## Key API Pattern Reference

### Sending Messages

| Method | Purpose | Triggers Agent |
|--------|---------|----------------|
| `pi.sendUserMessage(text)` | Sends a user message to the agent (agent will respond) | **Yes** |
| `pi.sendMessage({...})` | Custom message displayed only on TUI | **No** (default) |

#### `pi.sendUserMessage()` — Send to Agent

```typescript
// Default (only works in idle state)
pi.sendUserMessage("Analyze this");

// Send immediately while the agent is responding
pi.sendUserMessage("Change direction", { deliverAs: "steer" });

// Queue up after the current turn completes
pi.sendUserMessage("Next task", { deliverAs: "followUp" });
```

#### `pi.sendMessage()` — Display on TUI only (Agent not triggered)

```typescript
pi.sendMessage({
  customType: "my-result",    // Custom identifier
  content: "Text to display", // string or (TextContent | ImageContent)[]
  display: true,              // Must be true to display on TUI
  details: { /* optional metadata */ },
});
// Can also trigger the agent if triggerTurn option is set to true
```

### LLM Call (`complete`)

```typescript
import { complete } from "@mariozechner/pi-ai";

// Use the current session model with ctx.model
// getApiKey() does not exist — use getApiKeyAndHeaders() instead
const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
if (!auth.ok) throw new Error(auth.error);

const response = await complete(
  ctx.model,
  { systemPrompt: "...", messages: [{ role: "user", content: "...", timestamp: Date.now() }] },
  {
    ...(auth.apiKey && { apiKey: auth.apiKey }),
    ...(auth.headers && { headers: auth.headers }),
  }
);

// Extract response text
const text = response.content
  .filter((c): c is { type: "text"; text: string } => c.type === "text")
  .map((c) => c.text)
  .join("\n");
```

### UI Notifications

```typescript
ctx.ui.notify("Message", "info");     // "info" | "warning" | "error"
```

## Development Workflow

1. New extension: `mkdir <name> && touch <name>/index.ts`
2. Test: `pi -e ./<name>/index.ts` (standalone) or just run `pi` (loads all)
3. Apply changes: run `/reload` inside pi (no restart needed)
4. Disable: prefix directory name with `_` (e.g., `_memo/`) — pi only loads directories with `index.ts`

## Reference Documents

### Local Paths (Can be read directly by AI Agents)

Command to check pi installation root:

```bash
npm ls -g @mariozechner/pi-coding-agent --parseable 2>/dev/null | head -1
```

| Document | Path (Relative to pi root) | Description |
|----------|----------------------------|-------------|
| **Full Extension Docs** | `docs/extensions.md` | Full reference for API, events, tool registration, custom UI, etc. |
| **Examples List (README)**| `examples/extensions/README.md` | Catalog of all example extensions |
| **TUI Components** | `docs/tui.md` | Custom rendering, component API |
| **Session Management** | `docs/session.md` | SessionManager, save/restore state, branching |
| **Custom Providers** | `docs/custom-provider.md` | Model provider registration, OAuth, streaming |
| **Model Configuration** | `docs/models.md` | Add/customize models |
| **Themes** | `docs/themes.md` | Theme customization |
| **Keybindings** | `docs/keybindings.md` | Register shortcuts, default keybindings |
| **Package Distribution**| `docs/packages.md` | Distribute extensions via npm/git |
| **Skills** | `docs/skills.md` | Skill system |
| **Settings** | `docs/settings.md` | settings.json options |
| **SDK** | `docs/sdk.md` | Programmatically use pi |
| **RPC** | `docs/rpc.md` | RPC protocol, extension UI sub-protocol |

### Example Extensions (Commonly referenced patterns)

Path: `examples/extensions/` (Relative to pi root)

| File | Pattern |
|------|---------|
| `hello.ts` | Minimal custom tool |
| `todo.ts` | State save/restore + custom rendering + commands |
| `tools.ts` | Custom UI (SettingsList) + session persistence |
| `permission-gate.ts` | Block tool_call events |
| `dynamic-tools.ts` | Runtime tool registration/deregistration |
| `tool-override.ts` | Override built-in tools |
| `truncated-tool.ts` | Handle output truncation |
| `ssh.ts` | Remote execution (pluggable operations) |
| `custom-footer.ts` | Custom footer UI |
| `message-renderer.ts` | Custom message rendering |
| `with-deps/` | Extension with npm dependencies |
| `subagent/` | Sub-agent delegation |

### GitHub

- Monorepo: https://github.com/badlogic/pi-mono
- Extension Docs: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md
- Extension Examples: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions
- Built-in Tool Implementations: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/src/core/tools

---

## Domain Boundary Rules

Extensions are organized in layers. **Dependencies must only flow in one direction — from higher layers toward lower layers.**

## Experimental Extensions

Experimental extensions are opt-in feature directories gated by boot configuration.

### Naming and Required Files

- **Directory naming** — Use `experimental-{feature-name}/` for every experimental extension.
- **Local policy required** — Every `experimental-*` directory must include its own `AGENTS.md`.
- **`package.json` is conditional** — Create `package.json` only when the extension needs external npm dependencies.

### Boot Gating Contract

- **Required boot check** — Each `experimental-*/index.ts` must read `globalThis["__fleet_boot_config__"]` and check the `experimental` flag.
- **Disabled path** — If `experimental !== true`, return early from the default export before registering UI, tools, commands, or hooks.
- **Early return pattern** — Keep the disabled path explicit and local to `index.ts` so the extension stays inert when the flag is off.

Example:

```typescript
export default function registerExperimental(pi: ExtensionAPI) {
  const boot = (globalThis as any)["__fleet_boot_config__"];
  if (!boot?.experimental) return;

  // 실험 기능 등록
}
```

### Dependency and Load Order Rules

- **Dependency direction** — `experimental-*` may import from `core/` only.
- **Forbidden direct imports** — `experimental-*` must not import from `fleet/` or `metaphor/`.
- **Load order** — Extensions are expected to load in this order: `boot` → `core` → `diagnostics` → `experimental-*` → `fleet` → `grand-fleet` → `metaphor`.

### Dependency Direction

```
fleet/ (unified feature)         →  metaphor/  →  core/
  ├── admiral/                      (PERSONA)      (infrastructure + utility)
  ├── bridge/
  └── carriers/

experimental-*/ (opt-in feature) →  core/
```

- **Allowed**: A layer may import from any layer below it (direct or transitive).
- **Forbidden**: A layer must never import from a layer above it (no reverse dependencies).
- **`fleet/`** is the primary feature extension. Its internal components (`admiral/`, `bridge/`, `carriers/`) are orchestrated by `fleet/index.ts`.
- **`metaphor/`** is the persona framework extension. It provides the source of truth for the naval metaphor hierarchy.
- **Internal Component Rules**:
    - **`fleet/carriers/`** depends only on `fleet/shipyard/carrier/` (the carrier framework SDK) — NOT on `fleet/index.ts`, `fleet/internal/`, or `fleet/operation-runner.ts`.
    - **`fleet/admiral/`** is the internal orchestrator. It may import from `fleet/shipyard/` (carrier framework, store, tool prompts), `metaphor/` (PERSONA/TONE sources), and `core/agentclientprotocol/` (CLI system prompt setter) to compose ACP CLI system instructions.
    - **`fleet/index.ts`** is the single entry point that initializes and exports all internal components.

### Layer Rules

| Layer | May import from | Must NOT import from |
|-------|----------------|----------------------|
| `core/` | external packages only | `metaphor/`, `fleet/` |
| `experimental-*` | `core/` | `fleet/`, `metaphor/` |
| `metaphor/` | `core/` | `fleet/` |
| `fleet/` (feature) | `metaphor/`, `core/` | - |
| `fleet/admiral/` | `core/settings`, `core/keybind`, `core/agentclientprotocol/provider-types`, `metaphor/`, `fleet/shipyard/` | `fleet/index.ts`, `fleet/internal/` |
| `fleet/carriers/` | `fleet/shipyard/carrier/` | `fleet/index.ts`, `fleet/internal/`, `fleet/admiral/`, `metaphor/`, `core/` |

> **Skipping layers is allowed** — e.g., `fleet/` components may import from `core/` modules directly.

### Verification (as of 2026-04-16)

All cross-domain imports verified — **no reverse dependency violations found**.

| Import | Direction | Status |
|--------|-----------|--------|
| `fleet/` → `core/keybind` | fleet → core | ✅ |
| `fleet/admiral/` → `core/keybind`, `core/settings` | fleet → core | ✅ |
| `fleet/admiral/` → `core/agentclientprotocol/provider-types` | fleet → core | ✅ |
| `fleet/admiral/` → `fleet/shipyard/` | fleet internal | ✅ |
| `metaphor/operation-name/` → `core/settings` | metaphor → core | ✅ |
| `core/improve-prompt` → `core/settings`, `core/keybind` | core internal | ✅ |

### Enforcement

- When adding a new import across layer boundaries, **verify the direction before committing**.
- A reverse dependency is a hard violation — **do not merge code that breaks this rule**.
