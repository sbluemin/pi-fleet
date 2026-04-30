# bindings

fleet-core public API를 Pi 시설에 연결하는 wrapper/facade/adapter 레이어.

## 구조

| 디렉터리 | 역할 |
|-----------|------|
| `runtime/` | PI lifecycle listeners 및 host event sequencing (기존 `src/lifecycle/` 역할) |
| `compat/` | Compatibility-only seams, pi-ai bridge 포함 (기존 `src/compat/` 역할) |
| `grand-fleet/` | Grand Fleet (Admiralty/Fleet) Pi adapter |
| `carrier/` | Carrier boot host ports, panel streaming sink |
| `jobs/` | Carrier job completion push channel |
| `hud/` | HUD config bridge registration |
| `config/` | Settings/keybind/log/provider-guard/thinking-timer bridge |

## 규칙

- bindings/는 domain logic home이 아니다. fleet-core public API를 Pi runtime에 연결하는 wrapper만 소유한다.
- fleet-core에 Pi dependency를 추가하지 않는다.
- 실제 Pi registration entrypoint (`pi.registerTool`, `pi.registerCommand` 등)는 해당 capability bucket (`tools/`, `commands/` 등)에 남긴다.
- 새 pure domain logic을 여기 만들지 않는다. fleet-core에 추가해야 한다.
- `@mariozechner/pi-ai` 임포트는 오직 `src/bindings/compat/pi-ai-bridge.ts` 내로 제한한다.
