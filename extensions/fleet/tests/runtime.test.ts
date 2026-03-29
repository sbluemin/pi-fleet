/**
 * runtime 단위 테스트
 *
 * internal/agent/runtime.ts의 핵심 계약을 검증합니다:
 * - initRuntime이 `.data` 디렉토리를 생성하는지
 * - 모델 설정 load/save가 올바른 경로에서 동작하는지
 * - 세션 매핑이 initRuntime → onHostSessionChange 흐름으로 동작하는지
 * - 미초기화 상태에서 graceful fallback이 동작하는지
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  initRuntime,
  onHostSessionChange,
  getSessionStore,
  getSessionId,
  getModelConfig,
  getDataDir,
} from "../internal/agent/runtime.js";
import { saveSelectedModels } from "../internal/agent/model-config.js";

let tmpDir: string;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "runtime-test-"));
}

function rmDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  rmDir(tmpDir);
});

describe("initRuntime", () => {
  it("존재하지 않는 dataDir을 자동으로 생성한다", () => {
    const deepDir = path.join(tmpDir, "core", ".data");
    expect(fs.existsSync(deepDir)).toBe(false);

    initRuntime(deepDir);

    expect(fs.existsSync(deepDir)).toBe(true);
    expect(getDataDir()).toBe(deepDir);
  });

  it("이미 존재하는 dataDir에 대해 에러 없이 동작한다", () => {
    initRuntime(tmpDir);
    initRuntime(tmpDir);
    expect(getDataDir()).toBe(tmpDir);
  });
});

describe("getModelConfig / saveSelectedModels", () => {
  it("초기 상태에서 빈 객체를 반환한다", () => {
    initRuntime(tmpDir);
    expect(getModelConfig()).toEqual({});
  });

  it("저장된 모델 설정을 올바르게 로드한다", () => {
    initRuntime(tmpDir);
    const config = { claude: { model: "opus" }, codex: { model: "gpt-5" } };
    saveSelectedModels(tmpDir, config);

    const loaded = getModelConfig();
    expect(loaded.claude?.model).toBe("opus");
    expect(loaded.codex?.model).toBe("gpt-5");
  });

  it("initRuntime 없이 호출하면 빈 객체를 반환한다 (graceful)", () => {
    const nonExistentDir = path.join(tmpDir, "nonexistent", "deep");
    initRuntime(nonExistentDir);
    expect(getModelConfig()).toEqual({});
  });

  it("새로 생성된 dataDir에서 첫 모델 저장이 ENOENT 없이 성공한다", () => {
    const deepDir = path.join(tmpDir, "brand", "new", "path");
    initRuntime(deepDir);

    expect(() => {
      saveSelectedModels(deepDir, { gemini: { model: "gemini-3" } });
    }).not.toThrow();

    const filePath = path.join(deepDir, "selected-models.json");
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe("세션 매핑 (sessionStore + onHostSessionChange)", () => {
  it("호스트 세션 변경 후 세션 매핑이 복원된다", () => {
    initRuntime(tmpDir);

    onHostSessionChange("test-session-1");
    const store = getSessionStore();
    store.set("claude" as any, "sub-session-abc");
    expect(store.get("claude" as any)).toBe("sub-session-abc");

    onHostSessionChange("test-session-2");
    expect(store.get("claude" as any)).toBeUndefined();

    onHostSessionChange("test-session-1");
    expect(store.get("claude" as any)).toBe("sub-session-abc");
  });

  it("getSessionId로 CLI별 sessionId를 조회할 수 있다", () => {
    initRuntime(tmpDir);
    onHostSessionChange("sid-1");
    const store = getSessionStore();
    store.set("codex" as any, "codex-session-xyz");

    expect(getSessionId("codex" as any)).toBe("codex-session-xyz");
    expect(getSessionId("claude" as any)).toBeUndefined();
  });

  it("미초기화 상태에서 getSessionStore는 noop store를 반환한다", () => {
    const freshDir = path.join(tmpDir, "fresh");
    initRuntime(freshDir);
    const store = getSessionStore();
    expect(store.get("claude" as any)).toBeUndefined();
    store.set("claude" as any, "some-id");
  });

  it("세션 매핑 파일이 session-maps/ 하위에 저장된다", () => {
    initRuntime(tmpDir);
    onHostSessionChange("persist-test");
    const store = getSessionStore();
    store.set("gemini" as any, "gem-sess-1");

    const sessionFile = path.join(tmpDir, "session-maps", "persist-test.json");
    expect(fs.existsSync(sessionFile)).toBe(true);

    const content = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
    expect(content.gemini).toBe("gem-sess-1");
  });
});
