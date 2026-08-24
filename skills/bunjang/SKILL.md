---
name: bunjang
description: macOS의 Codex와 Claude AI 에이전트에서 bunjang-assistant와 bunjang-cli를 사용할 때 적용한다. 번개장터 시세 조회, 상품 검색과 후보 순위화, 상품 상세 확인, 채팅, 관심상품, 구매 가능 여부 확인, 사용자가 지정한 상품 디렉토리 기반 판매글 작성과 명시적 bypass 모드 등록을 처리한다. 번개장터툴, 번개장터 도구, 번장툴, bunjang tool, bunjang tools, bunjang assistant 별칭에도 적용한다.
---

# bunjang

번개장터 CLI 전역 진입점 스킬입니다.

먼저 볼 문서:

- [`docs/capability-registry.md`](./docs/capability-registry.md)
- [`docs/execution-contract.md`](./docs/execution-contract.md)
- [`docs/cli-usage.md`](./docs/cli-usage.md)
- 필요하면 [`docs/bunjang-assistant.md`](./docs/bunjang-assistant.md)

이 스킬의 역할:

- 사용자의 자연어 요청을 번개장터 CLI 운영, 시세 조회, 판매글 작성 중 하나로 라우팅합니다.
- 공개 호출 표면은 이 `bunjang` 하나만 사용합니다.
- 상세 절차는 내부 참조 문서에서 이어서 확인합니다.
- `번개장터툴`, `번개장터 도구`, `번장툴`, `bunjang tool`, `bunjang assistant`처럼 짧게 부르면 모두 이 스킬 호출 의도로 해석합니다.
- Claude Code 플러그인 표면의 정식 슬래시 진입점은 `/bunjang-assistant:bunjang [작업]`입니다. host가 bare command를 따로 노출할 때만 `/bunjang [작업]`을 보조 진입점으로 취급하고, 그 외 표면에서는 “번장 판매글 작성해줘”, “시세 확인해줘”, “찜했던거 가격 알려줘” 같은 자연어 요청을 직접 처리합니다.

사용자 경험 기준:

- 사용자는 비개발자일 수 있습니다. 먼저 사용자의 업무 문장을 그대로 받아 가능한 작업, 로그인 필요 여부, 수동 확인이 필요한 지점을 짧게 설명하고 직접 진행합니다.
- 정상 흐름에서 사용자에게 터미널 명령, 경로, package manager를 길게 설명하지 않습니다. 그런 정보는 실패 원인을 보고할 때만 짧게 씁니다.
- 사용자가 직접 해야 하는 일은 브라우저 로그인 완료, 기본 모드의 판매글 최종 검토와 등록, 구매 확정처럼 실제로 대신 할 수 없거나 대신 하면 안 되는 행동만 남깁니다.
- 요청한 기능이 `bunjang-cli` 또는 이 래퍼에 없으면 꾸며내지 않습니다. 가능한 대체 조회가 있으면 수행하거나 제안합니다.

기본 시작점:

1. 첫 실행은 CLI를 내려받아 준비하느라 수십 초~수 분 걸릴 수 있습니다. 사용자에게 먼저 알리고 진행합니다.
2. 준비 확인은 `npx -y --package=github:kimchanhyung98/bunjang-assistant -- bunjang-assistant-run auth.status`로 합니다.
3. CLI 작업은 항상 `npx -y --package=github:kimchanhyung98/bunjang-assistant -- bunjang-assistant-run <capabilityId> '<paramsJson>'`를 사용합니다.
4. `src/config.js`에 등록되지 않은 원시 `bunjang-cli` 명령은 직접 조합하지 않습니다.
5. `executed`, `login_required`, `manual_only` 상태를 구분해 보고합니다.

도메인 라우팅:

- 상품 검색, 상세 조회, 채팅, 관심상품, 구매 가능 여부: [`references/marketplace.md`](./references/marketplace.md)
- “A 상품 시세 알려줘”, “중고가 얼마야”, “판매가 추천”: [`references/price.md`](./references/price.md)
- “번개장터 판매글 작성해줘”, “상품 폴더로 판매 초안 써줘”, “A 디렉토리의 상품들 판매글 작성해”: [`references/sales.md`](./references/sales.md)
- 브라우저 로그인/판매글 폼 입력: [`references/browser.md`](./references/browser.md)
- 전역 탐색 규칙과 공개/내부 경계: [`references/routing.md`](./references/routing.md)

실행 원칙:

- public read는 로그인 없이 실행합니다.
- 채팅, 관심상품 변경, 구매 가능 여부 확인은 래퍼의 로그인 사전 확인을 따릅니다.
- `auth.login`, 구매 시작·확정, 계정 설정 변경은 수동 전용입니다.
- 판매글 자동화는 기본적으로 되돌릴 수 있는 초안 입력까지만 수행합니다. 사용자가 현재 요청에서 bypass 모드와 등록 범위를 명시하면 최종 판매글 등록까지 수행할 수 있습니다.
- 문서와 `src/config.js`에 없는 기능, 숨은 파라미터, 관리자 UI 절차는 추정하지 않습니다.

bypass 모드:

- 기본값은 꺼짐이며 이전 요청의 활성화 상태를 이어받지 않습니다.
- 사용자가 “bypass 모드로 등록해”, “bypass로 최종 등록까지 진행해”처럼 현재 요청에서 명시한 경우에만 켭니다.
- 활성화 문장 자체를 최종 등록 승인으로 취급하며 같은 범위에 대해 별도 재확인을 요구하지 않습니다.
- 대상 상품 또는 상품 디렉토리 범위가 불명확하면 등록하지 않고 범위를 확인합니다.
- 폼 검증 뒤 `등록하기`를 한 번만 클릭하고 결과를 확인합니다. 결과가 불명확하면 자동으로 다시 클릭하지 않습니다.

하드 스톱:

- bypass 모드가 아니면 `등록하기`를 누르지 않습니다.
- 구매 시작과 최종 확정을 실행하지 않습니다.
- 계정 설정을 변경하지 않습니다.
- 사용자 촬영 사진, 로그인 정보, 계정 정보는 번개장터 판매글 입력 외 제3자 서비스(이미지 호스팅, 외부 분석/OCR API, 클라우드 저장소 등)에 업로드하지 않습니다.
- 고객/클라이언트용 기업 표면, Cursor, Desktop MCP, 호스팅 문서, 다국어 릴리스, 스케줄러를 추가하지 않습니다.

이 스킬은 공개 진입점만 제공합니다. 세부 실행 지침은 모두 `references/` 아래 내부 자산으로 유지합니다.
