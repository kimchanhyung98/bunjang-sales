---
name: bunjang
description: Start bunjang-assistant capability discovery and safe execution guidance. Match aliases like 번개장터툴, 번개장터 도구, 번장툴, bunjang tool, bunjang tools, and bunjang assistant.
argument-hint: "[task]"
---

Use bunjang-assistant tools for the user's request:

`$ARGUMENTS`

Treat short natural-language names such as `번개장터툴`, `번개장터 도구`, `번장툴`, `bunjang tool`, `bunjang tools`, and `bunjang assistant` as the same bunjang-assistant entrypoint.

Start from the bundled bunjang skill instructions:

- `skills/bunjang/SKILL.md`
- `skills/bunjang/docs/capability-registry.md`
- `skills/bunjang/docs/execution-contract.md`
- `skills/bunjang/docs/cli-usage.md`

Default flow:

1. Confirm the wrapper is ready with `npx -y --package=github:kimchanhyung98/bunjang-assistant -- bunjang-assistant-run auth.status`. The first run downloads and prepares the CLI and can take up to a few minutes — tell the user before starting.
2. Route the user's task to the smallest supported domain reference:
   - Listing search / detail / chat / favorites / purchase-ready check → `skills/bunjang/references/marketplace.md`
   - Price lookup ("시세", "중고가", "판매가 추천") → `skills/bunjang/references/price.md`
   - Sales workflow from a product directory, including explicit bypass registration → `skills/bunjang/references/sales.md`
   - Browser-only login or final posting steps → `skills/bunjang/references/browser.md`
3. Execute CLI work only through `npx -y --package=github:kimchanhyung98/bunjang-assistant -- bunjang-assistant-run <capabilityId> '<paramsJson>'`. Capability ids and login policy come from `src/config.js`; do not invent raw `bunjang-cli` flags.
4. Report each step as `executed`, `login_required`, or `manual_only`. For `login_required`, run `npx -y --package=github:kimchanhyung98/bunjang-assistant -- bunjang-assistant-run auth.status`; if not logged in, tell the user to finish browser login (the CLI prints the URL) and pause until they confirm.
5. Final listing registration is off by default. Enable bypass mode only when the current request explicitly names bypass mode and the registration scope. Treat that activation as approval, validate the form, click `등록하기` once, verify the result, and never retry automatically when the result is unclear. Bypass mode does not carry across requests.
6. Hard stops — never perform: `auth.login` itself, starting or confirming a purchase (`purchase.start`, `purchase.confirm`), account setting changes, or uploading user photos/credentials to any third-party service.
7. If the user asks for analytics the CLI does not expose, say so plainly and offer the closest supported read-only check (listing search, item detail, favorite list, chat read).

If the slash command is invoked with no task, perform the wrapper-readiness check, then invite the user with a short prompt such as "어떤 번개장터 작업을 도와드릴까요? 예: 시세 확인, 판매글 초안, 채팅 확인." Do not present a setup menu.
