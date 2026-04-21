# hud

Editor + Status Bar 렌더링 엔진. pi-fleet의 터미널 UI를 담당한다.

## Public API

| File | Description |
|------|-------------|
| `border-bridge.ts` | public API — globalThis `"__pi_hud_editor_border_color__"` 키를 통해 외부 확장이 에디터 테두리 색상을 간접 설정 |

## Footer Bridge (globalThis 간접 통신)

| globalThis Key | Writer | Description |
|----------------|--------|-------------|
| `"__core_log_footer__"` | `log` 확장 | `{ line: string \| null, requestRender: (() => void) \| null }`. HUD가 requestRender 콜백을 주입, log가 .line 갱신 후 호출하여 즉시 렌더 트리거. |

## Core Rules

- **외부 확장은 globalThis 간접 통신만 허용** — `border-bridge.ts`의 globalThis 키 + 위 Footer Bridge 테이블에 명시된 globalThis 키만 사용 가능. hud 내부 파일을 직접 import하는 것은 금지.
- **내부 파일은 private** — `editor.ts`, `colors.ts`, `layout.ts`, `segments.ts`, `theme.ts` 등 모든 내부 모듈은 hud 내부에서만 사용.
- **간접 통신 패턴**: 외부 확장 → globalThis 키 설정 → hud 내부가 폴링/감시 → 내부 렌더링 반영.
