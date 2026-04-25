/**
 * core-keybind/types.ts — 순수 타입/인터페이스 정의
 *
 * 부수효과 없음: import만으로 globalThis를 조작하지 않는다.
 * 런타임 브릿지 로직은 bridge.ts에 분리되어 있다.
 */

/** 단축키 등록 요청 */
export interface KeybindRegistration {
  /** 확장 디렉토리명 (e.g. "metaphor-directive-refinement") */
  extension: string;
  /** 액션 식별자 (e.g. "refine-directive") */
  action: string;
  /** 소스 내 기본 단축키 */
  defaultKey: string;
  /** 단축키 설명 */
  description: string;
  /** 오버레이 그룹핑용 카테고리 (선택) */
  category?: string;
  /** 단축키 핸들러 (ExtensionContext) */
  handler: (ctx: any) => void | Promise<void>;
}

/** 오버라이드가 적용된 최종 바인딩 */
export interface ResolvedBinding extends KeybindRegistration {
  /** keybindings.json 오버라이드 적용 후 최종 키 */
  resolvedKey: string;
  /** 다른 바인딩과 동일 키 충돌 여부 */
  conflicted?: boolean;
}

/** core-keybind가 globalThis를 통해 제공하는 API */
export interface CoreKeybindAPI {
  /** 단축키 등록 (pi.registerShortcut 대행) */
  register(binding: KeybindRegistration): void;
  /** 등록된 모든 바인딩 반환 */
  getBindings(): ResolvedBinding[];
  /** 특정 확장/액션의 최종 키 반환 */
  getKey(extension: string, action: string): string | undefined;
}

// ── 상수 ──

/** globalThis 브릿지 키 (AGENTS.md: globalThis key는 types.ts에 정의) */
export const CORE_KEYBIND_KEY = "__core_keybind__";
