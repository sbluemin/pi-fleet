# Auto Research 통합 최종 계획 (Final Integration Plan)

이 문서는 pi-fleet 및 사용자 애플리케이션의 자율 연구/개선 루프(Auto Research) 통합을 위한 최종 아키텍처 및 실행 계획을 정의합니다.

## 1. 개요 및 핵심 결론

본 계획의 최종 방향성은 **fleet-dev-first + Endeavour 전용 carrier + thin experiment layer + app-improve profile**로 정의됩니다. LLM Wiki는 핵심 MVP 의존성(core MVP dependency)이 아니라, **Post-MVP durable memory adapter**로서 추후 연동됩니다.

*   **실행 환경 단순화 (fleet-dev-first & thin experiment layer)**: 거대한 기반 인프라를 신규 구축하지 않고, 얇은 실험 계층(thin experiment layer)만 도입합니다. `fleet-dev`가 제공하는 환경(`PI_FLEET_DEV=1`, 확장 로드, dev boot/RISEN 컨텍스트 등)을 최대한 재사용합니다.
*   **Endeavour 전용 Carrier**: `Endeavour` Carrier가 전체 연구 루프의 주체(Owner)가 됩니다.
*   **프로파일 분리**: 자기 개선을 위한 `self-improve` 프로파일과 사용자 애플리케이션 분석을 위한 `app-improve` 프로파일로 구분하여 타겟 스코프를 분리합니다.
*   **Post-MVP 메모리 분리**: 단기 실험 데이터(scratch ledger)를 MVP의 필수 단일 진실 공급원(SSOT)으로 사용하며, 장기 보존 지식(durable memory)을 위한 LLM Wiki 연동은 Post-MVP 단계로 분리합니다. 기존 `JobStreamArchive`는 짧은 TTL과 제약으로 인해 연구 데이터의 SSOT로 사용하지 않습니다.

## 2. 저장소 책임 분리 (Storage Responsibility)

데이터의 성격에 따라 책임 저장소를 다음과 같이 분리합니다. MVP 기준으로는 단기 실험 원장만이 필수 SSOT입니다.

### 2.1. 단기 실험 원장 (Trial Scratch Ledger) [MVP 필수 SSOT]
진행 중인 개별 실험(trial)의 상태, 실행 스크립트, 중간 결과를 기록하는 임시 원장이며, MVP 구현의 유일한 필수 진실 공급원입니다.
*   **경로**: `.fleet/research/<id>/` 하위 파일들
*   **주요 파일**:
    *   `research-session.md`: 세션 개요 및 진행 상태
    *   `trials.jsonl`: 메트릭 및 실험 성공/실패 기록
    *   `run.sh`: 벤치마크 및 실행 스크립트
    *   `checks.sh`: 검증 스크립트

### 2.2. 장기 지식 및 AAR (Durable Memory / Approved Knowledge) [미래 연동 대상]
검증된 지식과 승인된 사후 강평(AAR)을 보관하는 영구 지식 계층으로, MVP 이후(Post-MVP) 미래 연동 대상입니다.
*   **경로**: `.fleet/knowledge/` 하위 시스템
*   **구조**: `raw/`, `wiki/`, `schema/`, `log/`, `queue/`, `archive/`, `conflicts/`, `index.json` 등

## 3. LLM Wiki 통합 방침 (Post-MVP)

LLM Wiki(`experimental-wiki`)는 미래 연동 시 장기 기억 저장소로 활용되며, 다음의 정책을 따릅니다.

*   **역할 한정**: LLM Wiki는 단기 실험 원장(trial ledger)을 대체하지 않습니다. 세션 AAR, 승인된 연구 지식(approved research knowledge), 다음 실험을 위한 브리핑 데이터 용도로만 사용됩니다.
*   **독립적 동작**: MVP 구현에는 `experimental-wiki`가 없어도 빌드, 테스트 및 전체 루프 동작이 가능해야 합니다.
*   **의존성 격리**: `fleet/`의 research 모듈이 `experimental-wiki`를 직접 import하여 사용하는 것은 영구히 금지됩니다. 미래 연동은 파일 시스템 계약(file contract)과 선택적 도구 호출(optional wiki tool use) 기반으로 구현하며, 안정화 이후 공용 라이브러리(shared library)로 승격합니다.
*   **승인 프로세스**: Wiki 패치(patch)는 즉시 반영되지 않으며, 대기열(queue)에 등록된 후 인간의 승인(human approval)을 거쳐 반영됩니다. (AAR 로그 추가는 `auto_apply`가 설정된 경우 예외)

## 4. 데이터 흐름 (Data Flow)

연구 루프는 목적에 따라 두 가지 프로파일로 나뉘어 실행됩니다. 두 프로파일은 동일한 원장 구조를 사용합니다.

*   **self-improve 프로파일**:
    *   **대상**: pi-fleet 자체 및 내부 확장 모듈.
    *   **흐름**: `fleet-dev` 환경 내에서 실행되며, 자체 코드베이스를 분석하고 내부 벤치마크 및 테스트를 통과하는지 검증합니다.
*   **app-improve 프로파일**:
    *   **대상**: 사용자의 일반 애플리케이션 프로젝트.
    *   **흐름**: 타겟 스코프를 사용자 프로젝트로 전환하고, 사용자 지정 `benchmark_command`를 주입하여 외부 애플리케이션의 개선 루프를 구동합니다.

## 5. Endeavour Carrier 책임 (Responsibilities)

`Endeavour`는 연구 루프의 주체(Loop Owner)로서 다음의 책임과 제한을 가집니다.

*   **책임**:
    *   가설 수립 및 실험 설계 (Thin layer를 통한 `trials.jsonl`, `run.sh` 등 생성).
    *   실험 결과 분석 및 다음 단계 결정.
    *   도구를 통한 Admiral 핸드오프(Handoff) 요청.
*   **금지 사항 (제한)**:
    *   직접적인 타 Carrier 디스패치 (반드시 Admiral을 통해 Handoff 요청).
    *   자동 커밋 (Auto-commit) 수행 불가.
    *   무제한 반복 (Infinite loop) 금지. (명시적인 백프레셔 및 제한 로직 필요).

## 6. 구현 단계 (Waves)

구현은 다음 단계로 진행됩니다. LLM Wiki 연동은 Post-MVP로 이동되었습니다.

1.  **Wave 1: Thin ledger/tool trio**
    *   `.fleet/research/<id>/` 기반의 단기 실험 원장(`research-session.md`, `trials.jsonl`, `run.sh`, `checks.sh`) 스캐폴딩.
    *   실험 상태 읽기/쓰기를 위한 3종 도구(Tool Trio) 구현.
2.  **Wave 2: Endeavour carrier registration**
    *   `Endeavour` Carrier 프로필 등록 및 루프 오너 권한 부여.
    *   초기화(init) 및 세션 락(Session Lock) 메커니즘 구현.
3.  **Wave 3: Safety/backpressure**
    *   무한 루프 방지, Carrier 호출 제한, 에러 누적에 대한 백프레셔(backpressure) 구현.
    *   자동 커밋 금지 등 안전 장치 활성화.
4.  **Wave 4: Observability/reporting without LLM Wiki**
    *   실험 진행 상황 및 벤치마크 결과에 대한 관측성(Observability) 확보.
    *   AAR 및 메트릭 리포팅 기능(HUD 또는 로그 연동) 구현. (LLM Wiki 배제)
5.  **Wave 5: Downstream handoff policy**
    *   Admiral을 통한 Sentinel, Chronicle, Nimitz 등의 명시적 핸드오프 정책 확립.
    *   `self-improve` 및 `app-improve` 프로파일 라우팅 처리.
6.  **Wave 6: Bounded autonomous session smoke test**
    *   제한된 환경에서의 자율 세션 스모크 테스트 실행 및 검증.

*   **Post-MVP: LLM Wiki integration adapter**
    *   파일 계약 기반의 `.fleet/knowledge/` 연동.
    *   Wiki 도구 호출(`wiki_aar_propose`) 기능 구현 및 `auto_apply` 플래그 적용.

## 7. 품질 보증 게이트 및 인수 조건 (QA Gates & Acceptance Criteria)

### 7.1. MVP QA Gates
- [ ] **Gate 1**: `Endeavour` 실행 시 단일 세션 락이 정상 동작하여 병렬 실행 충돌을 방지하는가?
- [ ] **Gate 2**: 단기 실험 데이터는 `.fleet/research/<id>/`에만 기록되며, 이를 단일 진실 공급원으로 사용하는가?
- [ ] **Gate 3**: `Endeavour`가 직접 Carrier를 디스패치하지 않고, Admiral 도구를 통해서만 핸드오프를 수행하는가?
- [ ] **Gate 4**: 무한 루프 차단(Safety/backpressure) 로직이 정상적으로 개입하여 임계치 초과 시 실행을 중단하는가?

### 7.2. MVP 인수 조건 (Acceptance Criteria)
- [ ] `PI_FLEET_DEV=1` 환경에서 `self-improve` 사이클이 1회 이상 정상 완주되어야 한다.
- [ ] `JobStreamArchive` 없이 파일 시스템(`.fleet/research/<id>/trials.jsonl` 등)만으로 세션 상태 복원이 가능해야 한다.
- [ ] `app-improve` 프로파일 실행 시, 사용자 타겟 스코프 및 외부 `benchmark_command`가 정상 주입되어 구동되어야 한다.

### 7.3. Post-MVP QA Gates & Acceptance Criteria
- [ ] **Gate**: `fleet/` 모듈 코드 내에 `experimental-wiki` 모듈에 대한 직접적인 import 구문이 존재하지 않는가?
- [ ] **Gate**: 장기 지식은 `.fleet/knowledge/`로 올바르게 분리 저장되는가?
- [ ] **Acceptance**: LLM Wiki에 등록되는 변경 사항은 대기열(queue)에 진입하며, `auto_apply`가 없는 한 인간의 승인 대기 상태를 유지해야 한다.

## 8. 미결 결정 사항 (Unresolved Decisions)

본 계획 실행 과정에서 추가 협의가 필요한 사항입니다.

*   **Benchmark 기본값**: `app-improve` 프로파일에서 사용자가 `benchmark_command`를 명시하지 않았을 때의 기본 폴백(Fallback) 동작.
*   **Shell 실행 권한**: `run.sh` 및 `checks.sh` 실행 시 부여할 권한 수준 및 샌드박싱 필요성.
*   **단일 활성 세션**: 전역적으로 동시에 하나의 연구 세션만 허용할 것인가에 대한 정책 확정.
*   **Retention/GC 정책**: 단기 실험 원장(scratch ledger)에 대한 보존 기간(TTL) 및 만료 데이터 정리(Garbage Collection) 주기.
*   **Direct Dispatch 금지 유지 여부**: 초기에는 금지하나, 추후 최적화를 위해 일부 Carrier에 한해 직접 호출을 허용할 것인지에 대한 재검토.

### 8.1. Post-MVP 결정 사항
*   **LLM Wiki 활성화 조건**: 환경 변수 혹은 설정 파일 등 명시적인 켜기/끄기(opt-in/out) 기준.