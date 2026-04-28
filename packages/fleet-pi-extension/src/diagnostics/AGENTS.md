# diagnostics

`src/diagnostics` owns optional diagnostics-only Pi extension surfaces.

## Scope

- Long-running or synthetic Pi tools used to verify transport behavior
- Diagnostics registrations guarded by explicit opt-in flags
- Pi-facing debug helpers that must not run during normal Fleet operation

## Current Tools

- `dummy_arith_delayed` — waits 630,000ms before returning an arithmetic result for long-running MCP timeout verification.

## Rules

- Diagnostics must remain inactive unless `PI_DIAGNOSTICS_ENABLED=1`.
- `pi.registerTool(...)` is allowed here only for diagnostics-only tools.
- Prefer `fleet-core` public APIs for reusable pure logic; do not add Fleet domain behavior here.
- Pi logging and host bridges may be imported from capability buckets such as `config-bridge`.

## Verification Logs

| Date | Target Tool | Input (a, b, op) | Result | Status | Notes |
|------|-------------|------------------|--------|--------|-------|
| 2026-04-23 | `dummy_arith_delayed` | 1, 1, add | 2 | Pass | Initial baseline verification of the long-running diagnostic tool. |
