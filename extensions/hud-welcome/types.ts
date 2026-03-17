/**
 * hud-welcome/types.ts — welcome 확장 타입 및 globalThis 키
 */

/** globalThis 키: 다른 확장에서 welcome dismiss를 트리거하기 위한 브릿지 */
export const HUD_WELCOME_GLOBAL_KEY = "__pi_hud_welcome__";

/** globalThis로 노출되는 브릿지 인터페이스 */
export interface HudWelcomeBridge {
  dismiss: () => void;
}
