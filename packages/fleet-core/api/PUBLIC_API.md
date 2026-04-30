# Fleet Core Public API

This contract describes the canonical consumer surface for `@sbluemin/fleet-core`.
Fleet Core now exposes completed domain APIs through `FleetCoreRuntimeContext`;
legacy public leaf APIs such as `CoreServices`, `AgentRequestService`,
`agentRequest`, `mcp`, and raw registry handles are not public runtime fields.

## Canonical Runtime

- Subpaths: `@sbluemin/fleet-core`, `@sbluemin/fleet-core/runtime`
- `createFleetCoreRuntime(options: FleetCoreRuntimeOptions): FleetCoreRuntimeContext`
- `FleetCoreRuntimeOptions = { dataDir: string; ports: FleetHostPorts; }`

`FleetCoreRuntimeContext` is the only host-consumer context:

```ts
interface FleetCoreRuntimeContext {
  fleet: FleetServices;
  grandFleet: GrandFleetServices;
  metaphor: FleetMetaphorServices;
  agent: FleetAgentServices;
  jobs: FleetJobServices;
  log: FleetLogServices;
  settings: FleetSettingsServices;
  toolRegistry: FleetToolRegistryServices;
  shutdown(): Promise<void>;
}
```

`shutdown()` owns cleanup for the Fleet Core runtime state, agent runtime
internals, settings singleton, and service-status callbacks.

## Domain Services

The package root exports the domain services that make up
`FleetCoreRuntimeContext`:

- `FleetServices` — Admiral carrier, squadron, taskforce, and protocol domain APIs.
- `GrandFleetServices` — Admiralty/Grand Fleet domain APIs.
- `FleetMetaphorServices` — worldview, persona, operation-name, and directive-refinement domain APIs.
- `FleetAgentServices` — high-level agent request execution through `run()` and `runBackground()`.
- `FleetJobServices` — detached carrier job/archive APIs.
- `FleetLogServices` — Fleet log domain APIs.
- `FleetSettingsServices` — runtime-owned settings API.
- `FleetToolRegistryServices` — tool registry domain API with register/list/get/change/hash methods plus manifest helpers.

The old compatibility names are intentionally absent from the runtime context:

- no `coreServices`
- no `settingsServices`
- no `agentRequest`
- no raw `agent` runtime object
- no `agents` alias
- no `carriers` alias
- no `admiral` alias
- no `tools` alias
- no raw `toolRegistry` object
- no public `mcp` object

## Support Types

The root export also provides support types needed to host the runtime:

- `FleetHostPorts`
- `AgentStreamingSink`, `AgentStreamEvent`, `AgentStreamKey`, `ColBlock`, `ColStatus`
- `UnifiedAgentRequestOptions`, `UnifiedAgentBackgroundRequestOptions`, `UnifiedAgentRequestStatus`, `UnifiedAgentResult`
- `ServiceStatusCallbacks`
- `AgentToolSpec`, `AgentToolCtx`, `FleetToolRegistryPorts`

These types support the domain services. They do not reintroduce separate
public service objects.

## Public Source Layout

`packages/fleet-core/src/public/` must contain only the runtime composition leaf
and domain service modules:

- `runtime.ts`
- `fleet-services.ts`
- `grand-fleet-services.ts`
- `metaphor-services.ts`
- `agent-services.ts`
- `job-services.ts`
- `log-services.ts`
- `settings-services.ts`
- `tool-registry-services.ts`

Do not add legacy public leaves such as `agent-request.ts`, `agent-runtime.ts`,
`backend-adapter.ts`, `host-ports.ts`, `mcp.ts`, `streaming-sink.ts`,
`tool-registry.ts`, or `types.ts`.

## Compatibility Subpaths

Some package subpaths still exist for active `pi-fleet-extension` migration
compatibility. They are not the target public architecture and should not be
used for new consumer code. New public functionality must enter through the
domain service modules above and be reachable from `FleetCoreRuntimeContext`.

Current agent compatibility subpaths:

- `@sbluemin/fleet-core/agent`
- `@sbluemin/fleet-core/agent/shared`
- `@sbluemin/fleet-core/agent/shared/types`
- `@sbluemin/fleet-core/agent/shared/service-status`
- `@sbluemin/fleet-core/agent/provider`
- `@sbluemin/fleet-core/agent/provider/provider-client`
- `@sbluemin/fleet-core/agent/provider/provider-types`
- `@sbluemin/fleet-core/agent/provider/provider-mcp`
- `@sbluemin/fleet-core/agent/provider/thinking-level-patch`
- `@sbluemin/fleet-core/agent/provider/tool-snapshot`
- `@sbluemin/fleet-core/agent/dispatcher`
- `@sbluemin/fleet-core/agent/dispatcher/executor`
- `@sbluemin/fleet-core/agent/dispatcher/pool`
- `@sbluemin/fleet-core/agent/dispatcher/runtime`
- `@sbluemin/fleet-core/agent/dispatcher/session-store`
- `@sbluemin/fleet-core/agent/dispatcher/session-resume-utils`
