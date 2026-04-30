# fleet-wiki

Owns the Pi-side Fleet Wiki domain integration for `pi-fleet-extension`. This domain serves as the adapter for the `@sbluemin/fleet-wiki` package.

## Scope

- `registerFleetWiki(ctx)` — single entry for Fleet Wiki tool and command registration
- Fleet Wiki Overlay rendering through Pi TUI `ctx.ui.custom(...)`
- Fleet Wiki session capture helpers and Pi-side bridge logic
- Pi adapters that consume `@sbluemin/fleet-wiki` public exports

## Rules

- **Dependency**: Consume `@sbluemin/fleet-wiki` through its public package export only. Do not route this domain back through `fleet-core`.
- **Registration**: Keep Fleet Wiki slash commands under the `fleet:wiki:<feature>` naming convention.
- **UI Mounting**: Fleet Wiki specific TUI surfaces are managed here and registered with the host via `ExtensionContext`.
- Do not move pure Fleet Wiki domain logic into this folder; keep it in `packages/fleet-wiki`.
- Do not deep import from `@sbluemin/fleet-wiki/src/**`.
