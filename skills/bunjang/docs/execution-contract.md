# 실행 계약

이 문서는 설치된 `bunjang` 번들에서 따라야 하는 공통 실행 약속입니다.

## 기준

1. `src/config.js`
2. `src/cli.js`
3. `skills/bunjang/docs/capability-registry.md`
4. 이 문서

## 필수 문맥

- CLI 준비 여부(첫 실행은 내려받기/설치로 지연될 수 있음)
- 인증 상태
- 요청이 read인지, 상태 변경인지, 수동 전용인지

## CLI 준비 확인

```bash
npx -y --package=github:kimchanhyung98/bunjang-assistant -- bunjang-assistant-run auth.status
```

## 실행 규약

- `npx -y --package=github:kimchanhyung98/bunjang-assistant -- bunjang-assistant-run <capabilityId> '<paramsJson>'`만 사용합니다.
- 래퍼가 `--json`을 붙이고, capability ID를 실제 `bunjang-cli` 인자로 변환합니다.
- JSON이 아닌 출력은 사용 가능한 데이터가 아니라 조사해야 할 실패로 봅니다.
- 실패 메시지에는 capability ID와 주요 입력을 함께 보고합니다.

## 로그인 온보딩

- public read는 로그인 없이 실행합니다.
- 로그인 사전 확인 capability가 `login_required`를 반환하면 멈춥니다.
- 브라우저 로그인은 사용자가 직접 완료해야 합니다.
- 소셜 로그인 버튼 클릭, 계정 선택, 2FA, 권한 승인 같은 계정 행동을 대신하지 않습니다.
- 로그인 완료 뒤 `auth.status`를 다시 확인하고 원래 요청을 이어갑니다.

## 쓰기 작업 안전 규약

- 이 래퍼의 쓰기 성격 작업은 채팅 전송, 관심상품 변경처럼 제한된 capability만 허용합니다.
- 구매 시작/확정과 계정 설정 변경은 수동 전용입니다.
- 판매글 작성 자동화는 기본적으로 브라우저 폼 초안 입력까지만 허용합니다.
- 사용자가 현재 요청에서 bypass 모드와 등록 범위를 명시하면 검증된 판매글 폼의 `등록하기`를 한 번 클릭할 수 있습니다. 이 활성화는 요청 사이에 유지하지 않습니다.
- bypass 모드의 등록 결과가 불명확하면 중복 등록을 피하기 위해 자동으로 다시 클릭하지 않습니다.
- 사용자가 명시하지 않은 반복 실행, 스케줄링, approval 시스템을 만들지 않습니다.

## 자동화 출력

- 결과는 `executed`, `login_required`, `manual_only`를 구분합니다.
- 시세 조회는 가격 범위, 중앙값/평균 후보, 제외한 이상치, 근거가 된 listing 수를 보고합니다.
- 판매글 작업은 상품 디렉토리, 제목, 가격 근거, 업로드 이미지 수, bypass 모드 사용 여부와 등록 결과를 보고합니다.
