/**
 * boot — Fleet/Grand Fleet 확장 부팅 제어
 *
 * PI 로더의 알파벳 순 발견 순서를 이용하여
 * fleet/과 grand-fleet/보다 먼저 로드되며,
 * 환경변수 기반으로 globalThis에 부팅 설정을 기록한다.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function registerBoot(_pi: ExtensionAPI) {
  const role = process.env.PI_GRAND_FLEET_ROLE;
  const isAdmiralty = role === "admiralty";
  const isFleet = role === "fleet";

  (globalThis as any)["__fleet_boot_config__"] = {
    fleet: !isAdmiralty,
    grandFleet: isAdmiralty || isFleet,
    role: isAdmiralty ? "admiralty" : isFleet ? "fleet" : null,
  };
}
