# adapters

Owns Pi-bound adapter implementations over `fleet-core` public APIs and ports.

## Scope

- Runtime builder, push channel adapters, settings/log adapters, grand-fleet adapters, and other Pi integration seams

## Rules

- Adapters may depend on Pi and `fleet-core`; `fleet-core` must not depend back on these adapters.
- Prefer moving reusable pure logic into `fleet-core` and keeping only the Pi implementation seam here.
