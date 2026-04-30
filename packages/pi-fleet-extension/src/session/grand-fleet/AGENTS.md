# session/grand-fleet

Grand Fleet의 session-bound Pi runtime home입니다.

## Scope

- `PI_GRAND_FLEET_ROLE` 기반 Admiralty/Fleet 역할 분기
- `globalThis.__fleet_state__` 기반 Grand Fleet session state
- Admiralty/Fleet IPC client/server runtime과 session event wiring
- Grand Fleet session lifecycle, prompt/session binding, mission/report buffers

## Rules

- `registerGrandFleet`, `initGrandFleetState`, `getState` export 시그니처를 보존한다.
- Grand Fleet 역할 감지와 `globalThis` compatibility key 초기화 동작을 보존한다.
- Pi command/tool/keybind/TUI registration은 해당 capability bucket에 남기고, 여기서는 session-bound runtime과 event wiring만 소유한다.
- provider registration 또는 provider lifecycle wiring을 이 디렉터리로 가져오지 않는다.
- provider-agnostic Grand Fleet domain logic은 `@sbluemin/fleet-core/admiralty` public subpath에서 소비한다.
