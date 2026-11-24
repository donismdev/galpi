# 회차별 개발 기록

앱 소스는 회차별 `snapshots/NN/` 폴더에 있다(`SNAPSHOTS.md`). 각 회차 기록의 경로는 해당 스냅샷 폴더 기준이다.

이 파일은 시작 템플릿이다. 받은 시점의 구현 상태는 전 회차 미착수다. 작업 AI는 실제 실행한 결과만 갱신한다.

| 회차 | 작업 | 상태 | 증거·미확인 항목 |
|---|---|---|---|
| 01 | 실행 뼈대와 첫 작업 화면 | 완료 (IME 실입력은 04회로) | S01.A·B·C 통과. 데스크톱 셸 실기동 캡처 2장(en·ko 재실행). 아래 01회 기록 |
| 02 | 작품 폴더 열기와 안전한 저장 기반 | 완료 (일부 실기기 항목은 자동 검증만) | S02.A·B·C 자동 통과. 실제 앱에서 네이티브 폴더 선택→새 작품 생성 확인. 아래 02회 기록 |
| 03 | 다음 화 생성과 외부 편집기 | 완료 | S03.A·B·C·D 통과. 실제 앱에서 VS Code(루트+원고 선택)·메모장 열기, 잘못된 편집기 경로 실패 처리 확인. 아래 03회 기록 |
| 04 | 내장 집필과 한글 입력 | 완료 (실제 키보드 IME는 작가 확인 필요) | S04.B·C·D 실제 앱 통과. S04.A는 WebView2 IME 조합 이벤트(CDP)로 통과, 실제 키보드 한글 IME는 디버그 탭 04.ime로 확인 남음. 아래 04회 기록 |
| 05 | 외부 변경·충돌·초안 복구 | 완료 | S05.A·B·C·D 실제 앱(debug exe) 통과. 아래 05회 기록 |
| 06 | 회차 커밋·판 비교·복원 | 미착수 | — |
| 07 | 회차 요약·다음 화 메모·퇴고 재확인 | 미착수 | — |
| 08 | 세계관 카드·범용 템플릿·사용자 태그 | 미착수 | — |
| 09 | 사건 입력과 회차·작중 시간·함께 보기 | 미착수 | — |
| 10 | 회귀 구간 링크와 그 시점의 능력 | 미착수 | — |
| 11 | 작품 검색 색인과 외부 수정 반영 | 미착수 | — |
| 12 | 빠른 열기와 본문 대목 검색 | 미착수 | — |
| 13 | 문장 연결·역링크·복선 회수 | 미착수 | — |
| 14 | 독립 창·참고 패널·배치 복원 | 미착수 | — |
| 15 | AI 참고 자료 선택과 복사 | 미착수 | — |
| 16 | 한영 교정 밑줄과 언어 완성 | 미착수 | — |
| 17 | 장편 1,000화 부하·검색 정확도·복구 측정 | 미착수 | — |
| 18 | 설치·이전 작품 복구·1.0 판정 | 미착수 | — |

## 회차 종료 시 아래 형식으로 한 단락 추가

- **상태** · 완료 / 부분 완료 / 진행중 / 보류. 구현·자동 검증·실기기 검증 결과를 구분한다.
- **작가가 확인할 동작** · 메뉴와 조작 순서, 기대 화면, 충돌·실패 시 다음 행동.
- **구현 증거** · 변경 파일·진입점 및 실제 데이터 경로를 저장소 상대 경로로 표기한다.
- **실행 증거** · 실행한 명령, 환경, 결과, 실패 재현 절차. 자동 검사가 통과했어도 실제 IME·VS Code·다중 모니터 결과는 별도다.
- **형식/결정 변경** · 이전 작품 호환과 기존 회차에 미치는 영향, 갱신한 문서.
- **다음 인계** · 확인이 남은 항목, 필요한 기기, 다음 작업에 쓸 함수·데이터·표본. 선행 미검증이 후속 작업과 독립이면 미검증 상태로 병행 준비할 수 있다.

---

## 01회 · 실행 뼈대와 첫 작업 화면 (2026-11-23)

> 앱 소스 위치: `snapshots/01/` (스냅샷 규칙 도입 후 이동). 아래 경로·명령은 그 폴더 기준이다.

- **상태** · 완료. 구현·자동 검증·데스크톱 실기동 확인 모두 통과. 한글 IME 실제 입력은 이번 화면에 입력란이 없어 04회로 넘긴다(미검증).
- **작가가 확인할 동작**
  1. 저장소 루트에서 `npm run tauri dev` → ‘galpi’ 창이 뜬다. 왼쪽에 **회차 / 회차 요약 / 타임라인 / 세계관**, 하단에 ‘데스크톱 앱’.
  2. 왼쪽 루트를 누르면 가운데 제목·설명이 바뀌고 선택 루트가 강조된다.
  3. 오른쪽 위 ‘화면 언어’에서 English 선택 → 메뉴·버튼·상태 문구가 즉시 영어로 바뀐다. 창을 닫고 다시 실행해도 English. 한국어로 돌리면 다음 실행부터 한국어.
  4. ‘작품 폴더 열기…’는 비활성이며 바로 아래에 ‘02회에서 연결’ 안내가 보인다(누르면 아무 일도 안 하는 가짜 버튼이 아님).
  5. 언어 저장이 실패하면 하단에 빨간 안내가 뜨고 이번 실행에만 적용된다.
- **구현 증거**
  - 데스크톱 진입점: `src-tauri/src/main.rs` → `src-tauri/src/lib.rs` (`get_app_settings`, `set_ui_language` 명령)
  - 기기별 설정: `src-tauri/src/settings.rs` → `%APPDATA%\dev.donism.galpi\settings.json` (`schemaVersion`, `uiLanguage`). 임시 파일 기록 후 rename. 없거나 깨지면 한국어 기본값, 깨진 파일은 지우지 않음. UTF-8 BOM 허용.
  - 루트 컴포넌트: `src/App.tsx` (네 루트 `ROOTS`), 스타일 `src/App.css`, 부트스트랩 `src/main.tsx`
  - 문구 리소스: `src/i18n/locales/ko.json`(기준), `src/i18n/locales/en.json` · 조회 `src/i18n/messages.ts`(`MessageKey` 타입은 ko에서 유도) · 언어 상태 `src/i18n/I18nProvider.tsx` · 저장소 선택 `src/settings/languageStore.ts`(데스크톱=Rust, 브라우저 미리보기=localStorage)
  - 키 검사: `src/i18n/keyCheck.ts` + CLI `scripts/check-i18n.ts`, 누락 fixture `tests/fixtures/i18n-missing-key/`
- **실행 증거** (Windows 11 Home 26200 x64, Node 24.12.0, npm, rustc/cargo 1.100.0 stable-x86_64-pc-windows-msvc, VS 2022 C++ 도구, WebView2 157.0.4341.60)
  - `npm run check` (= `check:web` + `check:rust`) 통과
    - `npm run typecheck` (tsc, src + vite.config/scripts/tests) 오류 0
    - `npm run check:i18n` → `OK - en, ko share the same keys`
    - `npm run test` (vitest 5.1.1, jsdom) 3 files / 13 tests 통과
    - `cargo fmt --check`, `cargo clippy --all-targets -D warnings` 경고 0, `cargo test` 5 tests 통과
  - **S01.A** · 자동: `src/App.test.tsx`(두 언어 네 루트, 즉시 전환, 재마운트 후 유지, 저장 실패 표시). 실기동: `settings.json`에 BOM 포함 `en`을 넣고 `npm run tauri dev` → 창 캡처에서 영어 네 루트·‘Desktop app’ 확인. 이어서 창에서 한국어로 바꾸자 `settings.json`이 앱 형식 `"uiLanguage": "ko"`로 다시 쓰였고(17:44:58), 재실행 캡처에서 한국어 네 루트·‘데스크톱 앱’ 확인.
  - **S01.B** · `node scripts/check-i18n.ts tests/fixtures/i18n-missing-key` → exit 1, `[en] roots.timeline: missing key`. `tests/i18n-cli.test.ts`가 이 출력을 검사한다.
  - **S01.C** · 데스크톱 셸: `npm run tauri dev`로 `target\debug\galpi.exe` 기동, 하단 ‘데스크톱 앱 / Desktop app’, 설정은 Rust가 앱 설정 폴더에 기록. 브라우저 개발 미리보기: `npm run dev` → http://localhost:1420, 하단 ‘브라우저 미리보기 (설정은 이 브라우저에만 저장)’, 영어 전환 후 새로고침 유지 확인(localStorage `galpi.uiLanguage`). 두 경로는 `isTauri()`로 구분.
  - Windows 조사(4번): UI 폰트 스택 `Pretendard → Malgun Gothic → …`, 이 PC에는 맑은 고딕(`malgun.ttf`)으로 표시. 기본 WebView = WebView2 157. 키보드 목록에 Microsoft 한국어 IME(0412) 있음. 앱 안 한글 **입력**은 입력란이 없어 미검증.
- **형식/결정 변경**
  - 제품명·창 제목 `galpi`, 번들 식별자 `dev.donism.galpi`. 문서의 작업명 ‘글쓰기 작업실’은 부제로 표시.
  - 작품 폴더 형식 변경 없음. 기기별 설정 `settings.json` schemaVersion 1 신설(작품 폴더 밖).
  - 템플릿의 `tauri-plugin-opener`와 예제 `greet` 명령 제거. 03회 외부 편집기 실행 때 필요한 방식으로 다시 결정.
  - 패키지 관리자는 npm, 잠금 파일 `package-lock.json`·`src-tauri/Cargo.lock` 커밋 대상.
- **다음 인계**
  - 04회: CodeMirror 6 + 한글 IME 실기기 검증 환경 = 위 PC(Win11 26200, WebView2 157, MS 한국어 IME). 조합 중 재렌더 주의: `I18nProvider`는 언어 변경 때만 리렌더.
  - 16회: 교정 후보 = WebView2 내장 spellcheck(검증 필요) vs Hunspell(ko 사전 라이선스 검토). 이번 회차엔 시험하지 않음.
  - 남은 정리: CSP가 `null`(템플릿 기본). 외부 자원을 쓰지 않으므로 02회 이후 파일 접근이 생길 때 CSP를 정하고 dev/빌드 양쪽에서 확인. 앱 아이콘은 Tauri 기본값.
  - 02회에 쓸 것: `settings.rs`의 임시 파일 → rename 패턴은 앱 설정 전용이다. 작품 파일 쓰기는 WORKSPACE_FORMAT의 쓰기 소유자·지문 규칙으로 따로 만든다. 최근 작품 경로는 같은 `settings.json`에 필드를 추가(기본값 정의)해 넣을 수 있다.

---

## 02회 · 작품 폴더 열기와 안전한 저장 기반 (2026-11-23)

> 앱 소스 위치: `snapshots/02/` (01에서 복사해 시작). 아래 경로·명령은 그 폴더 기준이다.

- **상태** · 완료. 구현·자동 검증 통과. 실제 앱에서는 폴더 선택 취소, 네이티브 폴더 선택 → 빈 폴더에 새 작품 생성 → 작품 화면까지 확인했다. 읽기 전용(두 번째 프로세스·권한)과 중단 후 재실행은 Rust 자동 테스트로만 검증했고 실제 앱 조작은 미검증이다.
- **작가가 확인할 동작**
  1. `npm run tauri dev` → ‘작품 폴더 선택…’ → 대화상자에서 **취소** → “폴더 선택을 취소했습니다. 바뀐 것은 없습니다.”
  2. 빈 폴더 선택 → ‘빈 폴더입니다’ → 작품 제목 입력 → ‘새 작품 만들기’ → 상단에 제목·경로·‘작품 닫기’. 폴더에 `workspace.json`, `episodes/` 등 고정 폴더와 `.galpi/`가 생긴다.
  3. ‘작품 닫기’ → 시작 화면의 ‘최근 작품’에서 ‘열기’ → 같은 작품(같은 작품 ID)으로 열린다.
  4. 다른 파일이 있는 폴더 → 항목 수 안내와 확인 체크 후에만 만들기. `episodes`·`lore` 같은 이름이 이미 있는 폴더 → 겹치는 이름 목록과 ‘대신 이 새 하위 폴더에 만들기’. 원래 폴더는 건드리지 않는다.
  5. 같은 작품을 두 번째 galpi에서 열면 ‘읽기 전용’ 배지와 이유. 더 새 형식의 작품은 읽기 전용이며 아무 파일도 바꾸지 않는다. 사라진 최근 작품은 오류와 ‘목록에서 빼기’.
- **구현 증거**
  - Rust 작품 코어 `src-tauri/src/workspace/`: `mod.rs`(inspect·create·open, `WorkspaceSession::read_file/write_file`, `ensure_leaf_folder`), `manifest.rs`(workspace.json·고정 폴더·init 표식), `paths.rs`(상대 경로 검증·루트 탈출 차단), `atomic.rs`(임시 파일 → 교체/새 파일 게시, 임시 파일 정리), `error.rs`(실패 코드 `WsError`, 읽기 전용 이유)
  - 명령 `src-tauri/src/lib.rs`: `inspect_folder`, `create_workspace`, `open_workspace`, `close_workspace`, `current_workspace`, `forget_recent_workspace` (+ 01의 설정 명령). 폴더 대화상자 `tauri-plugin-dialog`, 권한 `capabilities/default.json`의 `dialog:allow-open`.
  - 최근 작품: `src-tauri/src/settings.rs`의 `recentWorkspaces`(기기 설정, 최대 10, 경로 기준 중복 제거). 01 형식 설정 파일도 그대로 읽힌다.
  - 화면: `src/workspace/api.ts`(Rust 계약 타입·백엔드), `WorkspaceProvider.tsx`(작품 상태, 늦은 응답 차단), `StartPanel.tsx`(시작·결정 화면), `src/App.tsx`(상단 작품 표시·닫기, 읽기 전용·복구 안내). 문구 `src/i18n/locales/{ko,en}.json`의 `workspace.*`, `errors.*`.
  - 실제 데이터 경로: 작품 폴더 `<작품>/workspace.json`, `<작품>/.galpi/{lock,tmp/,init.json}` · 기기 설정 `%APPDATA%\dev.donism.galpi\settings.json`
- **실행 증거** (01과 같은 PC: Windows 11 Home 26200, Node 24.12.0, rustc 1.100.0 MSVC, WebView2 157)
  - `npm run check` 통과: 타입 검사, `check:i18n` OK, vitest **22**개(5회 반복 통과), `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, cargo test **29**개.
  - **S02.A** · `s02a_create_close_reopen_keeps_id_on_korean_space_paren_path`: `내 소설 (초고) 2026` 경로에서 생성 → 닫기 → 재열기 시 같은 작품 ID, 표시 경로에 `\?\` 없음. 실제 앱: 작가가 네이티브 대화상자로 `Documents\새 폴더`를 골라 ‘포탈 속으로’를 만들었고, 폴더에 workspace.json(schemaVersion 1)과 고정 폴더 13개, `.galpi/lock`, 최근 작품 항목이 생긴 것을 읽기만 해서 확인.
  - **S02.B** · 초기화 중단: `s02b_interrupted_init_resumes_with_same_id_at_every_step`(표식 후/폴더 후/manifest 후 세 지점에서 멈춤 → 재시도·열기 시 같은 ID). 디버그 빌드에서는 `GALPI_FAILPOINT=init-after-marker|init-after-dirs|init-after-manifest`로 실제 프로세스를 그 지점에서 강제 종료할 수 있다(실제 앱으로는 미검증). 폴더 선택 취소: 실제 앱에서 UI Automation으로 대화상자 ‘취소’ → 취소 안내 확인 + `workspace.test.tsx`. 읽기 전용: `s02b_read_only_manifest_opens_read_only`(읽기 전용 속성). 상위 스키마: `s02b_newer_schema_opens_read_only_and_is_never_modified`(시도 전후 폴더 전체 해시 동일). 동시 열기: `s02b_same_folder_opened_twice_second_is_read_only`(Windows LockFileEx, 닫으면 다시 쓰기 가능). 남은 임시 파일 정리: `s02b_leftover_temp_files_are_cleaned_on_open`.
  - **S02.C** · `s02c_unrelated_files_survive_create_and_need_confirmation`, `s02c_name_conflicts_are_reported_and_untouched`(확인 없는 시도·충돌 시도 전후 폴더 전체 SHA-256 동일, 제안 하위 폴더 생성 후에도 원래 항목 해시 동일), `s02c_writes_cannot_leave_the_root_or_touch_app_dir`(`../`, 드라이브 경로, `.galpi/`), `paths::junction_pointing_outside_is_refused`(실제 디렉터리 정션으로 루트 탈출 차단), `write_requires_the_version_that_was_read_and_is_idempotent`(외부 수정 후 옛 해시로 쓰기 거절·외부 문장 보존, 같은 요청 ID 재시도 1회).
  - 화면: `src/workspace/workspace.test.tsx` 9개(빈 폴더 생성·닫기·최근, 취소, 확인 필요, 충돌·제안, 상위 스키마 읽기 전용, 이어서 완료, 재시도, **A를 늦게 응답시키고 B를 연 뒤에도 B 유지**, 사라진 최근 작품).
- **형식/결정 변경**
  - 작품 폴더 형식 schemaVersion 1 확정(`WORKSPACE_FORMAT.md` ‘02회에 정한 구현 규칙’ 추가). 01회엔 작품 폴더가 없었으므로 이전 작품 호환 영향 없음.
  - 기기 설정 `settings.json`에 `recentWorkspaces` 추가(기본값 빈 목록, schemaVersion 1 유지).
  - 새 의존성: Rust `tauri-plugin-dialog`, `uuid`, `sha2`, `time`, `dunce` · npm `@tauri-apps/plugin-dialog`.
  - 개발 저장소 구조: 회차별 스냅샷(`SNAPSHOTS.md`), Rust 빌드 캐시 공유(`.cargo/config.toml` → 저장소 루트 `target/`).
  - 계획 변경분 CH1~CH5를 `PLAN_CHANGES.md`와 각 회차 카드·QUALITY_GATES Q12~Q16·WORKSPACE_FORMAT에 반영.
- **다음 인계**
  - 03회: 회차 생성은 `WorkspaceSession::write_file`(요청 ID + `Expect::Absent`)로 만들고, 위 ‘요청 ID와 재시도’ 3번대로 `episode.json`에 `requestId`를 남긴다. 화면은 `useWorkspace().current.sessionId`를 명령에 함께 보낸다.
  - 실제 앱 미검증: 두 번째 galpi 프로세스로 같은 작품 열기(읽기 전용 배지), 폴더 권한 거부, `GALPI_FAILPOINT`로 강제 종료 후 ‘이어서 완료’. 필요한 것: 같은 PC에서 두 실행본, 권한을 바꿀 수 있는 테스트 폴더.
  - 남은 정리: CSP는 아직 `null`(01과 같음). 작품을 2개 이상 동시에 여는 기능은 14회 창 작업 때 `AppState.workspace`를 다중 세션으로 넓힌다.

---

## 03회 · 다음 화 생성과 외부 편집기 (2026-11-23)

> 앱 소스 위치: `snapshots/03/` (02에서 복사해 시작). 아래 경로·명령은 그 폴더 기준이다.

- **상태** · 완료. 구현·자동 검증·실제 Windows 확인(VS Code, 메모장, 편집기 실패) 모두 통과.
- **작가가 확인할 동작**
  1. `npm run tauri dev` → 작품 열기 → 왼쪽 ‘회차’ → **다음 화 쓰기 (N화)** 한 번 → 새 회차가 만들어지고 선택되며, 기본 편집기(처음엔 VS Code)에 작품 폴더와 새 원고가 열린다. 화면에 “VS Code에 열기 요청을 보냈습니다. 편집기를 닫아도 회차 상태와 이력은 바뀌지 않습니다.”
  2. 회차 상세에 원고 파일의 절대 경로, **VS Code(으)로 다시 열기**, **메모장(으)로 열기**. 제목을 입력하고 Enter → 목록이 “1화 · 각성”으로 바뀌고 경로·폴더는 그대로.
  3. ‘편집기 설정’에서 기본 편집기(VS Code / 메모장 / 내장 편집기는 04회)와 VS Code 위치를 바꿀 수 있다. 위치를 틀리게 넣으면 열기 실패 이유·찾아본 위치·‘메모장(으)로 열기’가 보이고 회차는 그대로 남는다. 칸을 비우면 자동으로 다시 찾는다.
  4. 만들기가 실패하면 “다시 누르면 같은 요청으로 이어서 시도하므로 회차가 두 개 생기지 않습니다.” 읽기 전용 작품에서는 만들기 버튼이 꺼진다.
- **구현 증거**
  - Rust `src-tauri/src/workspace/episodes.rs`: `list`, `create_next`(쓰기 잠금 안에서 최대 번호+1, `requestId` 재사용), `find`, `rename`. `workspace/atomic.rs`의 `publish_new_dir`(스테이징 폴더 → 이름 변경 한 번), 스테이징 정리. `WorkspaceSession::ensure_writable / writer_guard`.
  - Rust `src-tauri/src/editor.rs`: `EditorKind`(vscode/notepad/builtin), `find_vscode`(설정 경로 → `%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe` → Program Files → PATH의 `code.cmd`), `plan`(VS Code: `[작품 루트, 원고]`, 메모장: `[원고]`), `launch`(셸 없이 실행, 기다리지 않음, `requestSent`만 반환).
  - 명령 `src-tauri/src/lib.rs`: `list_episodes`, `create_episode`, `rename_episode`, `open_episode_external`, `detect_editors`, `set_editor_settings`. 모든 작품 명령은 `sessionId`를 확인한다(다르면 `staleSession`). 작품 세션은 `Arc`로 넘겨 긴 작업 중에도 슬롯 잠금을 오래 잡지 않는다.
  - 기기 설정 `settings.json`의 `editor: { kind, vscodePath? }`(`%APPDATA%\dev.donism.galpi\settings.json`).
  - 화면 `src/episodes/api.ts`, `EpisodesProvider.tsx`(만들기 의도 1개 = 요청 ID 1개, 늦은 응답 무시), `EpisodesPanel.tsx`(사이드바 회차 목록, 상세, 편집기 설정). 문구 `episodes.*`, `editor.*`, `errors.editor*`.
  - 개발 도구 `src-tauri/examples/make_sample_work.rs`: 실제 앱 코드로 합성 작품과 빈 회차 N개를 만든다.
- **실행 증거** (같은 PC, VS Code 1.147 사용자 설치, Windows 11 메모장)
  - `npm run check` 통과: vitest **30**(3회 반복), cargo test **43**, fmt, clippy `-D warnings`.
  - **S03.A** · `s03a_episodes_1_2_3_survive_reopen_in_order_with_absolute_paths`. 실제 앱: `%TEMP%\galpi-03-test\잿빛 항구 (테스트) #1 & 'x' 100%`(한글·공백·괄호·`#`·`&`·`'`·`%`)에 합성 작품 1~3화를 만들고 최근 작품에서 열었더니 사이드바 1화·2화·3화, 버튼 ‘다음 화 쓰기 (4화)’, 1화 절대 경로가 실제 파일과 같았다.
  - **S03.B** · `s03b_same_request_retry_makes_one_episode_even_after_reopen`(재열기 후에도 같은 회차), `s03b_concurrent_independent_requests_get_distinct_consecutive_numbers`(8개 스레드 → 1~8, 같은 요청 6개 동시 → 1개), `gaps_are_kept_and_next_follows_the_maximum`, 화면 테스트(실패 후 재시도 같은 요청 ID, 더블클릭 1개). 실제 앱: VS Code 경로를 틀린 상태에서 ‘다음 화 쓰기 (4화)’ → 4화 생성·열기 실패 표시 → ‘VS Code(으)로 다시 열기’ 두 번 → 디스크의 회차 폴더 4개 그대로, 버튼은 ‘(5화)’.
  - **S03.C** · 실제 앱에서 ‘VS Code(으)로 다시 열기’ → 새 VS Code 창 제목 `manuscript.md - 잿빛 항구 (테스트) #1 & 'x' 100% - Visual Studio Code`, 캡처에서 탐색기 루트가 작품 폴더이고 `episodes/000001-…/manuscript.md`가 선택됨(이번 VS Code는 업데이트 직후라 릴리스 노트 탭이 함께 열려 앞에 있었다). ‘메모장(으)로 열기’ → Windows 11 메모장이 **이미 열린 메모장 창의 새 탭**으로 `manuscript.md`를 열었다.
  - **S03.D** · 테스트 VS Code 창을 닫은 전후로 `episodes/` 아래 모든 파일 해시 동일. ‘편집기 설정’에 `C:\없는 경로\Code.exe` → ‘VS Code(으)로 열지 못했습니다… 찾아본 위치: C:\없는 경로\Code.exe’와 ‘메모장(으)로 열기’ 버튼, 회차 수 불변. 칸을 비우자 자동 탐지 `…\Microsoft VS Code\Code.exe`로 돌아오고 4화가 VS Code에 열렸다. 단위 테스트 `wrong_explicit_path_fails_and_lists_it`, `spawn_failure_is_reported_not_hidden`.
  - 정리: 테스트용 VS Code 창은 닫았고 최근 작품에서 테스트 항목을 지웠다. 메모장의 테스트 탭은 작가의 다른 탭이 있을 수 있어 닫지 않았다. 테스트 폴더 `%TEMP%\galpi-03-test`는 남아 있다.
- **형식/결정 변경**
  - 회차 폴더 규격 확정(`WORKSPACE_FORMAT.md` ‘회차 폴더 (03회)’). 02회 작품은 `episodes/`가 비어 있으므로 그대로 열린다.
  - 기기 설정에 `editor` 추가(없으면 VS Code). VS Code는 `code.cmd`를 거치지 않고 `Code.exe`를 인자 목록으로 직접 실행한다(`cmd.exe` 해석으로 `%`·`&`가 깨지는 것을 피함).
  - VS Code 탐지에서 VS Code Insiders, Cursor 등은 아직 찾지 않는다(경로를 직접 넣으면 쓸 수 있음).
- **다음 인계**
  - 04회: 내장 편집기는 `EditorKind::Builtin`(현재 `editorNotReady`)를 연결하면 같은 버튼·설정을 그대로 쓴다. 원고 저장은 `WorkspaceSession::write_file(requestId, episode.manuscriptRel, bytes, Expect::Hash(읽을 때 해시))`.
  - 04회 CH1 몫(잠금 시 ‘다시 읽기’, UTF-8 판독 실패 시 자동저장 중지)과 05회 디스크 변경 판단은 아직 없다. 지금은 외부 편집기를 연 뒤 앱이 원고 내용을 읽지 않는다.
  - Windows 11 메모장은 새 창이 아니라 기존 창의 탭으로 연다. 05회 외부 변경 시험에서 이 동작을 고려한다.

### 03회 추가 · 디버그 탭 (2026-11-24)

- **무엇** · 디버그 빌드에서만 보이는 왼쪽 ‘세계관’ 아래의 ‘디버그’ 탭. 빌드 정보(디버그/릴리스, 버전, OS, 기기 설정 파일 경로), 현재 상태(열린 작품 JSON, 회차 수, 마지막 편집기 요청, 기기 설정 JSON), 도구(합성 작품 만들기 → 바로 열기), **01~03회 구현 목록·자동 테스트 명령·직접 확인 절차 22개**(체크 상태는 localStorage `galpi.debug.checks`).
- **구현 증거** · `src/debug/features.ts`(회차별 내용 데이터), `src/debug/DebugPanel.tsx`, `src/debug/api.ts`, `src/App.tsx`(탭 표시 조건 `buildInfo.debug`). Rust `build_info`, `debug_make_sample_work`(릴리스 빌드에서는 거절), `src-tauri/src/workspace/sample.rs`(예제 CLI와 공용).
- **실행 증거** · `npm run check` 통과: vitest **35**(`src/debug/debug.test.tsx`: 릴리스에서 숨김, 01~03 표시·최신 회차 펼침, 체크 저장·초기화, 합성 작품 만들기·열기, 데이터 무결성), cargo test **44**(`workspace::sample`), fmt·clippy. 실제 데스크톱: 디버그 탭 표시, 빌드 정보·기기 설정 JSON 표시, 합성 작품 만들기로 `%TEMP%\galpi-dbg-test\샘플 작품 (디버그)`에 1~3화 생성 확인 후 폴더 삭제.
- **규칙 변경** · `SNAPSHOTS.md` 4번: 회차를 닫을 때 디버그 탭 내용도 갱신. 01·02 스냅샷은 동결이라 바꾸지 않았고, 그 회차들의 내용은 03의 디버그 탭에 들어 있다.
- **스냅샷별 실행 파일 (2026-11-24)** · `tools/build-exe.mjs NN [debug|release]` 추가. 공유 컴파일 캐시(`target/`)는 그대로 두고 결과 exe만 `snapshots/NN/exe/galpi-NN-debug.exe`(또는 `galpi-NN.exe`)로 복사한다(스냅샷마다 target을 두면 1개당 수 GB). 01·02·03 디버그 exe를 만들었고(12.1/13.2/13.5 MB), `galpi-03-debug.exe`를 개발 서버 없이 실행해 네 루트·디버그 탭·03회 항목이 보이는 것을 확인했다. 동결 스냅샷은 소스 변경 없이 `exe/`(git 제외)만 생겼다.
- **.gitignore 정리** · Rust 템플릿의 맨 `debug` 규칙이 `snapshots/03/src/debug/`(디버그 탭 소스)까지 숨기고 있어 `/debug/`로 고쳤다. exe·설치 파일, `.env*`, 작품 폴더용 `.galpi/`, 테스트 폴더 `galpi-*-test/`, OS·편집기 파일을 추가했다.

---

## 04회 · 내장 집필과 한글 입력 (2026-11-24)

> 앱 소스 위치: `snapshots/04/` (03을 디버그 탭 포함 상태로 복사해 시작). 아래 경로·명령은 그 폴더 기준이다.

- **상태** · 완료. 확정 편집기는 **CodeMirror 6**(`@codemirror/state·view·commands·lang-markdown`). 단순 텍스트 편집기로 원인을 좁혀야 할 IME 문제는 나오지 않았다. 실제 **키보드** 한글 IME 입력은 작가 확인이 남았다(아래).
- **작가가 확인할 동작** · 디버그 탭 ‘04회’ 체크리스트 8개(04.ime, 04.save, 04.close, 04.permission, 04.form, 04.cp949, 04.lock, 04.conflict)에 단계와 기대 결과가 있다. 요약:
  1. 회차를 누르면 아래 편집기에 원고가 열린다. 입력하면 ‘편집 중’, 1.2초 멈추면 ‘저장 중…’→‘저장됨 HH:MM:SS’, Ctrl+S는 즉시 저장.
  2. 한글을 조합하는 동안에는 저장하지 않고 조합이 끝나면 저장한다.
  3. 상태줄의 ‘UTF-8 (BOM) · CRLF’처럼 원래 형식을 유지한다.
  4. 저장 실패 → ‘저장하지 못했습니다… 복구 초안으로 따로 보관’ + ‘다시 저장’. CP949 원고 → 안내·‘원본 위치 열기’·‘다시 읽기’, 자동저장 없음. 잠긴 원고 → ‘사용 중’ + ‘다시 읽기’.
  5. 회차 바꾸기·작품 닫기·창 닫기 전에 먼저 저장한다.
- **구현 증거**
  - Rust `src-tauri/src/workspace/manuscript.rs`: `decode/encode`(BOM·줄바꿈 보존), `read`(`ok / undecodable / locked`), `save`(기대 해시), `save_draft / load_draft / discard_draft`, `file_path`. 명령 `read_manuscript`, `save_manuscript`(성공 시 초안 삭제), `save_draft`, `load_draft`, `discard_draft`, `reveal_episode_file`(탐색기 `/select,`). 창 닫기 권한 `core:window:allow-destroy`.
  - 화면 `src/manuscript/ManuscriptEditor.tsx`(편집기·저장 상태·세대·IME 대기·실패/보류/판독 실패/잠금/초안), `EditorGuard.tsx`(저장 후 전환: 회차 선택, 다음 화, 작품 닫기·열기), `WindowCloseGuard.tsx`(창 닫기 전 저장), `api.ts`. `src/episodes/*`에서 내장 편집기 연결, 문구 `manuscript.*`.
  - 디버그 탭 `src/debug/features.ts`에 04회 항목 추가, 03.builtin 기대 결과 갱신.
- **실행 증거** (같은 PC, WebView2 157, `snapshots/04/exe/galpi-04-debug.exe`)
  - `npm run check` 통과: vitest **46**(8회 연속), cargo test **51**, fmt·clippy.
  - 실제 앱 · WebView2 원격 디버깅(`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port`)으로 **Chromium IME 조합 이벤트**(`Input.imeSetComposition` 자모 단위 → `Input.insertText` 확정)를 앱 창에만 보냈다. 내 키보드·마우스는 쓰지 않았다.
    - **S04.A** 천천히(60ms 간격) ‘서린은 불씨를 감지했다.’, ‘불’ 조합 중 1.6초 멈춤 + Ctrl+S → 그동안 상태 ‘편집 중’, 디스크 빈 파일 그대로 → 조합 끝난 뒤 디스크 `서린은 불씨를 감지했다.` 정확히 일치. Enter 후 지연 없이 같은 문장 → `…다.\n서린은 불씨를 감지했다.` 일치. Enter 직후 0/30/80ms에 조합을 시작해도 줄·글자 중복 없음.
    - **S04.C** BOM+CRLF+이모지 원고를 열기만 → SHA-256 동일. 한 줄 추가 → 원본 바이트 + `서린은 불씨를 감지했다.\r\n` 과 정확히 같음(BOM 유지). 상태줄 ‘UTF-8 (BOM) · CRLF’.
    - **S04.D** CP949 원고 → ‘UTF-8로 읽을 수 없습니다’, 편집기 없음, 2초 뒤에도 바이트 동일. 다른 프로세스가 공유 없이 연 원고 → ‘사용 중’ 안내 → 닫은 뒤 ‘다시 읽기’로 정상.
    - **S04.B** 원고를 읽기 전용 속성으로 만든 뒤 입력 → ‘저장하지 못했습니다’, `.galpi/drafts/<회차ID>.json` 생성, 디스크 그대로 → 속성 해제 후 ‘다시 저장’ → 저장, 초안 삭제. 입력 직후 창 닫기(WM_CLOSE) → 50ms 안에 종료, 마지막 글자까지 디스크에 있음.
    - 시험 중 알게 된 것: CDP `Input.insertText("\n")`나 rawKeyDown+char로 보낸 Enter는 줄바꿈이 둘 들어간다(시뮬레이션의 특성). 단일 keyDown Enter로는 한 줄. 실제 키보드 확인 항목에 Enter를 포함했다.
  - **미검증** · 실제 키보드 한글 IME(Microsoft 한국어 IME)로 S04.A의 포커스 이동·한/영 전환 조합. 필요한 것: 작가가 디버그 탭 04.ime 절차를 직접 수행.
  - 정리: 테스트 작품 `%TEMP%\galpi-04-test` 삭제, 최근 작품에서 테스트 항목 삭제.
- **형식/결정 변경**
  - `WORKSPACE_FORMAT.md` ‘원고 저장과 복구 초안 (04회)’: 형식 보존 규칙, `.galpi/drafts/`. 작품 schemaVersion은 1 그대로(초안은 앱 내부 파일).
  - 기본 편집기는 여전히 VS Code. 내장 편집기는 회차 상세에서 항상 보이고, 기본을 ‘내장’으로 두면 ‘다음 화 쓰기’가 외부 프로그램 없이 내장 편집기로 간다.
  - 스냅샷 복사 명령에서 `dist`도 제외(`SNAPSHOTS.md`).
- **다음 인계**
  - 05회: 충돌은 지금 `writeConflict` → ‘저장 보류’ + 초안 보관까지만 한다. ManuscriptEditor의 `meta.hash`(읽은 기준본 해시), 초안(`Draft.baseHash`, `text`), 디스크 재읽기(`read_manuscript`)로 ‘읽은 기준본 / 내 초안 / 디스크’ 세 가지를 만들 수 있다. 외부 변경 감지(파일 감시)는 아직 없다. 앱이 원고를 연 채 외부에서 바꾸면 다음 저장 때에야 안다.
  - 창 닫기는 저장 실패 시 한 번 멈춘다. 05회 충돌 창에서 강제 종료되는 경우(S05.B)는 초안 파일로 복구 경로를 잇는다.

### 04회 추가 · 디버그 탭 누락 수정과 회차별 도구 (2026-11-24)

- **문제** · 처음 만든 `galpi-04-debug.exe`는 디버그 탭에 04회 항목을 넣기 **전에** 빌드되어 01~03만 보였다.
- **고친 것**
  - exe를 다시 만들었다(`snapshots/04/exe/galpi-04-debug.exe`, 13.9 MB). 디버그 탭 ‘빌드 정보’에 **스냅샷 04** 표시(`vite.config.ts`의 `__SNAPSHOT__` = 폴더 이름).
  - 재발 방지: `src/debug/debug.test.tsx`가 features.ts에 01…현재 스냅샷 회차가 빠짐없이 있는지 검사(`npm run check` 실패). `tools/build-exe.mjs`는 features.ts에 그 회차 항목이 없으면 빌드를 거부한다.
  - **04회 도구**(`src/debug/sessionTools.tsx`, Rust `src-tauri/src/debug_tools.rs`): 선택한 회차 원고를 BOM+CRLF+이모지 / CP949 / 빈 문서 / 장문 / 줄바꿈 섞임으로 덮어쓰기, 다른 프로그램처럼 잠그기·풀기, 읽기 전용 속성 켜기·끄기, 파일 정보(크기·해시·BOM·CRLF 수·UTF-8 여부·앞 24바이트). 디버그 빌드 + 합성 작품(`workspace.json`의 `"galpiSample": true`, 합성 작품 만들기가 붙임)에서만 동작하고 진짜 작품은 Rust에서 거절한다.
  - 04회 체크리스트(04.form, 04.cp949, 04.lock, 04.permission)에 도구로 하는 빠른 방법을 적었다.
- **실행 증거** · `npm run check` 통과: vitest **50**, cargo test **53**(`debug_tools`: 합성 작품에서만 동작·진짜 작품 무변경, `sample`: galpiSample 표시), fmt·clippy. 다시 만든 exe를 실행해 CDP로 확인: 디버그 탭 ‘snapshots/04 (04회 결과물)’, ‘04회 · 내장 집필과 한글 입력’, ‘04회 도구’ 표시 → 합성 작품 만들기 → 열기 → 1화 선택 → CP949 덮어쓰기 → 파일이 CP949 23바이트, 편집기에 ‘UTF-8로 읽을 수 없습니다’, workspace.json `galpiSample: true`. 테스트 폴더·최근 항목 삭제.
- **규칙 문서** · `SNAPSHOTS.md` 4번을 회차 종료 순서(디버그 내용 → 회차별 도구 → check → **마지막에 exe** → 기록·커밋)로 다시 썼고, `docs/development/README.md`와 05~18회 카드의 ‘회차를 닫을 때’에 같은 지시를 넣었다(14개 카드).

### 저장소 전체 · 텍스트 인코딩 통일 (2026-11-24)

- 01~04 스냅샷과 문서·설정 등 텍스트 파일 228개를 검사했다. 모두 이미 UTF-8이었고 BOM·UTF-16·다른 인코딩은 0개. Git `core.autocrlf=true` 때문에 작업 폴더에서 CRLF였던 17개를 LF로 바꿨다(저장소에 들어 있는 내용은 원래 LF라 01~03 동결 스냅샷의 커밋 내용은 바뀌지 않음).
- 앞으로도 유지되도록 `.gitattributes`(`* text=auto eol=lf`, 이미지·exe는 binary), `.editorconfig`(utf-8, lf), `.vscode/settings.json`(utf8, `\n`, 인코딩 추측 끔)을 추가했다. `SNAPSHOTS.md` 8·9번에 텍스트 형식 규칙과 “바뀐 스냅샷은 요청 없이도 exe 재빌드” 규칙을 적었다.
- 01~04 각각 `npm run check` 통과(웹 13/22/35/50, Rust 5/29/44/53). exe 4개를 다시 만들고 실행해 확인: 01 네 루트, 02 작품 폴더 선택, 03·04 디버그 탭에 해당 회차 항목과 스냅샷 번호.

---

## 05회 · 외부 변경·충돌·초안 복구 (2026-11-24)

> 앱 소스 위치: `snapshots/05/` (04를 디버그 탭 수정·인코딩 정리 상태로 복사해 시작). 실행 파일: `snapshots/05/exe/galpi-05-debug.exe`.

- **상태** · 완료. 구현·자동 검증·실제 앱(05 debug exe) 검증 통과. 디버그 탭 05회 항목·05회 도구 포함해 exe를 만들었다.
- **작가가 확인할 동작** · exe 디버그 탭 → ‘05회 · 외부 변경·충돌·초안 복구’ 체크리스트 8개(05.outside, 05.both, 05.again, 05.crash, 05.delete, 05.touch, 05.late, 05.cp949). ‘05회 도구’로 외부 편집기 동작(줄 덧붙여 저장, 임시 파일 교체 저장, 수정 시각만 바꾸기, CP949로 저장, 삭제)을 합성 작품에 바로 흉내 낼 수 있다.
- **구현 증거**
  - Rust `src-tauri/src/workspace/watch.rs`: notify 9 감시 → 0.2초 디바운스 → manuscript.md 해시 → `manuscript-changed` 이벤트(`DiskChange`), 자기 쓰기 제외(`WorkspaceSession::was_own_write`, `recent_writes`). `lib.rs`: 작품 열기/닫기/바꾸기와 함께 감시 시작·중지, `probe_manuscript`. `manuscript.rs`: `Missing` 상태, `save(base_hash: Option)` + 저장 후 재확인, `probe`, 초안 `base_text`. `debug_tools.rs`: `external_edit`(합성 작품 전용).
  - 화면 `src/manuscript/ManuscriptEditor.tsx`: 디스크 신호 처리(같은 해시 무시 / 깨끗하면 줄 단위 반영·커서 유지 / 쓰는 중이면 충돌), 충돌 창(기준·디스크·내 초안, 내 초안 저장·디스크 쓰기·직접 합치기·디스크 다시 확인), 재시작 복원, 삭제·다시 만들기, 자기 저장 중 들어온 신호 보류. `merge3.ts`(줄 단위 3방향 합치기, 줄 단위 변경 적용용 `hunks`). `api.ts`(`onDiskChange`, `probe`). 문구 `conflict.*`, `manuscript.missing*`.
  - 디버그 탭: `src/debug/features.ts` 05 항목(04.conflict 기대 결과 갱신), `sessionTools.tsx` 05회 도구.
- **실행 증거** (같은 PC, `galpi-05-debug.exe`, CDP로 앱 창만 조작, 파일 변경은 node로 직접 써서 외부 편집기 역할)
  - `npm run check` 통과: vitest **82**(3회 반복), cargo test **61**(watch 4, manuscript tests05 3, debug_tools tests05 1 포함), fmt·clippy.
  - 실제 앱 1단계 17/17: 합성 작품 A·B → A 1화 커서를 ‘둘째 줄’에 두고 외부에서 맨 위·맨 아래 줄 추가 → 편집기 반영·안내·커서 ‘둘째 줄’ 유지·앱 저장 없음 / 임시 파일+rename 저장 반영 / 수정 시각만 변경 + 창 포커스 → 충돌 없음 / 앱 입력 → 저장됨, 자기 저장으로 충돌 없음 / 입력 직후 외부 수정 → 충돌 창, 디스크 쪽 = 외부 내용, 2초 뒤에도 파일 그대로, 복구 사본에 text·baseText.
  - **S05.B** 충돌 창 상태에서 `Stop-Process -Force` → 파일 해시 그대로(0A45E70575E9) → exe 재실행 → 2단계 10/10: ‘지난번에 고르지 못한 충돌을 복구했습니다’, 디스크 불변, 편집기에 내 초안 → 직접 합치기(외부는 첫 줄, 앱은 끝 줄 → 표시 없이 합쳐짐) → 저장, 디스크 = 합친 내용, 복구 사본 삭제 → 외부 삭제 → ‘원고 파일이 없습니다’ → 다시 만들기 → **S05.C** A 원고를 외부에서 바꾸고 즉시 작품 닫기 → B 열기 → B 파일·편집기 그대로.
  - 시험 과정의 실패는 모두 내 시험 스크립트 문제였다(패널이 뜨기 전에 입력, 최근 작품에 없는 작품을 열려 함). 앱 코드 문제로 고친 것: 커서 유지 시험에서 위·아래 동시 변경이 큰 치환 하나가 되어 커서가 0으로 가던 것 → 줄 단위 변경(`diskChanges`)으로 수정. 합치기에서 서로 다른 인접 줄 수정이 충돌로 잡히던 것 → 실제 겹침만 충돌로 수정.
  - **동시 쓰기의 관측 범위**: 외부 프로그램은 잠금을 따르지 않는다. 앱은 (1) 저장 직전 디스크 해시가 기대와 다르면 쓰지 않고, (2) 저장 직후 다시 읽어 다르면 충돌로 알린다. 저장 직전 확인과 교체 사이의 아주 짧은 순간에 다른 프로그램이 쓴 내용은 앱의 교체로 덮일 수 있고, 그 경우에도 (2)에서 다른 내용이 보이면 알린다. 같은 순간 같은 바이트를 쓰면 구별할 수 없다(결과가 같으므로 손실 없음).
  - 외부 편집기별: VS Code식 임시 파일 교체 저장과 메모장식 제자리 저장을 node로 재현해 둘 다 1회 변경으로 처리됨을 확인. 실제 VS Code·메모장 앱으로의 수동 확인은 디버그 탭 05.outside/05.both로 남김(미검증).
  - 정리: 테스트 작품·최근 항목 삭제.
- **형식/결정 변경** · WORKSPACE_FORMAT ‘외부 변경과 충돌 (05회)’. 초안에 `baseText` 추가(04 초안 호환). 작품 schemaVersion 1 그대로. 새 의존성: Rust `notify` 9.
- **다음 인계**
  - 06회: 커밋은 `manuscript::save`와 같은 기대 해시 규칙을 쓴다. 충돌·복구 사본이 있는 회차는 커밋 전에 해결하도록 막는다(`Draft` 존재 확인). 외부 변경 직후 커밋하면 디스크를 다시 읽는다(WORKSPACE_FORMAT 쓰기와 복구 1).
  - 감시는 `episodes/`만 본다. 07회 이후 요약·설정 파일도 외부 편집을 받으려면 같은 `watch` 구조에 경로를 더한다.
