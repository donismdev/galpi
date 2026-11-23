# 회차별 개발 기록

이 파일은 시작 템플릿이다. 받은 시점의 구현 상태는 전 회차 미착수다. 작업 AI는 실제 실행한 결과만 갱신한다.

| 회차 | 작업 | 상태 | 증거·미확인 항목 |
|---|---|---|---|
| 01 | 실행 뼈대와 첫 작업 화면 | 완료 (IME 실입력은 04회로) | S01.A·B·C 통과. 데스크톱 셸 실기동 캡처 2장(en·ko 재실행). 아래 01회 기록 |
| 02 | 작품 폴더 열기와 안전한 저장 기반 | 미착수 | — |
| 03 | 다음 화 생성과 외부 편집기 | 미착수 | — |
| 04 | 내장 집필과 한글 입력 | 미착수 | — |
| 05 | 외부 변경·충돌·초안 복구 | 미착수 | — |
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
