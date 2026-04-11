# core/agentclientprotocol/agent

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
| `runtime.ts` | Agent runtime manager — initialization, data directory management, host session mapping (session-only). |
| `session-map.ts` | Session mapping — mapping PI session IDs to individual carrier session IDs. |
| `service-status/store.ts` | Service status store — polling provider health, managing status snapshots, injection-based callbacks. |
| `service-status/renderer.ts` | Service status TUI renderer — rendering health tokens for footers or widgets. |

## Persistence

`runtime.ts` manages the base `.data/` directory. Core agent persistence is focused on **session-only** lifecycle state:
- **Session Maps**: Mapping host PI session IDs to child carrier session IDs (persisted under `.data/session-maps/`).

Fleet-wide persistent configuration (e.g., model selection) has been moved to the `fleet` layer (`shipyard/store.ts`).

## Service Status Monitoring

The service status module monitors the health of external providers:
1. **Polling**: Periodically fetches health status from providers.
2. **Context**: `attachStatusContext` is used to provide the current health snapshot to UI components.
3. **Notification**: When status changes, it executes registered callbacks (injected by `fleet/index.ts`) to trigger UI refreshes.
