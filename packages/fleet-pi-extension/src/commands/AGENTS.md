# commands

Owns `pi.registerCommand(...)` wiring for `fleet-pi-extension`.

## Scope

- Slash command registration and command-to-runtime adapter glue
- Command routing for admiral, carrier, metaphor, core, and experimental wiki features

## Rules

- Register commands here, not inside domain logic in `fleet-core`.
- Do not invent new legacy homes under `src/fleet/**` or `src/metaphor/**` for command registration.
- Keep command names aligned with the repository-wide `fleet:<domain>:<feature>` convention.
