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
| 06 | 회차 커밋·판 비교·복원 | 완료 | S06.A·B·C·D 실제 앱(debug exe, 실제 강제 종료 포함) 통과. 아래 06회 기록 |
| 07 | 회차 요약·다음 화 메모·퇴고 재확인 | 완료 | S07.A·B·C·D 실제 앱(debug exe, 재실행 포함) 통과. 아래 07회 기록 |
| 08 | 세계관 카드·범용 템플릿·사용자 태그 | 완료 | S08.A·B·C 실제 앱(debug exe, 재실행 포함) 통과. 아래 08회 기록 |
| 09 | 사건 입력과 회차·작중 시간·함께 보기 | 완료 | S09.A·B·C·D·E 실제 앱(debug exe, 재실행 포함) 통과. CH1 최종 검증 포함. 아래 09회 기록 |
| 10 | 회귀 구간 링크와 그 시점의 능력 | 완료 | S10.A·B·C·D 실제 앱(debug exe, 재실행 포함) 통과. CH2 최종 검증 포함. 아래 10회 기록 |
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

---

## 06회 · 회차 커밋·판 비교·복원 (2026-11-24)

> 앱 소스: `snapshots/06/` (05에서 복사). 실행 파일: `snapshots/06/exe/galpi-06-debug.exe` (06 디버그 탭·도구 포함, check 통과 후 마지막에 빌드).

- **상태** · 완료. 구현·자동 검증·실제 앱(실제 강제 종료 2종 포함) 검증 통과.
- **작가가 확인할 동작** · exe 디버그 탭 ‘06회 · 회차 커밋·판 비교·복원’ 체크리스트 8개(06.three, 06.nochange, 06.external, 06.crash, 06.restore, 06.separate, 06.damaged, 06.conflict). ‘06회 도구’: 판 3개 빨리 만들기 / 게시 직전 중단 흔적 / 최신 판 손상(합성 작품 전용).
- **커밋 스키마·변경량 단위** · WORKSPACE_FORMAT ‘회차 커밋 (06회)’. 변경량: ‘바뀐 줄’ = 추가+삭제+수정 줄, 글자 = 사용자 인식 문자(Intl.Segmenter grapheme; 조합 한글·이모지 1자), 줄바꿈 제외, 비교는 BOM·CRLF/LF 무시한 LF 본문. 바뀐 줄 안은 Intl.Segmenter word 단위(단어·공백·문장부호) 강조. 앱 화면 ‘커밋과 비교 규칙’ 도움말에 같은 내용.
- **구현 증거**
  - Rust `src-tauri/src/workspace/history.rs`: `commit`/`commit_with`(실패 지점 BeforePublish·AfterPublish, 디버그 빌드 `GALPI_FAILPOINT=commit-before-publish|commit-after-publish`), `list`(해시 검증·문제 보고), `read`, `latest`, `backup_working_copy`. 명령 `list_revisions`, `read_revision`, `commit_episode`, `backup_working_copy`. `debug_tools.rs` `history_fixture`.
  - 화면 `src/history/`: `diff.ts`(줄·단어 단위 비교, 문자 수), `HistoryPanel.tsx`(커밋 메모·커밋, 결과 안내, 이력 목록과 변경량, 이전 판/아무 두 판·작업본 비교, 2단계 복원), `api.ts`. 편집기 연결 `EditorGuard`의 `prepareCommit`(저장 → 디스크 대조 → 깨끗하면 다시 읽기/편집 중이면 충돌), `replaceText`, `currentText`. 문구 `history.*`.
  - 디버그 탭: `features.ts` 06 항목, `sessionTools.tsx` 06회 도구.
- **실행 증거** (같은 PC, `galpi-06-debug.exe`, CDP로 앱 창만 조작, 외부 저장은 node로 파일 직접 씀)
  - `npm run check` 통과: vitest **100**(3회 반복), cargo test **68**(history 6, debug_tools tests06 1 포함), fmt·clippy.
  - 실제 앱 18/18: r1·r2(저장 안 한 글 → 커밋 전 자동 저장)·r3, 디스크에 r001~r003 / 내용 같음 → ‘직전 판(r3)과 내용이 같아…’ 그대로 3개 / 커밋 버튼 3연타 → 정확히 1개(r4) / VS Code식 외부 저장 직후 커밋 → r5 바이트 = 디스크 / r1↔r3 비교 강조 / 커밋 안 한 문장을 쓴 뒤 r2 복원 → 사본(.galpi/backups)에 그 문장, 작업본 = r2, 커밋 → r6, r2·r3 해시 그대로 / 2화 커밋 → 1화 6개·2화 1개.
  - **S06.B 실제 강제 종료**: `GALPI_FAILPOINT=commit-before-publish`로 실행 → 커밋 → 프로세스 abort, 디스크 이력 r001~r006 그대로·tmp에 스테이징 1개 → 일반 실행 → 이력 6개·문제 없음·스테이징 정리됨. `commit-after-publish` → abort 후 이력 r007까지 → 재실행 시 7개 모두 완전(r7 비교·복원 버튼 정상).
  - 시험 중 고친 것: 내 테스트의 기대값 두 개(띄어쓰기는 양쪽이 같아 글자 수에 안 들어감, ‘새로 쓴 줄’은 6자)와 테스트 간 공유 데이터 수정. 앱 코드 결함은 나오지 않았다.
  - 정리: 테스트 작품·최근 항목 삭제.
- **형식/결정 변경** · WORKSPACE_FORMAT ‘회차 커밋 (06회)’. `.galpi/backups/` 추가(앱 내부, 백업 ZIP에서 제외 대상은 18회에 결정). 작품 schemaVersion 1 그대로.
  - CH1: 충돌 해결 후 저장은 커밋을 만들지 않는다. ‘충돌 해결 후 커밋’ 한 번에 하는 동작은 두지 않았다(S06.D의 두 번째 조건은 해당 없음).
- **다음 인계 (07회)**
  - 요약의 `reviewedRevisionId`는 `history::latest`로 얻은 판 ID. ‘재확인’은 최신 판 ID가 `reviewedRevisionId`와 다를 때(새 커밋이 생겼을 때)만 — 작업본 저장·충돌 해결 저장은 판을 만들지 않으므로 상태를 바꾸지 않는다.
  - 커밋 직후 화면 갱신: `HistoryPanel`의 `load()`. 07회 요약 패널은 같은 회차의 판 목록 변경을 듣기 위해 커밋 결과를 공유 상태로 올리는 것이 좋다.

---

## 07회 · 회차 요약·다음 화 메모·퇴고 재확인 (2026-11-25)

> 앱 소스: `snapshots/07/` (06에서 복사). 실행 파일: `snapshots/07/exe/galpi-07-debug.exe` (07 디버그 탭·도구 포함, 마지막 코드 수정 뒤 다시 빌드).

- **상태** · 완료. 구현·자동 검증·실제 앱(재실행 포함) 검증 통과.
- **작가가 확인할 동작** · exe 디버그 탭 ‘07회 · 회차 요약·다음 화 메모·퇴고 재확인’ 체크리스트 5개(07.list, 07.review, 07.external, 07.summaryOutside, 07.note). ‘07회 도구’: 요약·다음 화 메모 쓰기 / 요약 파일 외부 수정(합성 작품 전용).
- **실제 경로·재확인 규칙** · WORKSPACE_FORMAT ‘회차 요약·다음 화 메모 (07회)’.
- **구현 증거**
  - Rust `src-tauri/src/workspace/summaries.rs`: `list`(전 회차, 첫 줄·상태), `read`(요약·메모·검토 기록·상태), `save_text`(요약/메모, 기대 해시), `confirm`(최신 커밋 ID일 때만). 06의 `history::list/latest`를 그대로 사용. 명령 `list_summaries`, `read_summary`, `save_summary_text`, `confirm_summary`. `debug_tools.rs` `summary_fixture`.
  - 화면 `src/summaries/`: `SummariesPanel.tsx`(목록·상태 배지·개수, 상세: 요약/메모 편집·저장, 상태 설명, ‘이대로 확인’·‘수정 후 확인’, 재확인 시 06 `DiffView`로 확인했던 판 ↔ 현재 판 비교, 창 포커스 시 다시 읽기), `PrevNote.tsx`(이전 화 메모, 방금 만든 회차에서 펼침), `api.ts`. `EpisodesProvider`에 `lastCreatedId`, `App.tsx`에 ‘회차 요약’ 루트 연결. 문구 `summary.*`.
  - 디버그 탭: `features.ts` 07 항목, `sessionTools.tsx` 07회 도구.
- **실행 증거** (같은 PC, `galpi-07-debug.exe`, CDP로 앱 창만 조작, 외부 저장은 node로 파일 직접 씀)
  - `npm run check` 통과: vitest **108**(3회 반복), cargo test **74**(summaries 5, debug_tools tests07 1 포함), fmt·clippy.
  - 실제 앱 1단계 7/7: 합성 작품 3화 → ‘회차 요약’ 세 줄 모두 ‘(요약 없음)’ → 1·3화 요약 저장 → **S07.A** 2화는 ‘(요약 없음)’으로 목록에 있음, 3화 첫 줄·‘커밋 전’, 파일 내용 일치.
  - 앱 종료·재실행 후 2단계 16/16: 요약 원문·상태 유지 → 3화 r1 커밋 → ‘미확인’ → ‘이대로 확인 (r1)’ → ‘최신 확인 (r1)’, summary.json에 reviewedRevisionId → 원고만 저장: 그대로 + ‘커밋하지 않은 수정’ 안내 → **S07.D** 외부 저장: 그대로 → r2 커밋 → ‘재확인 필요 (r1 확인 → 지금 r2)’ → 비교 표시 → ‘이대로 확인 (r2)’ → ‘최신 확인 (r2)’, 1·2화 상태 불변(**S07.B**) → 3화 다음 화 메모 저장 → ‘다음 화 쓰기 (4화)’ → **S07.C** 메모 펼쳐져 한 번만 보임, 4화 원고 빈 파일·4화 요약 파일 없음 → 다른 회차 갔다 오면 접혀 있음.
  - **시험에서 찾아 고친 결함**: 처음 빌드에서는 4화로 돌아와도 메모가 ‘방금 만든 회차’로 계속 펼쳐져 있었다(16개 중 1개 실패). 다른 회차를 고르면 ‘방금 만듦’ 표시를 지우도록 `EpisodesProvider.select`를 고치고, 테스트(summaries.test S07.C)에 ‘돌아오면 접혀 있음’을 추가한 뒤 exe를 다시 빌드해 전 과정을 처음부터 다시 돌려 23/23 통과.
  - 정리: 테스트 작품·최근 항목 삭제.
- **형식/결정 변경** · WORKSPACE_FORMAT ‘회차 요약·다음 화 메모 (07회)’. summary.json schemaVersion 1. 작품 schemaVersion 1 그대로.
- **재사용할 검토 인터페이스 (09회 사건 등)** · ‘확인한 커밋 ID를 기록하고, 상태는 최신 커밋과 비교해 계산’하는 방식: Rust `history::latest` + 자료별 `reviewedRevisionId` 필드 + `confirm`처럼 ‘확인 시점의 최신 커밋 ID를 기대값으로 받아 다르면 거절’. 요약 확인과 사건 확인은 각자의 기록 파일을 가지므로 서로의 상태를 바꾸지 않는다(CH1).
- **다음 인계** · 요약·메모 파일의 외부 변경은 창 포커스 때 다시 읽는다(05 감시는 episodes/만). 08회 세계관 카드도 같은 `write_file` 기대 해시 패턴을 쓴다.

---

## 08회 · 세계관 카드·범용 템플릿·사용자 태그 (2026-11-25)

> 앱 소스: `snapshots/08/` (07에서 복사). 실행 파일: `snapshots/08/exe/galpi-08-debug.exe` (08 디버그 탭·도구 포함, 마지막 코드 수정 뒤 다시 빌드).

- **상태** · 완료. 구현·자동 검증·실제 앱(재실행 포함) 검증 통과.
- **작가가 확인할 동작** · exe 디버그 탭 ‘08회 · 세계관 카드·범용 템플릿·사용자 태그’ 체크리스트 6개(08.templates, 08.sameName, 08.tags, 08.tagOps, 08.language, 08.outside). ‘08회 도구’: 같은 이름 카드 2개 + 태그 A / ‘서린’ 카드 파일 외부 수정(합성 작품 전용).
- **템플릿 목록** · 인물(욕구·약점·관계), 성격(평소 행동·압박 반응), 장소(특징·연결 장소), 세력(목표·관계), 세계 규칙(조건·예외), 자유 메모. 질문은 `## 질문 — 설명` 제목으로 들어가고 비워 둬도 된다. 문구는 `world.templates.<id>.body`(ko/en).
- **카드·태그 ID와 이동 규칙** · WORKSPACE_FORMAT ‘세계관 카드·사용자 태그 (08회)’.
- **구현 증거**
  - Rust `src-tauri/src/workspace/lore.rs`: `list`(lore/ 전체, 폴더별 개수, 읽지 못한 카드 보고), `find`(카드 ID 조회), `read`, `create`(폴더째 게시·요청 ID 재사용), `save_body`, `update_meta`(이름·별칭·태그, 폴더 기록 복구), `move_card`, `create_folder`, `list_tags`(사용 카드 수), `create_tag`, `rename_tag`, `delete_tag_everywhere`. 명령 `list_cards`, `read_card`, `create_card`, `save_card_body`, `update_card_meta`, `move_card`, `create_card_folder`, `list_tags`, `create_tag`, `rename_tag`, `delete_tag_everywhere`. `debug_tools.rs` `lore_fixture`(+ 명령 `debug_lore_fixture`).
  - 화면 `src/world/`: `WorldPanel.tsx`(새 카드: 템플릿·이름·넣을 폴더 / 이름·별칭 검색, 폴더 필터, 하위 폴더 만들기 / 목록: 경로·동명 강조·‘인물 카드’ 등 종류·태그 칩 / 카드 화면: 이름 바꾸기·별칭·폴더 이동·태그 체크·본문 저장, 창 포커스 시 다시 읽기 / 태그 관리: 만들기·이름 바꾸기·보기에서 숨기기·전역 정리(영향 개수 먼저)), `api.ts`(백엔드 + 숨김 태그 저장소). `App.tsx` ‘세계관’ 루트 연결, `main.tsx` 제공자. 문구 `world.*`.
  - 디버그 탭: `features.ts` 08 항목(실행 안내 RUN 문구를 ‘이 회차 snapshots\NN의 exe’로 고침), `sessionTools.tsx` 08회 도구.
- **실행 증거** (같은 PC, `galpi-08-debug.exe`, CDP로 앱 창만 조작, 외부 수정은 node로 파일 직접 씀)
  - `npm run check` 통과: vitest **117**(world 8, debug 08 도구 1 포함), cargo test **82**(lore 6, debug_tools tests08 2 포함), fmt·clippy.
  - 실제 앱 1단계 14/14: 합성 작품 → ‘세계관’ 빈 목록 → 인물 템플릿 카드(lore/characters/<id>/card.md에 질문) → 장소·세력·규칙이 각 기본 폴더로 → 인물/주연·인물/조연 하위 폴더 → 두 ‘서린’ → **S08.A** 목록에 경로로 구분 → 주연 서린에 태그·본문 → ‘한서린’으로 이름 변경 → ‘인물’로 이동: 디스크에서 같은 ID 폴더가 옮겨지고 이름·folder 갱신, 태그·본문 그대로, 조연 서린 무영향 → 조연 서린에 별칭 ‘린’, 태그 A.
  - 앱 종료·재실행 후 2단계 19/19: **S08.B** 검색 ‘린’에 ‘서린(린) 인물/조연’, card.json aliases ["린"] → A 숨김: 그 카드만 목록에서 가려지고 안내, 태그의 ‘카드 1개’·디스크 그대로 → 복원: 같은 카드 다시 보임 → 태그 이름 A→‘주요 인물’(ID·카드 태그 유지) → ‘주인공’ 전역 정리: 영향 ‘카드 1개’ 먼저 표시, 취소 시 변화 없음 → 08회 도구로 외부 수정: 다시 열면 보임 → 앱 수정 중 밖에서 또 고침 → 저장 거절·쓴 글 유지·‘파일 다시 읽기’로 디스크 내용 → **S08.C** English로 바꿔도 한국어 질문·답 본문과 파일 그대로 → 한국어 복귀 → 전역 정리 실행: 태그 삭제, 카드 6개 유지, 태그 0 → `.galpi/tmp` 비어 있음.
  - **시험에서 고친 것**: 처음 2단계에서 별칭 검색 확인 1개가 실패했는데, 검색 ‘린’이 이름 ‘서린’·‘한서린’에도 부분 일치하는 것을 시험 스크립트가 2개로만 예상한 탓(앱은 별칭이 붙은 카드를 정상 표시). 기대값을 ‘별칭 (린)이 붙은 조연 서린이 나옴 + card.json aliases’로 고쳤다. 같은 실행에서 목록 줄이 ‘서린 인물 인물’(폴더와 종류가 같은 말)로 읽혀 종류를 ‘인물 카드’로 표기하도록 바꾸고, 검사·exe 재빌드 후 새 작품으로 두 단계를 처음부터 다시 돌려 33/33 통과.
  - 정리: 테스트 작품·최근 항목 삭제, 화면 언어 한국어로 복구.
- **형식/결정 변경** · WORKSPACE_FORMAT ‘세계관 카드·사용자 태그 (08회)’. 작품 schemaVersion 1 그대로(lore/·tags/는 01회부터 예약된 폴더).
- **09회가 쓰는 관계 인터페이스** · 사건은 카드를 **카드 ID**로 연결한다. Rust `workspace::lore::find(session, cardId) -> CardInfo`(이름·별칭·폴더·태그), `lore::list` / 명령 `list_cards`(선택 목록용), 화면 `useWorldBackend().list`. 이름·폴더가 바뀌어도 ID로 다시 찾으므로 사건 쪽에는 ID만 저장하고, 표시할 때 현재 이름을 조회한다. 지워진 카드(찾지 못함)는 `notFound`로 돌아오므로 ‘연결 끊김’으로 표시하면 된다.
- **남은 영향 / 미검증** · 카드 파일의 외부 변경은 창 포커스 때 다시 읽는다(05회 감시는 episodes/만). 카드 삭제 기능은 이번 범위가 아니다(카드 지우기는 탐색기에서). IME 조합 중 카드 본문 입력은 기본 textarea라 04회 CodeMirror 보호는 적용되지 않는다(저장은 버튼으로만 하므로 조합 중 저장은 없음).

---

## 09회 · 사건 입력과 회차·작중 시간·함께 보기 (2026-11-25)

> 앱 소스: `snapshots/09/` (08에서 복사). 실행 파일: `snapshots/09/exe/galpi-09-debug.exe` (09 디버그 탭·도구 포함, 마지막 코드 수정 뒤 다시 빌드).

- **상태** · 완료. 구현·자동 검증·실제 앱(재실행 포함) 검증 통과. CH1 최종 검증(S09.D) 포함, CH2는 09회 몫(확실성·트랙 이름·예전 파일 읽기)까지.
- **작가가 확인할 동작** · exe 디버그 탭 ‘09회 · 사건 입력과 회차·작중 시간·함께 보기’ 체크리스트 5개(09.views, 09.validate, 09.shared, 09.review, 09.certainty). ‘09회 도구’: 표준 표본 / 예전 형식 사건 파일 2개(합성 작품 전용).
- **사건 저장 경로·좌표·정렬·빈 좌표 처리** · WORKSPACE_FORMAT ‘타임라인·사건·작중 트랙 (09회)’.
- **세 모드의 필터·정렬·빈 좌표**
  - 회차: 1화~마지막 화의 모든 행(사건 없는 회차는 ‘사건 없음’), 행마다 ‘+ 사건 추가’, 회차 없는 사건은 아래 ‘회차 미정’.
  - 작중 시간: 트랙(workspace.json 순서)별 정렬 숫자순, 추정은 ‘추정’ 표시, 작중 좌표 없는 사건은 아래 ‘작중 시점 미상·미정’.
  - 함께 보기: 한 줄에 사건 하나, 회차 좌표·작중 시점·원고 확인 열. 정렬 회차순/작중 시간순(빈 좌표 맨 뒤), 보기 전체/회차 미정만/작중 시점 미정만/둘 다 있는 사건. 빈 칸은 ‘미정’(미상은 ‘미상’).
- **공통 표본의 사건 ID** (09회 도구 ‘표준 표본’, 회차 3개 이상 합성 작품): 1화 ‘각성’ = `00000000-0000-4000-8000-000000000901`(‘주인공의 능력’), 3화 ‘불을 다룸’ = `00000000-0000-4000-8000-000000000903`(‘주인공의 능력’ + ‘왕국 연표’ 공유). 예전 형식 파일: `…000000000a01`(좌표 있음 → 확정), `…000000000a02`(좌표 없음 → 미상). 상수는 `debug_tools.rs` `SAMPLE_EVENT_*`.
- **구현 증거**
  - Rust `src-tauri/src/workspace/timelines.rs`: `load`(타임라인·사건·트랙·문제 파일 한 번에, 사건별 회차 번호·확실성·검토 상태 계산), `create_collection`/`update_collection`, `save_event`(만들기·수정, 검증, 요청 ID 재사용, 기대 해시, 회차 바뀌면 확인 해제), `confirm_event`, `add_track`/`rename_track`, `read_event`. `WsError::InvalidEvent { reason }` 추가. 명령 `load_timelines`, `create_timeline`, `update_timeline`, `save_event`, `confirm_event`, `add_story_track`, `rename_story_track`. `debug_tools.rs` `timeline_fixture`(+ `debug_timeline_fixture`).
  - 화면 `src/timeline/`: `TimelinePanel.tsx`(타임라인 목록·만들기(기본 보기)·이름 바꾸기, 세 보기 탭, 사건 편집기(제목·내용·회차·회차 안 순서·확정/추정/미상·트랙·정렬 숫자·표시 이름·올릴 타임라인·태그·관련 카드, 원고 확인), 작중 시간 트랙 관리, 창 포커스 시 다시 읽기), `api.ts`(백엔드, Rust와 같은 `draftProblem` 검증, 정렬 함수). `App.tsx` ‘타임라인’ 루트 연결(이제 네 루트 모두 실제 화면), `main.tsx` 제공자. 문구 `timeline.*`, `errors.invalidEvent`.
  - 디버그 탭: `features.ts` 09 항목(01 항목 루트 설명 갱신), `sessionTools.tsx` 09회 도구.
- **실행 증거** (같은 PC, `galpi-09-debug.exe`, CDP로 앱 창만 조작, 외부 저장은 node로 파일 직접 씀)
  - `npm run check` 통과: vitest **124**(timeline 6, debug 09 도구 1 포함), cargo test **90**(timelines 6, debug_tools tests09 2 포함), fmt·clippy.
  - 실제 앱 1단계 30/30: 합성 작품(3화) → ‘타임라인’ 빈 목록 → ‘주인공의 능력’(기본 회차) → **S09.A** 1화 각성·3화 불을 다룸 추가, 2화 ‘사건 없음’, 사건 파일 episodeId·미상 → 3화 사건에 확정·본편·10·‘10일차’ → 같은 파일·ID, 작중 시간 보기 ‘본편’ 아래 같은 ID, 함께 보기 ‘3화 · 순서 1 / 본편 · 10일차’ → **S09.B** 모두 비움: 안내·파일 안 생김·제목/내용 그대로 → 추정 숫자 없음: 안내 → 숫자 2: 시간만 저장 → 회차만 저장 → 필터 세 가지 결과 일치 → **S09.C** ‘왕국 연표’ 만들고 3화 사건을 공유 → 제목 변경 → 왕국 연표 3화에 새 제목, 파일 1개 → 트랙 ‘본편’→‘회귀 전’(ID 유지)·‘1차 회귀’ 추가 → 1차 회귀 추정 사건 → 3화 r1 커밋 → 요약 저장·이대로 확인(r1) → 사건 이대로 확인(r1), 파일에 reviewedRevisionId.
  - 앱 종료·재실행 후 2단계 16/16: **S09.E** 트랙 이름·추정 유지 → 09회 도구로 예전 형식 파일 2개 → 좌표 있음은 ‘회귀 전’ 아래(확정), 없음은 ‘미상·미정’ 목록, 파일에 storyCertainty 생기지 않음 → **S09.D** 원고를 같은 바이트로 다시 쓰기(열고 닫기) + 밖에서 줄 덧붙여 저장 후 앱이 다시 읽음 → 이력 r1뿐, 요약·사건 모두 ‘최신 확인 (r1)’ → r2 커밋 → 둘 다 ‘재확인 필요 (r1 확인 → 지금 r2)’ → 요약만 ‘이대로 확인 (r2)’ → 사건은 여전히 재확인(왕국 연표에서도 같은 상태) → 사건 확인(r2) → 같은 ID → `.galpi/tmp` 비어 있음.
  - **시험에서 고친 것**: 첫 실행 30개 중 1개 실패. 요약이 아직 없을 때 07회 화면은 ‘요약 저장’만 있고 확인 버튼은 요약을 저장한 뒤에 나오는데, 시험 스크립트와 내가 쓴 09.review 직접 확인 절차가 ‘요약을 쓰고 수정 후 확인’으로 되어 있었다. 앱 동작은 07 설계대로이므로 절차 문구를 ‘요약 저장 → 이대로 확인 (r1)’로 고치고(features.ts), exe를 다시 빌드한 뒤 새 작품으로 두 단계를 처음부터 돌려 46/46.
  - 정리: 테스트 작품·최근 항목 삭제.
- **미검증 / 범위 밖** · S09.D의 ‘합쳐 저장’은 실제 앱에서 ‘밖에서 저장 → 앱이 다시 읽음’ 경로로 확인했고, 05회 충돌 화면의 ‘직접 합치기’를 거친 저장은 Rust 테스트(합친 내용을 작업본 저장 경로로 저장 → 이력 r1·두 상태 유지)로만 확인했다. 두 창 동시 편집 최종 검증은 카드대로 14회. CH2의 상태 조회(확정 좌표만 사용)는 10회.
- **형식/결정 변경** · WORKSPACE_FORMAT ‘타임라인·사건·작중 트랙 (09회)’. 사건·타임라인 파일 schemaVersion 1, 작품 schemaVersion 1 그대로. 오류 코드 `invalidEvent` 추가.
- **다음 인계 (10회)** · 작중 상태 조회는 `EventInfo.certainty === confirmed`인 사건의 (트랙, storyOrder)만 사용하고, 추정은 연표에 ‘추정’으로 표시, 미상은 ‘작중 시점 미상·미정’ 목록에서 찾는다(이미 이 규칙으로 표시 중). 상태 변화 필드(entityId·propertyKey·value)는 사건 파일의 모르는 필드 보존 규칙으로 추가할 수 있다. 사건 ↔ 카드 연결은 `relatedCardIds`(카드 ID).

---

## 10회 · 회귀 구간 링크와 그 시점의 능력 (2026-11-25)

> 앱 소스: `snapshots/10/` (09에서 복사). 실행 파일: `snapshots/10/exe/galpi-10-debug.exe` (10 디버그 탭·도구 포함, 마지막 코드 수정 뒤 다시 빌드).

- **상태** · 완료. 구현·자동 검증·실제 앱(재실행 포함) 검증 통과. CH2 최종 검증(S10.D) 포함.
- **작가가 확인할 동작** · exe 디버그 탭 ‘10회 · 회귀 구간 링크와 그 시점의 능력’ 체크리스트 5개(10.links, 10.missing, 10.state, 10.ch2, 10.delete). ‘10회 도구’: 회귀 표본(합성 작품 전용, 실행 후 작품을 닫았다 다시 열기).
- **저장 뷰 직렬화·각 모드 필터·동률 규칙** · WORKSPACE_FORMAT ‘저장한 보기(링크)·상태 변화·상태 조회 (10회)’.
- **미래 정보가 포함되지 않음을 증명하는 데이터** · Rust `views::fixture`(테스트)와 같은 내용을 10회 도구 ‘회귀 표본’이 실제 작품에 고정 ID로 쓴다. 사건(…1001~…1012, 상수 `debug_tools::REGRESSION_EVENTS`): 1화 각성(본편 1, 능력=불꽃 각성), 20화 능력 강화(본편 6, 능력=화염 조종), 25화 동료 도윤·동료 린(둘 다 25화 순서 1·본편 4, 동률 → ID 순으로 린), 299화(본편 9), 300화 화염 사용(회귀 전 2), 305화 능력 없음(1차 회귀 1), 310화 불씨 감지(1차 회귀 2 **추정**), 327화 과거 공개(본편 2, 과거=회귀자, 태그 회귀·비밀), 350화(작중 미상), 351화 귀환(본편 10), 회차 미정 사건(본편 5). 기대값: 300~350화 = …1006~…1010, ‘25화까지 공개’ = 각성·능력 강화·동료 2개(327 없음, 과거=미기록), 본편 2까지 = 각성·327(과거=회귀자), 교집합(25화∩본편 2) = 각성만, 1차 회귀 2까지 확정 = 능력 없음(불씨 감지는 추정이라 뺌).
- **구현 증거**
  - Rust `src-tauri/src/workspace/views.rs`(새): `SavedView`/`ViewFilter`/`StateQuery`, `create_view`·`update_view`·`delete_view`(요청 ID 재사용, 기대 해시), 순수 함수 `filter_events`·`compute_state`, `query_view`·`query_state`. `timelines.rs`: 사건 `changes`(StateChange), `delete_event`, `load`가 `views`도 반환. 명령 `query_view`, `query_state`, `create_view`, `update_view`, `delete_view`, `delete_event`. `debug_tools.rs` `TimelineAction::RegressionSample`.
  - 화면 `src/timeline/TimelinePanel.tsx`: 필터 막대(회차 범위·작중 트랙 범위·포함/숨김 태그·필터 해제, 규칙 문구), ‘이 조건을 링크로 저장’, 타임라인 위 링크 칩, 이동 스택(한 단계씩, ‘← 뒤로’가 필터·보기 방식·스크롤 복구, 링크를 열 때 다시 읽기), 사라진 링크 → ‘← 원래 위치로’, 사건 편집 ‘상태 변화’ 줄, ‘사건 삭제…’(영향 타임라인 수 먼저), 목록 아래 ‘그 시점의 상태’(독자/작중/둘 다, 우선 축, 미기록, 근거 사건, 추정 제외 목록), ‘이 기준으로 고정’·‘고정한 기준’, ‘현재 전체 설정 열기’(세계관으로 이동해 그 카드 열기, `world/api.ts` `requestOpenCard`). 필터 결과는 Rust `query_view`에 물어 규칙 구현은 한 곳. 문구 `timeline.*` 추가.
  - 테스트 정리: 09의 가짜 백엔드를 `src/timeline/testkit.tsx`로 옮겨 09·10 테스트가 같이 씀.
  - 디버그 탭: `features.ts` 10 항목, `sessionTools.tsx` 10회 도구.
- **실행 증거** (같은 PC, `galpi-10-debug.exe`, CDP로 앱 창만 조작)
  - `npm run check` 통과: vitest **131**(timeline10 6, debug 10 도구 1 포함), cargo test **98**(views 7, debug_tools tests10 1 포함), fmt·clippy.
  - 실제 앱 1단계 23/23: 합성 작품 → 10회 도구 회귀 표본(351화·사건 12개) → 작품 닫고 다시 열기 → ‘회귀 연표’ 회차 보기 필터 300~350 → ‘사건 12개 중 5개 표시’, 행 300~350만, 299·351·회차 미정 없음 → 숨김 ‘비밀’ 4개 → 해제 5개, 파일 수 그대로 → **S10.B** 링크 ‘회귀편’ 저장(파일에 조건만) → 링크 열기 ‘300~350화’·5개 → ‘← 뒤로’ 필터 300/350·스크롤 600 그대로 → 327화에 사건 추가 → 링크 다시 열기 6개 → **S10.C** 독자 25화: 능력 화염 조종·과거 미기록·동료 린, 327 미사용 / 작중 본편 2: 과거 회귀자·능력 불꽃 각성 / 교집합: 과거 미기록 → ‘25화 기준’ 고정 → 다시 열기 조건 문구·미기록, 카드 본문 없음 → ‘현재 전체 설정 열기’로 세계관 서린 카드.
  - 앱 종료·재실행 후 2단계 14/14: 고정 기준·링크 유지 → **S10.D** 1차 회귀 2: 능력 없음 + ‘불씨 감지’ 추정 제외 → 작중 시간 탭에 추정 표시 → 확정으로 저장 → 불씨 감지 → 회귀 전 2: 화염 사용 그대로, 독자 기준 계산 순서 그대로 → 필터 300 상태에서 링크를 연 채 view 파일 삭제 → 창 포커스 → ‘링크 대상을 찾을 수 없습니다’ → ‘← 원래 위치로’ 필터 300 복구 → 필터 해제는 파일 그대로 → 350화 사건 ‘사건 삭제…’ 영향 안내 → 확인 후 파일 삭제 → `.galpi/tmp` 비어 있음.
  - **시험 중 고친 것**: ① 링크를 열 때 작품을 다시 읽지 않아 나중에 넣은 사건이 링크에 늦게 보일 수 있었다 → 링크 열기에서 다시 읽도록 고침(vitest S10.B가 잡음). ② 08 세계관 테스트 하나가 목록 첫 로드를 기다리지 않아 가끔 실패(연속 실행에서 통과/실패) → 테스트가 첫 로드를 기다리도록 고침(snapshots/10에서만, 08·09는 동결 상태 그대로). ③ 실제 앱 시험 스크립트 결함 두 가지(작품을 닫은 뒤 디버그 탭에 남아 최근 목록을 못 찾음, 결과 표를 DOM에서 직접 지워 React 갱신을 깨뜨림)를 고친 뒤 새 작품으로 두 단계를 처음부터 다시 돌려 37/37.
  - **설명하지 못한 한 번**: 스크립트 결함 ①이 있던 첫 실행에서 시험 도중 앱 프로세스가 사라졌다(오류 출력·Windows 오류 기록에 galpi 관련 항목 없음). 이후 표준 오류를 파일로 받으며 세 번 더 돌렸을 때는 재현되지 않았다. **미검증으로 남김** — 다시 보이면 `RUST_BACKTRACE=1`과 표준 오류 파일로 원인을 잡아야 한다.
  - 정리: 테스트 작품·최근 항목 삭제.
- **형식/결정 변경** · WORKSPACE_FORMAT ‘저장한 보기(링크)·상태 변화·상태 조회 (10회)’. 보기 파일 schemaVersion 1, 사건 `changes` 필드 추가(작품 schemaVersion 1 그대로).
- **남은 영향** · 351화 작품에서 왼쪽 회차 목록이 길게 늘어난다(목록 가상화·접기는 이후 회차의 성능 작업). 10회 도구로 회차를 늘린 뒤에는 작품을 다시 열어야 회차 목록에 반영된다(도구가 앱 밖 경로로 회차를 만들기 때문). 상태 조회의 속성 이름 목록은 대상의 모든 사건에서 모으므로, 독자 기준 결과에도 아직 공개되지 않은 속성 ‘이름’이 ‘미기록’ 줄로 보일 수 있다(값은 보이지 않음). AI 자료로 내보낼 때(17회 이후) 미기록 줄을 빼는 선택지가 필요할 수 있다.
