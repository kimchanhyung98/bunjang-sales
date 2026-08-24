<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo-dark.svg">
    <img src="logo-light.svg" alt="번개장터 AI" width="440">
  </picture>
</p>

# bunjang-ai-toolkit

> ⚠️ 번개장터 상점을 AI로 운영하기 위한, 실험적 플러그인 입니다.  

번개장터 시세 조회, 매물 검색, 채팅, 찜 관리, 판매글 작성과 명시적 bypass 모드 등록을 위한 스킬입니다.

[`bunjang-cli`](https://github.com/pinion05/bunjangcli)를 안전하게 호출하는 Node 래퍼와 Codex/Claude 플러그인 메타데이터를 제공합니다.

## 설치

Claude Code에서는 채팅창에 아래 두 줄을 입력합니다.

```text
/plugin marketplace add kimchanhyung98/bunjang-assistant
/plugin install bunjang-assistant@bunjang-assistant
```

Codex에서는 마켓플레이스를 등록한 뒤 플러그인을 추가합니다.

```bash
codex plugin marketplace add --ref main https://github.com/kimchanhyung98/bunjang-assistant.git
codex plugin add bunjang-assistant@bunjang-assistant
```

## 사용

Codex 또는 Claude를 실행하고, 다음과 같이 요청합니다.

```text
번개장터에서 아이폰 15 시세 알려줘
이 매물 상세 확인해줘: 123456
찜했던 상품들 가격 알려줘
~/products 경로의 상품들 판매글 작성해
```

`번개장터`, `번장`, `bunjang tool`, `bunjang assistant`처럼 짧게 불러도 같은 스킬로 라우팅됩니다.

## 동작 범위

- AI가 대신 처리하는 작업: 매물 검색, 시세 조회, 상품 상세 확인, 찜·채팅 관리, 구매 가능 여부 확인, 판매글 초안 작성, 명시적 bypass 모드에서 판매글 최종 등록.
- 사용자가 직접 해야 하는 작업: 번개장터 브라우저 로그인, 기본 모드의 판매글 `등록하기` 클릭, 최종 구매 확정, 계정 설정 변경.
- 채팅·찜·구매 가능 여부 확인은 번개장터 로그인이 필요합니다. macOS만 지원합니다.

## 자세히

- 동작 원칙과 라우팅: [`skills/bunjang/SKILL.md`](skills/bunjang/SKILL.md)
- 판매글 절차: [`skills/bunjang/references/sales.md`](skills/bunjang/references/sales.md)
- 시세 조회 절차: [`skills/bunjang/references/price.md`](skills/bunjang/references/price.md)
