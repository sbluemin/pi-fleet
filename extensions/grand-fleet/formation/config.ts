/**
 * formation/config.ts — ~/.pi/grand-fleet/config.json 읽기/쓰기
 *
 * 외부 YAML 파서 없이 JSON으로 구현. 향후 YAML 지원 추가 가능.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getLogAPI } from "../../core/log/bridge.js";
import type {
  GrandFleetConfig,
  FormationConfig,
  FleetEntry,
  AdmiraltyConfig,
} from "../types.js";
import { DEFAULT_EXCLUDE_PATTERNS } from "../types.js";

const GRAND_FLEET_HOME = path.join(os.homedir(), ".pi", "grand-fleet");
const CONFIG_FILE = "config.json";
const LOG_SOURCE = "grand-fleet:formation";

/** 기본 formation 설정을 생성한다. */
function createDefaultFormationConfig(): FormationConfig {
  return {
    strategy: "auto-subdirs",
    excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS],
  };
}

/** 기본 admiralty 설정을 생성한다. */
function createDefaultAdmiraltyConfig(): AdmiraltyConfig {
  return {};
}

/** 기본 설정을 생성한다. */
function createDefaultConfig(): GrandFleetConfig {
  return {
    version: 1,
    formation: createDefaultFormationConfig(),
    fleets: [],
    admiralty: createDefaultAdmiraltyConfig(),
  };
}

/** ~/.pi/grand-fleet 디렉토리를 보장한다. */
function ensureConfigDir(): string {
  if (!fs.existsSync(GRAND_FLEET_HOME)) {
    fs.mkdirSync(GRAND_FLEET_HOME, { recursive: true });
  }
  return GRAND_FLEET_HOME;
}

/** 설정 파일 경로를 반환한다. */
function getConfigPath(): string {
  return path.join(GRAND_FLEET_HOME, CONFIG_FILE);
}

/** 설정을 로드한다. 파일이 없거나 파싱에 실패하면 기본값을 반환한다. */
export function loadConfig(_cwd?: string): GrandFleetConfig {
  const log = getLogAPI();
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    log.debug(LOG_SOURCE, "Config 기본값 사용");
    return createDefaultConfig();
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    log.debug(LOG_SOURCE, `Config 로드: ${configPath}`);
    return JSON.parse(raw) as GrandFleetConfig;
  } catch {
    log.debug(LOG_SOURCE, "Config 기본값 사용");
    return createDefaultConfig();
  }
}

/** 설정을 저장한다. */
export function saveConfig(_cwd: string, config: GrandFleetConfig): void {
  const dirPath = ensureConfigDir();
  const configPath = path.join(dirPath, CONFIG_FILE);
  getLogAPI().debug(LOG_SOURCE, `Config 저장: ${configPath}`);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/** 설정에 함대 항목을 추가하거나 갱신한다. */
export function addFleetEntry(
  config: GrandFleetConfig,
  entry: FleetEntry,
): void {
  const existingIndex = config.fleets.findIndex((fleet) => fleet.id === entry.id);
  if (existingIndex >= 0) {
    config.fleets[existingIndex] = entry;
    return;
  }

  config.fleets.push(entry);
}

/** 설정에서 함대 항목을 제거한다. */
export function removeFleetEntry(
  config: GrandFleetConfig,
  fleetId: string,
): void {
  config.fleets = config.fleets.filter((fleet) => fleet.id !== fleetId);
}
