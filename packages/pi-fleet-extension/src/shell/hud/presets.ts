import type { PresetDef, StatusLinePreset } from "./types.js";
import { getGeekColors } from "./theme.js";

export const PRESETS: Record<StatusLinePreset, PresetDef> = {
  // sbluemin — Tokyo Night + Cyberpunk Neon
  // sparkline thinking · 블록 막대 context · μ$/m$ cost · chevron 구분자
  sbluemin: {
    leftSegments: ["pi", "operation", "model", "thinking", "path", "git"],
    rightSegments: ["context_pct", "cost", "time_spent"],
    secondarySegments: ["extension_statuses"],
    separator: "chevron",
    colors: getGeekColors(),
    segmentOptions: {
      pi: { label: "Fleet" },
      model: { showThinkingLevel: false },
      path: { mode: "abbreviated", maxLength: 35 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
    },
  },
};

export function getPreset(name: StatusLinePreset): PresetDef {
  return PRESETS[name] ?? PRESETS.sbluemin;
}
