import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLEET_ROOT = join(__dirname, "..", "..", "..");

export default function registerWelcomeUpdateCommand(pi: ExtensionAPI): void {
  pi.registerCommand("fleet:update", {
    description: "pi-fleet 저장소를 원격 최신 상태로 업데이트",
    handler: async (_args, ctx) => {
      pi.sendUserMessage(createFleetUpdatePrompt(FLEET_ROOT));
      ctx.ui.notify("pi-fleet 업데이트 작업을 AI에게 전달했습니다.", "info");
    },
  });
}

function createFleetUpdatePrompt(fleetRoot: string): string {
  return [
    "Please update the pi-fleet repository.",
    "",
    `1. Move to the local repository at the absolute path \`${fleetRoot}\`.`,
    "2. Identify the current active branch and synchronize it with the remote latest state. Run fetch followed by pull as needed.",
    "3. Follow the update procedure described in the repository root \`SETUP.md\`. Do not skip any step it specifies (dependency installation, link refresh, build, verification, etc.).",
    "4. Report the actions taken and verification results concisely.",
  ].join("\n");
}
