# fleet-pi-extension Doctrine

- This package owns all Pi runtime integration: `ExtensionAPI`, `ExtensionContext`, TUI rendering, `pi.on`, `pi.registerTool`, `pi.registerProvider`, and `pi.sendMessage`.
- Consume `@sbluemin/fleet-core` only through documented public root or subpath exports.
- Do not deep-import `@sbluemin/fleet-core/src/*` or `@sbluemin/fleet-core/internal/*`.
- `@mariozechner/pi-ai` imports are confined to `src/compat/pi-ai-bridge.ts`.
- Preserve slash command names and existing globalThis compatibility keys.
