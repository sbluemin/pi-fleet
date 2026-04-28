# compat

Owns compatibility-only seams for `fleet-pi-extension`.

## Scope

- Provider/API compatibility adapters that cannot yet be expressed as pure `fleet-core` contracts
- The sole `@mariozechner/pi-ai` bridge site

## Rules

- `@mariozechner/pi-ai` imports are confined to `src/compat/pi-ai-bridge.ts`.
- Do not spread compatibility shortcuts into unrelated buckets.
