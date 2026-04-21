<div align="center">
    <h1>pi-fleet</h1>
    <img src=".github/logo.png" alt="pi-fleet" width="640" />
    <h3><em>One Fleet. All LLMs.</em></h3>
</div>

<p align="center">
    <strong>Claude Code, Codex CLI, Gemini CLI를 하나의 통합 인터페이스로 운용하는 멀티 LLM 오케스트레이션 킷 — 네이티브 CLI를 직접 사용하며, API 래핑이나 프록싱 없음.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.ko.md">한국어</a>
</p>

---

## 동기

각 LLM CLI는 서로 다른 강점을 가지고 있습니다 — Claude는 추론, Codex는 빠른 코드 생성, Gemini는 대용량 컨텍스트 분석. 하지만 모두 독립적으로 실행됩니다. 하나의 작업에 여러 LLM의 강점을 조합하려면 별도의 터미널을 오가며 컨텍스트를 복사하고, 결과를 수동으로 조율해야 합니다.

pi-fleet는 LLM 에이전트를 해군 **함대(Fleet)** 내의 **항공모함(Carrier)**으로 다루어 이 문제를 해결합니다. 중앙의 Admiral이 여러 Carrier를 병렬로 지휘하며, 각 Carrier는 전문화된 Captain 페르소나의 명령을 받습니다. 한 번의 명령으로 함대 전체가 함께 실행됩니다.

## 해군 함대 계층 구조

4단계 지휘 체계가 사용자, 오케스트레이터, 에이전트를 명확한 역할로 매핑합니다:

- **Admiral of the Navy (대원수)** — 사용자. 전략을 수립하고 명령을 내립니다.
- **Fleet Admiral (사령관)** — grand-fleet 모드의 다중 함대 오케스트레이터.
- **Admiral (제독)** — 워크스페이스 PI 인스턴스. 작전을 기획하고 Carrier를 배치합니다.
- **Captain (함장)** — Carrier 에이전트의 지휘관 페르소나.

**Carrier**는 독립된 설정을 가진 CLI 도구의 실행 인스턴스입니다. **Captain**은 이를 지휘하는 페르소나(예: Chief Engineer, Scout Specialist)입니다.

## Carriers

7개의 기본 Carrier가 각각 고유한 작전 역할을 수행합니다:

- **Genesis** — Chief Engineer. 구현, 통합, 코드 전달.
- **Athena** — Strategic Planning Officer. 요구사항 명확화 및 구조화된 작업 계획.
- **Oracle** — Strategic Technical Advisor. 읽기 전용 아키텍처 결정 및 트레이드오프 분석.
- **Sentinel** — QA & Security Lead. 코드 리뷰, 결함 탐지, 취약점 헌팅.
- **Vanguard** — Scout Specialist. 코드베이스 탐색, 심볼 추적, 웹 리서치.
- **Echelon** — Chief Intelligence Officer. GitHub 인텔리전스 및 외부 저장소 분석.
- **Chronicle** — Chief Knowledge Officer. 문서화, 변경 로그, 변경 영향 보고.

## 기능

### 멀티 LLM 오케스트레이션

- 통합 진행 상황 추적과 함께하는 병렬 Carrier 실행
- Carrier별 모델 및 추론 레벨 설정
- 다양한 운용 모드를 위한 프로토콜 시스템 (Fleet Action, Positive Control)

### Task Force

- 단일 Carrier의 응답을 여러 CLI 백엔드에서 동시에 교차 검증
- 접근 방식 비교, 사각지대 탐지, 멀티 모델 합의 도출

### Agent Panel

- 모든 활성 Carrier의 실시간 스트리밍 UI
- Carrier 슬롯 간 인라인 내비게이션
- 집중 모니터링을 위한 상세 뷰 토글

### HUD

- 상태 바와 푸터를 갖춘 통합 에디터
- 메타 프롬프팅 및 추론 레벨 컨트롤
- 자동 세션 요약 및 씽킹 타이머

## 단축키

| 키 | 동작 |
|-----|--------|
| `Alt+H` / `Alt+L` | 이전 / 다음 Carrier 슬롯으로 이동 |
| `Alt+P` | Agent Panel 토글 |
| `Alt+J` / `Alt+K` | Agent Panel 높이 확대 / 축소 |
| `Alt+S` | 에디터 내용 보관 / 복원 |
| `Alt+O` | Fleet 상태 및 모델 설정 오버레이 |
| `Alt+T` | 활성 ACP 프로바이더를 오버레이 셸로 실행 |
| `Alt+X` | 활성 Carrier 실행 취소 |
| `Alt+Shift+M` | 활성 Carrier의 모델 및 추론 설정 변경 |
| `Alt+M` | 메타 프롬프팅으로 입력 개선 |
| `Alt+R` | 추론 레벨 순환 (Off → Low → Medium → High) |
| `Alt+1` | Fleet Action 프로토콜로 전환 |
| `Alt+.` | 단축키 도움말 오버레이 |
| `Alt+/` | 설정 오버레이 |
| `Ctrl+Enter` | Carrier 상세 뷰 토글 |

## 설치

자세한 설치 방법은 [SETUP.md](SETUP.md)를 참조하세요.

> **AI 에이전트로 빠른 시작** — 아래를 LLM 에이전트에 복사하여 붙여넣으세요:
>
> Install and configure pi-fleet by following the instructions here: `https://raw.githubusercontent.com/sbluemin/pi-fleet/main/SETUP.md`

## 라이선스

MIT
