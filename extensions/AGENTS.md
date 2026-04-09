# Pi Extensions Development Guidelines

This directory is where custom extensions for pi-coding-agent are collected and managed.
It is symlinked to `~/.pi/agent/extensions`, so they are automatically loaded when pi is executed.

## Directory Structure and Domain Rules

### Extensions — Directories with `index.ts`

These are extension units automatically loaded by pi. Each extension must provide **independent UI features**.
Do not create intermediate layers that simply wrap official TUI APIs (e.g., `setWidget`, `setFooter`, `setEditorComponent`).

| Extension | Role | Main Files |
|-----------|------|------------|
| `fleet/` | Agent orchestration framework — carrier SDK (`shipyard/carrier/`), unified pipeline, Agent Panel, model selection. Provides the carrier framework that `carriers/` depends on. | `index.ts` (wiring), `shipyard/carrier/` (framework), `internal/` (implementation) |
| `admiral/` | Admiral prompt policy — system prompt injection (`before_agent_start`), worldview toggle, settings section. + Standing Orders/Protocols module management, protocol transition keybinds, protocol status widget, editor border color control. Independent of `fleet/` and `carriers/`. | `index.ts` (wiring), `prompts.ts` (prompts), `protocols/` (Fleet Action, etc.), `standing-orders/` (Deep Dive, etc.) |
| `carriers/` | Carrier registrations — independent extension defining individual carriers (genesis, sentinel, vanguard, etc.). Depends only on `shipyard/carrier` package, not on `fleet/` extension. Optional — users may omit from `settings.json`. | `index.ts` (wiring), individual carrier files |
| `core/hud/` | Editor + Status Bar (Private rendering engine) | `index.ts` (wiring), `editor.ts` (editor/status bar/widget UI) |
| `core/keybind/` | Centralized keybinding management + overlay (alt+.) | `index.ts` (wiring), `types.ts` (API types + globalThis key), `bridge.ts` (globalThis bridge runtime), `store.ts` (JSON), `registry.ts` (bindings), `overlay.ts` (UI) |
| `core/settings/` | Centralized settings API + overlay popup (alt+/) | `index.ts` (wiring), `types.ts` (API types + globalThis key), `bridge.ts` (globalThis bridge runtime), `store.ts` (JSON), `registry.ts` (sections), `overlay.ts` (UI) |
| `core/welcome/` | Welcome overlay/header | `index.ts` (wiring), `welcome.ts` (UI), `types.ts` (globalThis types) |
| `core/improve-prompt/` | Meta-prompting (alt+m), reasoning level cycle (alt+r) | `index.ts` (wiring), `ui.ts` (Status Bar segment) |
| `core/thinking-timer/` | Inline elapsed-time display for Thinking blocks | `index.ts` (wiring), `timer.ts` (patch/store/ticker) |
| `core/summarize/` | Auto one-line session summary | `index.ts` (wiring), `ui.ts` (Status Bar segment) |
| `core/provider-guard/` | Always-on guard — replaces built-in providers (anthropic, google-antigravity, google-gemini-cli) with blocked placeholders and auto-fallbacks away from blocked active models | `index.ts` (wiring) |

### Shared Libraries — Directories without `index.ts`

These are pure libraries not recognized as extensions by pi.

| Library | Role | Main Consumers |
|---------|------|----------------|
| `core/agent/` | Core agent infrastructure — executor, client-pool, runtime, session-map, model-config, service-status | `fleet/`, `carriers/` |
| `core/hud/` (also a library) | Status Bar rendering engine (segments, layout, colors, themes, presets) | `core/welcome` |

### Extension Separation Criteria

Apply these criteria when creating a new extension or separating an existing one:

1. **Does it provide its own UI feature?** — If it has independent rendering logic, its own components, or standalone functionality, **separate it into an extension**.
2. **Is it just wrapping TUI APIs?** — If it acts as a router/relay for `setWidget`, inline it in the consumer extension instead of separating it. Note that `setFooter` is discouraged for external extensions; use `setWidget` with appropriate placement instead.
3. **Is it pure logic shared by multiple extensions?** — Separate it into a **shared library directory** without an `index.ts`.

## Modularization Principles

- **`index.ts` is for wiring only** — Keep only `registerTool`, `registerCommand`, `on`, `registerShortcut` calls, and imports. Do not inline business logic or UI code here.
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

These are automatically provided by the pi runtime, so `npm install` is not needed.
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

### Dependency Direction

```
fleet/ (feature)      →  core/
admiral/ (feature)       (infrastructure + utility)
carriers/ (feature)
```

- **Allowed**: A layer may import from any layer below it (direct or transitive).
- **Forbidden**: A layer must never import from a layer above it (no reverse dependencies).
- **`carriers/`** is a **feature-layer** extension at the same tier as `fleet/`. It depends only on `fleet/shipyard/carrier/` (the carrier framework SDK) — NOT on `fleet/index.ts`, `fleet/internal/`, or `fleet/operation-runner.ts`.
- **`admiral/`** is a **feature-layer** extension at the same tier as `fleet/`. It depends only on `core/settings` — NOT on `fleet/` or `carriers/`.
- **`fleet/`, `admiral/`, and `carriers/` are independent** — none may import from another's extension entry point (`index.ts`). The only shared surface between `fleet/` and `carriers/` is `shipyard/carrier/` (framework SDK).

### Layer Rules

| Layer | May import from | Must NOT import from |
|-------|----------------|----------------------|
| `core/` | external packages only | `fleet/`, `admiral/`, `carriers/` |
| `fleet/` (feature) | `core/` | `admiral/`, `carriers/` |
| `admiral/` (feature) | `core/settings`, `core/keybind` (Editor border via `globalThis` indirect communication) | `fleet/`, `carriers/` |
| `carriers/` (feature) | `fleet/shipyard/carrier/` (framework SDK only) | `fleet/index.ts`, `fleet/internal/`, `admiral/`, `core/` |

> **Skipping layers is allowed** — e.g., `core/` utility extensions may import from `core/` infrastructure modules directly.

### Verification (as of 2026-04-09)

All cross-domain imports verified — **no reverse dependency violations found**.

| Import | Direction | Status |
|--------|-----------|--------|
| `fleet/` → `core/keybind` | fleet → core | ✅ |
| `admiral/` → `core/keybind`, `core/settings` | admiral → core | ✅ |
| `core/summarize` → `core/settings` | core internal | ✅ |
| `core/improve-prompt` → `core/settings`, `core/keybind` | core internal | ✅ |

### Enforcement

- When adding a new import across layer boundaries, **verify the direction before committing**.
- A reverse dependency is a hard violation — **do not merge code that breaks this rule**.
