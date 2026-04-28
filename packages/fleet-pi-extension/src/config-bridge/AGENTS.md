# config-bridge

Owns Pi-facing settings, keybind, log, HUD, and provider-guard bridge registration.

## Scope

- Registration and bridge code that binds `fleet-core` ports or local stores into Pi settings/keybind/log surfaces

## Rules

- Store abstractions and pure config logic belong in `fleet-core` when Pi-free.
- Pi overlay registration and settings/keybind bridge glue belong here.
