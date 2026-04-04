# core/agent

Core agent infrastructure for pi-fleet. This module provides execution, process management, session persistence, and service status monitoring features used by `fleet/` and `carriers/` extensions.

## Core Rules

- **Zero-Dependency on Fleet**: This directory is part of the `core` layer and **MUST NOT** import anything from `extensions/fleet/` or `extensions/carriers/`.
- **One-Way Dependency**: Only `fleet` → `core/agent` dependencies are allowed.
- **Provider-Agnostic**: Logic here should be generic across different CLI providers (Claude, Gemini, Codex).
- **Service Status Injection**: `service-status/store.ts` uses a callback injection pattern to notify the UI layer of updates, maintaining the core-to-fleet dependency boundary.

## Module Structure

| File | Role |
|------|------|
| `types.ts` | Core agent types — AgentStatus, ProviderKey, HealthStatus, ServiceSnapshot. Shared across all layers. |
| `executor.ts` | CLI execution logic — spawning processes, managing stdio, handling ACP protocol. |
| `client-pool.ts` | Connection pooling — managing multiple active CLI sessions by `carrierId`. |
| `runtime.ts` | Agent runtime manager — initialization, data directory management, host session sync. |
| `session-map.ts` | Session persistence — mapping PI session IDs to individual carrier session IDs. |
| `model-config.ts` | Model configuration — persisting model selection per carrier. |
| `service-status/store.ts` | Service status store — polling provider health, managing status snapshots, injection-based callbacks. |
| `service-status/renderer.ts` | Service status TUI renderer — rendering health tokens for footers or widgets. |

## Persistence

All agent-related data (session maps, model configs) are stored under the `.data/` directory in the project root, managed by `runtime.ts`.

## Service Status Monitoring

The service status module monitors the health of external providers:
1. **Polling**: Periodically fetches health status from providers.
2. **Context**: `attachStatusContext` is used to provide the current health snapshot to UI components.
3. **Notification**: When status changes, it executes registered callbacks (injected by `fleet/index.ts`) to trigger UI refreshes.
