# bunjang-assistant

이 문서는 설치된 `bunjang` 번들이 어떤 역할을 하는지 설명합니다.

## 역할

- 공개 진입점 스킬 `bunjang`
- capability 레지스트리와 실행 계약
- 시세 조회, 판매글 작성과 명시적 bypass 모드 등록, 번개장터 운영 참조 문서
- Codex와 Claude 플러그인 메타데이터
- `bunjang-cli` 래퍼

## 경계

- 이 번들은 번개장터 서비스나 `bunjang-cli` 자체를 포함하지 않습니다.
- 실제 실행은 npm dependency `bunjang-cli`와 저장소 로컬 래퍼가 담당합니다.
- 최종 구매와 계정 설정 변경은 수동 전용입니다.
- 최종 판매글 등록은 기본적으로 수동이며, 현재 요청에서 bypass 모드와 등록 범위를 명시한 경우에만 브라우저에서 수행합니다.
- macOS Intel과 Apple Silicon에서 Codex와 Claude만 지원 대상으로 둡니다.

## 읽는 순서

1. `SKILL.md`
2. `docs/capability-registry.md`
3. `docs/execution-contract.md`
4. `references/routing.md`
5. 요청별 참조 문서
