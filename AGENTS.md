# Cockpit

> **SBLUEMIN의 개인 에이전트 도구**
>
> [pi-coding-agent](https://github.com/badlogic/pi-mono)를 기반으로 커스터마이징한 중앙 에이전트 조종실.
> Claude Code, Codex CLI, Gemini CLI를 단일 인터페이스에서 통합 운용하는 것이 핵심 목적이다.

---

# Pi 온보딩 지침

이 문서는 `pi/` 디렉토리 내의 설정 파일들을 `~/.pi/agent/`에 **심볼릭 링크**로 등록하는 절차를 정의합니다.

> **실행 주체**: AI 에이전트가 이 문서를 읽고 심링크 생성을 수행합니다.

---

## 대상 파일

`pi/` 디렉토리 내의 모든 **파일**을 대상으로 하되, 아래를 **제외**합니다:

- `AGENTS.md`
- 하위 디렉토리 (`extensions/` 등) — 각각 자체 `AGENTS.md`를 가짐

| 원본 | 심링크 |
|---|---|
| `pi/settings.json` | `~/.pi/agent/settings.json` |

---

## 수행 절차

1. **대상 디렉토리 확인**: `~/.pi/agent/`가 없으면 생성.
2. **파일 순회**: 대상 파일 각각에 대해 아래를 반복:
   - 대상 경로에 파일이 **존재하지 않으면** → 심링크 생성
   - 이미 **올바른 심링크**인 경우 (소스와 동일한 대상을 가리킴) → **스킵**
   - **일반 파일**이거나 **다른 심링크**인 경우 → `.bak` 확장자로 **백업** 후 삭제
3. **심링크 생성**:

   **macOS / Linux (Bash)**:

   ```bash
   ln -s "<소스 절대경로>" "<대상 경로>"
   ```

   **Windows (PowerShell)**:

   ```powershell
   cmd /c mklink "<대상 경로>" "<소스 절대경로>"
   ```

   > Windows 환경에서는 PowerShell 5.1의 `New-Item -SymbolicLink` 대신 `cmd /c mklink`을 사용합니다 (개발자 모드 활성화 필요).

4. **검증**: 생성된 각 심링크가 올바른 소스를 가리키는지 확인.
