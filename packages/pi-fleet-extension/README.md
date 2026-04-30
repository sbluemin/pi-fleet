# @sbluemin/pi-fleet-extension

`@sbluemin/pi-fleet-extension` is the thin Pi adapter for Fleet. It owns Pi runtime wiring, TUI surfaces, lifecycle hooks, provider registration, and the provider-owned Pi AI gateway while consuming `@sbluemin/fleet-core` through public exports only.

## Capability Buckets

All Pi-specific capabilities are organized into buckets under `src/`:
- **commands**: Slash command registration
- **keybinds**: Global shortcut registration
- **tools**: Tool registration and renderers
- **tui**: TUI surfaces (HUD, Agent Panel, Overlays)
- **provider**: Pi AI Provider registration and gateway (`pi-ai-bridge.ts`)
- **session**: Runtime lifecycle, Grand Fleet coordination, and session-bound event handling

Compatibility bridges for legacy APIs are integrated directly into their relevant capability buckets; the package no longer uses a separate `bindings/` directory.
