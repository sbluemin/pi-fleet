/**
 * core-welcome/types.ts — welcome 확장 타입 및 globalThis 키
 */

/** globalThis로 노출되는 브릿지 인터페이스 */
export interface WelcomeBridge {
  dismiss: () => void;
}

/** globalThis 키: 다른 확장에서 welcome dismiss를 트리거하기 위한 브릿지 */
export const WELCOME_GLOBAL_KEY = "__pi_core_welcome__";
