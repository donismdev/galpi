// Debug tab content: what each development session implemented and how to test it by hand.
// Developer-facing, Korean only (not part of the ko/en UI tables). Update this file at the end of
// every session (see SNAPSHOTS.md, rule 4).

export interface TestStep {
  /** Stable id for the checkbox state (session.step). */
  id: string;
  title: string;
  /** What to do, in order. */
  steps: string[];
  /** What must be true afterwards. */
  expect: string[];
  /** Commands or file locations that help. */
  notes?: string[];
}

export interface SessionFeatures {
  session: string;
  title: string;
  snapshot: string;
  criteria: string;
  implemented: string[];
  automated: string[];
  manual: TestStep[];
}

const RUN = "snapshots\\03 폴더에서 `npm run tauri dev` (처음이면 먼저 `npm install`)";
const SETTINGS = "%APPDATA%\\dev.donism.galpi\\settings.json";

export const SESSIONS: SessionFeatures[] = [
  {
    session: "01",
    title: "실행 뼈대와 첫 작업 화면",
    snapshot: "snapshots/01",
    criteria: "S01.A 두 언어에서 네 루트·재실행 후 언어 유지 · S01.B 빠진 키 지목 · S01.C 데스크톱/브라우저 구분",
    implemented: [
      "Tauri 2 + React + TypeScript + Vite 데스크톱 앱. Rust 코어(src-tauri)와 화면(src)이 명령(invoke)으로 통신한다.",
      "왼쪽 네 고정 루트: 회차 / 회차 요약 / 타임라인 / 세계관. 누르면 가운데 제목·설명이 바뀐다.",
      "화면 언어 한국어/English 전환. 바꾸는 즉시 메뉴·버튼·상태 문구가 바뀌고, Rust가 기기 설정 파일의 uiLanguage에 저장해 재실행 후에도 유지된다.",
      "기기 설정 파일은 작품 폴더 밖(" + SETTINGS + ")에 있다. 메모장으로 저장해 BOM이 붙어도 읽는다. 깨진 파일은 지우지 않고 기본값(한국어)을 쓴다.",
      "하단 상태줄에 실행 환경 표시: ‘데스크톱 앱’ 또는 ‘브라우저 미리보기 (설정은 이 브라우저에만 저장)’.",
      "ko/en 문구 키 검사 CLI: 두 언어 표의 키가 다르면 어느 언어의 어느 키인지 출력하고 실패한다.",
    ],
    automated: [
      "npm run check  (타입 검사 + 키 검사 + vitest + cargo fmt/clippy/test 전체)",
      "npm run check:i18n  → ‘check-i18n: OK - en, ko share the same keys’",
      "vitest: src/App.test.tsx (네 루트·언어 전환·재마운트 유지·저장 실패 표시), src/i18n/keyCheck.test.ts, tests/i18n-cli.test.ts",
      "cargo test settings::  (기본값·왕복 저장·깨진 파일·BOM·알 수 없는 언어 거절)",
    ],
    manual: [
      {
        id: "01.lang",
        title: "언어 전환과 재실행 유지",
        steps: [
          RUN,
          "오른쪽 위 ‘화면 언어’에서 English 선택",
          "창을 닫고 같은 명령으로 다시 실행",
          "다시 한국어로 바꾼다",
        ],
        expect: [
          "선택 즉시 왼쪽 루트가 Episodes / Episode summaries / Timeline / World로 바뀐다",
          "재실행 후에도 English",
          SETTINGS + " 의 \"uiLanguage\" 값이 선택과 같다",
        ],
      },
      {
        id: "01.i18n",
        title: "빠진 문구 키 지목",
        steps: ["snapshots\\03 에서: node scripts/check-i18n.ts tests/fixtures/i18n-missing-key"],
        expect: ["종료 코드 1", "출력에 ‘[en] roots.timeline: missing key’"],
      },
      {
        id: "01.browser",
        title: "브라우저 미리보기 구분",
        steps: ["npm run dev", "브라우저에서 http://localhost:1420 열기"],
        expect: [
          "하단 상태줄 ‘브라우저 미리보기 (설정은 이 브라우저에만 저장)’",
          "작품 폴더 열기 대신 ‘데스크톱 앱에서 사용하세요’ 안내",
          "디버그 탭이 보이고 빌드 정보는 ‘브라우저’로 표시",
        ],
      },
      {
        id: "01.bom",
        title: "메모장으로 고친 설정 파일",
        steps: [
          "앱을 닫는다",
          SETTINGS + " 를 메모장으로 열어 \"uiLanguage\": \"en\" 으로 바꾸고 저장",
          "앱 실행",
        ],
        expect: ["English로 시작한다 (BOM이 붙어도 읽음)"],
      },
    ],
  },
  {
    session: "02",
    title: "작품 폴더 열기와 안전한 저장 기반",
    snapshot: "snapshots/02",
    criteria: "S02.A 한글·공백·괄호 경로 재열기 후 같은 ID · S02.B 중단·취소·읽기 전용·상위 스키마·동시 열기 · S02.C 무관한 파일 해시 불변·루트 밖 쓰기 차단",
    implemented: [
      "‘작품 폴더 선택…’ → Windows 폴더 대화상자 → 폴더 상태 검사 후 분기: 빈 폴더 / 다른 파일이 있는 폴더 / 이름 충돌 / 만들다 멈춘 폴더 / 기존 작품 / 더 새 형식 작품 / 깨진 workspace.json.",
      "새 작품: workspace.json(schemaVersion 1, workspaceId, title, storyTracks, createdAt)과 고정 폴더 13개(episodes, summaries, notes/next, lore/…, tags, timelines/…, links, threads), 앱 내부 폴더 .galpi/(tmp, lock).",
      "만들기 순서: .galpi/init.json(작품 ID 확정) → 폴더 → workspace.json 게시(덮어쓰기 없음) → 표식 삭제. 중간에 멈추면 같은 ID로 ‘이어서 완료’.",
      "다른 파일이 있는 폴더는 확인 체크 후에만 만든다. workspace.json·episodes·lore 등과 같은 이름(대소문자 무시)이 있으면 만들지 않고 새 하위 폴더를 제안한다.",
      "열기 모드: 쓰기 가능 / 읽기 전용(더 새 형식 → 아무것도 안 씀, 다른 프로세스가 잠금 보유, 쓰기 권한 없음·workspace.json 읽기 전용 속성). 상단 배지와 이유 안내.",
      "최근 작품 목록(기기 설정 recentWorkspaces, 최대 10). 사라진 폴더는 오류와 ‘목록에서 빼기’.",
      "작품을 바꾸면 이전 작품에 대한 늦은 응답은 버린다(sessionId 확인).",
      "모든 파일 쓰기는 한 경로(WorkspaceSession::write_file)로: 상대 경로 검증(.., 드라이브, ADS, 예약 이름, 정션 탈출 차단), 읽을 때 해시와 다르면 쓰지 않음, 같은 요청 ID는 한 번만.",
      "열 때 .galpi/tmp 의 남은 임시 파일만 정리한다(다른 파일은 건드리지 않음).",
    ],
    automated: [
      "cargo test workspace::tests  (S02.A·B·C, 실패 지점 3곳 중단·재개, 동시 열기 잠금, 상위 형식 무변경, 충돌·무관 파일 해시)",
      "cargo test workspace::paths  (경로 검증, 실제 디렉터리 정션으로 루트 탈출 차단)",
      "cargo test workspace::atomic  (교체·새 파일 게시·임시 파일 정리)",
      "vitest: src/workspace/workspace.test.tsx (생성·취소·확인 필요·충돌 제안·읽기 전용·이어서 완료·재시도·늦은 응답 무시·사라진 최근 작품)",
    ],
    manual: [
      {
        id: "02.create",
        title: "빈 폴더에 새 작품 → 닫기 → 다시 열기",
        steps: [
          RUN,
          "탐색기에서 이름에 한글·공백·괄호가 든 빈 폴더를 만든다 (예: 문서\\내 소설 (초고))",
          "‘작품 폴더 선택…’ → 그 폴더 → 제목 입력 → ‘새 작품 만들기’",
          "디버그 탭 ‘현재 상태’에서 workspaceId 확인",
          "‘작품 닫기’ → 시작 화면 ‘최근 작품’의 ‘열기’",
        ],
        expect: [
          "상단에 제목·경로·‘작품 닫기’",
          "폴더에 workspace.json, 고정 폴더 13개, .galpi\\lock, .galpi\\tmp",
          "다시 연 뒤 디버그 탭의 workspaceId가 같다 (sessionId는 새 값)",
        ],
      },
      {
        id: "02.cancel",
        title: "폴더 선택 취소",
        steps: ["‘작품 폴더 선택…’ → 대화상자에서 ‘취소’"],
        expect: ["‘폴더 선택을 취소했습니다. 바뀐 것은 없습니다.’"],
      },
      {
        id: "02.nonempty",
        title: "다른 파일이 있는 폴더",
        steps: [
          "아무 텍스트 파일 하나가 든 폴더를 고른다",
          "PowerShell: Get-FileHash <그 파일>  (앱 동작 전에 한 번)",
          "체크하지 않고 ‘새 작품 만들기’가 꺼져 있는지 본다 → 체크 후 만들기",
          "다시 Get-FileHash",
        ],
        expect: ["항목 수 안내와 확인 체크", "만든 뒤에도 기존 파일 해시가 같다"],
      },
      {
        id: "02.conflict",
        title: "이름 충돌",
        steps: ["폴더에 ‘Episodes’라는 파일(확장자 없음)을 만들고 그 폴더를 고른다"],
        expect: [
          "‘이름이 겹치는 항목이 있어 만들 수 없습니다’와 Episodes 목록",
          "‘대신 이 새 하위 폴더에 만들기’ → 하위 폴더에 작품이 생기고 원래 파일은 그대로",
        ],
      },
      {
        id: "02.newer",
        title: "더 새 형식의 작품 (읽기 전용, 아무것도 안 씀)",
        steps: [
          "작품 폴더를 통째로 복사한다 (원본 말고 복사본으로!)",
          "복사본의 workspace.json에서 \"schemaVersion\": 1 을 99로 바꾸고 .galpi 폴더를 지운다",
          "앱에서 복사본 폴더를 연다",
        ],
        expect: ["상단 ‘읽기 전용’ 배지와 ‘형식 99’ 안내", "복사본에 .galpi 폴더가 다시 생기지 않는다", "‘다음 화 쓰기’ 꺼짐"],
      },
      {
        id: "02.locked",
        title: "같은 작품을 두 번째 실행본에서 열기",
        steps: [
          "npm run tauri dev 로 작품 A를 연 상태를 유지",
          "다른 PowerShell에서 저장소 루트의 target\\debug\\galpi.exe 실행 (개발 서버를 같이 씀)",
          "두 번째 창에서 같은 작품 A를 최근 작품에서 연다",
        ],
        expect: ["두 번째 창: ‘읽기 전용’ + ‘다른 galpi 창이나 프로그램에서 이미 쓰기용으로 열려 있습니다’", "첫 창을 닫은 뒤 두 번째 창에서 다시 열면 쓰기 가능"],
      },
      {
        id: "02.failpoint",
        title: "작품 만들기 중 강제 종료 → 이어서 완료",
        steps: [
          "PowerShell: $env:GALPI_FAILPOINT='init-after-dirs'; npm run tauri dev",
          "빈 폴더에 새 작품 만들기 → 앱이 강제 종료된다",
          "Remove-Item Env:GALPI_FAILPOINT; npm run tauri dev",
          "같은 폴더를 고른다 → ‘이어서 완료’",
        ],
        expect: ["‘작품 만들기가 중간에 멈춘 폴더입니다’", "완료 후 workspace.json의 workspaceId가 .galpi\\init.json에 있던 ID와 같다 (완료 후 init.json은 사라짐)"],
        notes: ["다른 지점: init-after-marker, init-after-manifest (후자는 다음 열기에서 ‘거의 끝난 작품 만들기를 마무리했습니다’)"],
      },
      {
        id: "02.readonlyattr",
        title: "읽기 전용 속성",
        steps: ["탐색기에서 작품의 workspace.json → 속성 → ‘읽기 전용’ 체크", "앱에서 그 작품 열기", "끝나면 체크 해제"],
        expect: ["‘이 폴더에 쓸 권한이 없어 읽기 전용으로 열었습니다’"],
      },
      {
        id: "02.missing",
        title: "사라진 최근 작품",
        steps: ["앱을 닫고 최근 작품 폴더 이름을 바꾼다", "앱 실행 → 그 최근 작품 ‘열기’", "‘목록에서 빼기’"],
        expect: ["‘폴더를 찾을 수 없습니다’와 경로", "목록에서 사라진다 (폴더 이름은 되돌려 둔다)"],
      },
    ],
  },
  {
    session: "03",
    title: "다음 화 생성과 외부 편집기",
    snapshot: "snapshots/03",
    criteria: "S03.A 1·2·3화 재열기 후 순서·절대 경로 · S03.B 재시도 1개·독립 요청 다른 번호·다시 열기로 늘지 않음 · S03.C VS Code(루트+원고)·메모장 · S03.D 편집기 닫기 무영향·잘못된 경로 시 다른 편집기",
    implemented: [
      "‘다음 화 쓰기 (N화)’: 디스크의 최대 번호+1로 새 회차를 만들고(결번은 채우지 않음) 선택한 뒤 기본 편집기로 연다.",
      "회차 폴더 episodes/<번호 6자리>-<ID 8자리>/ 에 episode.json(episodeId, number, title, createdAt, requestId)과 빈 manuscript.md. 두 파일은 스테이징 폴더에서 완성해 이름 변경 한 번으로 게시한다.",
      "같은 ‘만들기’ 의도(더블클릭·실패 후 재시도, 앱 재시작 후 재시도 포함)는 같은 requestId → 회차 1개. 서로 다른 요청은 쓰기 잠금 안에서 번호를 받아 겹치지 않는다.",
      "사이드바 ‘회차’ 아래 회차 목록(번호순). 읽을 수 없거나 번호가 겹치는 폴더는 경고로만 보여주고 건드리지 않는다.",
      "회차 상세: 제목(바꿔도 ID·폴더 유지), 원고 절대 경로, ‘VS Code(으)로 다시 열기’, ‘메모장(으)로 열기’.",
      "외부 편집기: VS Code는 Code.exe에 [작품 루트, 원고]를 셸 없이 넘겨 탐색기에 작품이 보이고 원고가 열린다. 메모장은 원고만. 성공은 ‘열기 요청을 보냄’일 뿐, 편집기를 닫아도 회차 상태·이력은 바뀌지 않는다(CH1).",
      "편집기 설정(기기 설정 editor): 기본 편집기(VS Code/메모장/내장=04회), VS Code 위치(비우면 자동 탐지: 사용자 설치 → Program Files → PATH의 code.cmd).",
      "열기 실패 시 이유, 찾아본 위치, 다른 편집기로 열기 버튼. 회차는 그대로 남는다.",
      "읽기 전용 작품에서는 새 회차를 만들 수 없다(기존 원고는 편집기로 열 수 있음).",
      "디버그 탭(이 화면): 디버그 빌드에서만 보인다. 빌드 정보, 현재 상태, 합성 작품 만들기, 회차별 구현 목록과 테스트 체크리스트.",
    ],
    automated: [
      "cargo test workspace::episodes  (S03.A 재열기 순서·절대 경로, S03.B 재시작 후 같은 요청, 8스레드 동시 생성, 같은 요청 6개 동시, 결번, 깨진·중복 폴더, 제목 변경, 읽기 전용)",
      "cargo test editor::  (VS Code 인자 [루트, 원고], code.cmd → Code.exe, 잘못된 경로 목록, 실행 실패 보고, 메모장 인자)",
      "cargo test workspace::sample",
      "vitest: src/episodes/episodes.test.tsx (만들기·선택·열기, 1~3화 순서, 실패 후 같은 요청 ID, 더블클릭 1개, 편집기 없음 → 다른 편집기, 내장 미지원 안내, 제목 변경, 읽기 전용)",
      "합성 작품 CLI: cargo run --manifest-path src-tauri/Cargo.toml --example make_sample_work -- \"<새 폴더>\" 제목 3",
    ],
    manual: [
      {
        id: "03.next",
        title: "다음 화 쓰기 → VS Code",
        steps: [
          RUN,
          "작품을 연다 (또는 아래 ‘합성 작품 만들기’로 만든 작품)",
          "왼쪽 ‘회차’ → ‘다음 화 쓰기 (N화)’ 한 번",
        ],
        expect: [
          "사이드바에 N화가 생기고 선택된다",
          "‘VS Code에 열기 요청을 보냈습니다…’ 안내",
          "VS Code 창 제목 ‘manuscript.md - <작품 폴더 이름> - Visual Studio Code’, 탐색기에 작품 폴더, 원고가 선택됨",
        ],
      },
      {
        id: "03.order",
        title: "1·2·3화 → 닫기 → 다시 열기",
        steps: ["‘다음 화 쓰기’로 1~3화 생성 (또는 합성 작품 3화)", "‘작품 닫기’ → 최근 작품 ‘열기’", "각 회차를 눌러 원고 경로 확인"],
        expect: ["1화·2화·3화 순서", "경로가 <작품>\\episodes\\00000N-xxxxxxxx\\manuscript.md 이고 실제로 존재"],
      },
      {
        id: "03.notepad",
        title: "메모장으로 열기",
        steps: ["회차 상세에서 ‘메모장(으)로 열기’"],
        expect: ["메모장에 같은 원고가 열린다 (Windows 11은 이미 열린 메모장 창의 새 탭일 수 있음)"],
      },
      {
        id: "03.badpath",
        title: "잘못된 VS Code 위치 (S03.D)",
        steps: [
          "‘편집기 설정’ 펼치기 → VS Code 위치에 C:\\없는 경로\\Code.exe 입력 후 다른 곳 클릭",
          "‘VS Code(으)로 다시 열기’ 두 번",
          "‘다음 화 쓰기’ 한 번",
          "VS Code 위치 칸을 비운다",
        ],
        expect: [
          "‘VS Code(으)로 열지 못했습니다… 찾아본 위치: C:\\없는 경로\\Code.exe’ + ‘메모장(으)로 열기’",
          "다시 열기를 눌러도 회차 수가 늘지 않는다. ‘다음 화 쓰기’는 회차를 1개만 만들고 열기 실패를 보여준다",
          "칸을 비우면 아래 탐지 결과가 실제 Code.exe 경로로 돌아온다",
        ],
      },
      {
        id: "03.close",
        title: "편집기를 닫아도 상태 불변 (CH1)",
        steps: ["VS Code로 원고를 연 뒤 아무것도 고치지 않고 VS Code 창을 닫는다", "앱에서 회차 목록·제목 확인"],
        expect: ["회차 목록·번호·제목·경로가 그대로", "PowerShell: Get-FileHash 로 본 episode.json·manuscript.md 해시가 전과 같다"],
      },
      {
        id: "03.rename",
        title: "제목 변경",
        steps: ["회차 제목 칸에 ‘각성’ 입력 후 Enter"],
        expect: ["사이드바 ‘1화 · 각성’", "원고 경로·폴더 이름은 그대로, episode.json의 \"title\": \"각성\""],
      },
      {
        id: "03.gap",
        title: "결번 뒤에 만들기",
        steps: ["앱을 닫고 탐색기에서 2화 폴더(episodes\\000002-…)를 지운다 (테스트 작품에서만!)", "작품 열기 → ‘다음 화 쓰기’"],
        expect: ["버튼이 ‘(4화)’로 표시되고 4화가 생긴다 (2화를 다시 채우지 않음)"],
      },
      {
        id: "03.readonly",
        title: "읽기 전용 작품",
        steps: ["02.newer 또는 02.locked 방법으로 읽기 전용으로 연다"],
        expect: ["‘다음 화 쓰기’ 꺼짐과 안내", "기존 회차는 VS Code·메모장으로 열 수 있다"],
      },
      {
        id: "03.builtin",
        title: "기본 편집기 = 내장 편집기",
        steps: ["‘편집기 설정’에서 기본 편집기를 ‘내장 편집기’로 → ‘다음 화 쓰기’", "끝나면 VS Code로 되돌린다"],
        expect: ["(04회부터) 회차가 만들어지고 외부 편집기는 열리지 않으며 ‘아래 내장 편집기에서 씁니다’와 함께 편집기에 바로 쓸 수 있다"],
      },
    ],
  },
  {
    session: "04",
    title: "내장 집필과 한글 입력",
    snapshot: "snapshots/04",
    criteria:
      "S04.A 실제 IME 천천히/빠르게·조합 중 저장·포커스 이동·한영 전환 후 누락·중복 없음 · S04.B Ctrl+S·자동저장·입력 직후 닫기·권한 실패와 재시도 · S04.C 빈 문서/장문/이모지/BOM·CRLF 무변경 · S04.D CP949 판독 실패·잠금 다시 읽기",
    implemented: [
      "회차를 고르면 상세 화면 아래에 내장 편집기(CodeMirror 6, Markdown 원문, 줄바꿈 자동 줄넘김, 실행취소 Ctrl+Z/Ctrl+Y)가 실제 원고 파일에 연결된다. 외부 편집기 버튼은 ‘이번만 다른 편집기로 열기’로 그대로 쓸 수 있다.",
      "저장 상태: 변경 없음 → 편집 중 → 저장 중… → 저장됨 HH:MM:SS / 저장하지 못했습니다(다시 저장) / 저장 보류(디스크가 바뀜). 입력을 1.2초 멈추면 자동저장, Ctrl+S 즉시 저장.",
      "한글 IME: 조합 중(compositionstart~end)에는 저장하지 않고 조합이 끝난 뒤 저장한다. 입력은 React 상태를 거치지 않아 조합 중 재주입·재마운트가 없다. 저장 중 들어온 입력은 새 세대로 남아 이어서 저장된다.",
      "파일 형식 보존: 읽을 때 UTF-8 BOM 유무와 CRLF/LF를 기억해 저장할 때 그대로 쓴다. 열기만 하면 파일을 쓰지 않는다. 줄바꿈이 섞인 파일은 안내 후 많은 쪽으로 맞춘다. 상태줄에 ‘UTF-8 (BOM) · CRLF’ 표시.",
      "저장은 읽은 시점의 해시를 함께 보내 디스크가 바뀌었으면 쓰지 않는다(writeConflict → ‘저장 보류’, 자동저장 중지). 합치는 화면은 05회.",
      "저장 실패·보류 시 쓴 내용을 작품 폴더의 .galpi/drafts/<회차ID>.json 복구 초안으로 보관하고, 다시 열면 ‘초안 내용으로 바꾸기 / 초안 버리기’를 보여준다. 저장에 성공하면 초안은 지워진다.",
      "CH1: UTF-8로 읽을 수 없는 원고(CP949 등)는 편집기 없이 안내 + ‘원본 위치 열기’(탐색기에서 파일 선택) + ‘다시 읽기’. 그 동안 자동저장·초안 쓰기 없음. 다른 프로그램이 잠근 파일은 ‘사용 중’ 안내 + ‘다시 읽기’.",
      "회차 바꾸기·작품 닫기·다른 작품 열기·창 닫기 전에 먼저 저장한다(조합이 끝나길 기다림). 창 닫기에서 저장이 실패하면 한 번 멈추고 알려준다(초안 보관됨, 한 번 더 닫으면 닫힘).",
      "기본 편집기를 ‘내장 편집기’로 두면 ‘다음 화 쓰기’가 외부 프로그램 없이 바로 내장 편집기로 간다.",
    ],
    automated: [
      "cargo test workspace::manuscript  (S04.C 빈/BOM만/LF/줄바꿈 없음/CRLF/BOM+CRLF+이모지/장문/Markdown 왕복 바이트 동일, 편집 후 BOM·CRLF 유지, 섞인 줄바꿈, 디스크 변경 시 저장 거절, S04.D CP949 무변경·초안 보존, 잠긴 파일 → 다시 읽기, 초안 저장·삭제)",
      "vitest: src/manuscript/editor.test.tsx (자동저장, Ctrl+S와 새 해시, BOM·CRLF 전달, 조합 중 저장 안 함, 저장 중 입력 → 다음 세대, 실패 → 초안·다시 저장, 충돌 → 보류·자동저장 중지, CP949 → 편집기·저장·초안쓰기 없음, 잠금 → 다시 읽기, 초안 복원, 읽기 전용)",
      "실제 WebView2 IME 이벤트 재현(CDP Input.imeSetComposition/insertText)으로 확인한 기록은 PROGRESS.md 04회",
    ],
    manual: [
      {
        id: "04.ime",
        title: "실제 한글 IME로 한 문단 (S04.A)",
        steps: [
          RUN,
          "작품 열기 → ‘회차’ → 빈 회차 선택 → 아래 편집기 클릭",
          "한글 자판으로 ‘서린은 불씨를 감지했다.’를 천천히 입력. ‘불’을 조합 중인 채로 2초 기다리기 → Ctrl+S",
          "Enter 후 같은 문장을 빠르게 입력",
          "조합 중에 편집기 바깥(회차 제목 칸)을 클릭했다가 돌아오기, 한/영 키로 영어 몇 글자 섞기",
        ],
        expect: [
          "조합 중에는 ‘편집 중’에서 멈추고 저장하지 않는다. 조합이 끝나면 ‘저장됨’",
          "글자 빠짐·중복·커서 튐이 없다",
          "VS Code나 메모장으로 같은 원고를 열면 화면과 같은 문장",
        ],
      },
      {
        id: "04.save",
        title: "Ctrl+S와 자동저장 (S04.B)",
        steps: ["몇 글자 입력 → Ctrl+S", "몇 글자 더 입력 → 손을 떼고 2초 기다리기"],
        expect: ["Ctrl+S 직후 ‘저장 중…’ → ‘저장됨 HH:MM:SS’", "기다리면 자동으로 ‘저장됨’ (시간이 갱신됨)"],
      },
      {
        id: "04.close",
        title: "입력 직후 창 닫기 / 회차 바꾸기 (S04.B)",
        steps: ["글자를 입력하자마자 창의 X를 누른다", "다시 실행해 같은 회차를 연다", "입력 직후 다른 회차를 눌러 보기"],
        expect: ["마지막 글자까지 저장되어 있다", "회차를 바꿔도 앞 회차 내용이 저장되어 있다"],
      },
      {
        id: "04.permission",
        title: "저장 실패와 다시 저장 (S04.B)",
        steps: [
          "탐색기에서 그 회차의 manuscript.md → 속성 → ‘읽기 전용’ 체크",
          "앱에서 몇 글자 입력 → 기다리기",
          "읽기 전용 해제 → ‘다시 저장’",
        ],
        expect: [
          "‘저장하지 못했습니다… 복구 초안으로 따로 보관했습니다’, 파일은 그대로",
          "<작품>\\.galpi\\drafts\\<회차ID>.json 이 생긴다",
          "‘다시 저장’ 후 ‘저장됨’, 파일에 입력 반영, 초안 파일은 사라짐",
        ],
      },
      {
        id: "04.form",
        title: "BOM·CRLF·이모지·빈 문서·장문 무변경 (S04.C)",
        steps: [
          "메모장에서 원고에 이모지 🔥와 여러 줄을 쓰고 ‘다른 이름으로 저장 → 인코딩 UTF-8(BOM)’으로 저장 (메모장은 CRLF)",
          "PowerShell: Get-FileHash <원고>",
          "앱에서 그 회차를 열기만 하고 다른 회차로 이동 → 다시 Get-FileHash",
          "앱에서 한 줄 추가 → 저장 → VS Code 오른쪽 아래에서 ‘UTF-8 with BOM’, ‘CRLF’ 확인",
          "빈 회차와 아주 긴 원고(수만 자 붙여넣기)도 열어 본다",
        ],
        expect: [
          "앱 상태줄 ‘UTF-8 (BOM) · CRLF’",
          "열기만 했을 때 해시가 같다",
          "추가 후에도 BOM·CRLF 유지, 다른 줄은 그대로",
        ],
      },
      {
        id: "04.cp949",
        title: "CP949 원고 (S04.D)",
        steps: [
          "메모장에서 한글 원고를 ‘다른 이름으로 저장 → 인코딩 ANSI’로 저장 (한국어 Windows에서 CP949)",
          "Get-FileHash → 앱에서 그 회차 열기 → 1분 기다리기 → Get-FileHash",
          "‘원본 위치 열기’ → 메모장에서 UTF-8로 다시 저장 → 앱에서 ‘다시 읽기’",
        ],
        expect: [
          "‘UTF-8로 읽을 수 없습니다’ 안내, 편집기 없음",
          "해시가 그대로 (자동저장 없음). 기존 복구 초안이 있었다면 그대로 남음",
          "UTF-8로 바꾼 뒤 ‘다시 읽기’로 정상 편집",
        ],
      },
      {
        id: "04.lock",
        title: "잠긴 원고 (S04.D)",
        steps: [
          "PowerShell: $f = [IO.File]::Open('<원고 경로>', 'Open', 'ReadWrite', 'None')",
          "앱에서 그 회차 열기",
          "PowerShell: $f.Close() → 앱에서 ‘다시 읽기’",
        ],
        expect: ["‘다른 프로그램이 원고 파일을 사용 중’ 안내", "다시 읽기 후 정상 편집"],
      },
      {
        id: "04.conflict",
        title: "다른 곳에서 바뀐 원고 (05회 전 임시 동작)",
        steps: ["앱에서 원고를 연다", "VS Code로 같은 원고를 열어 한 줄 고치고 저장", "앱에서 글자를 입력"],
        expect: ["‘저장 보류’ + 안내, VS Code에서 쓴 내용은 그대로", "앱에서 쓴 내용은 복구 초안으로 보관 (합치기는 05회)"],
      },
    ],
  },
];
