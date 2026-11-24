# 회차별 스냅샷 규칙

앱 소스는 개발 회차마다 **별도 폴더**에 통째로 둔다. 긴 작업 중 AI가 앞선 내용을 잘못 기억(환각)해 코드가 엉키는 것을 막고, 매 회차를 **직전 회차 폴더의 실제 내용**에서 출발하게 하기 위함이다.

```text
galpi/
  SNAPSHOTS.md            ← 이 규칙
  prepare.md              ← PC 준비 (0회차)
  docs/development/       ← 계획·카드·PROGRESS (모든 회차가 공유, 스냅샷하지 않음)
  snapshots/
    01/                   ← 01회 종료 시점의 앱 전체 (동결)
    02/                   ← 02회 작업 폴더 → 끝나면 동결
    NN/                   ← 현재 회차
      exe/                ← (git 제외) 이 스냅샷의 실행 파일 galpi-NN-debug.exe / galpi-NN.exe
  tools/build-exe.mjs     ← 스냅샷별 exe 만들기
  .cargo/config.toml      ← Rust 빌드 캐시를 저장소 루트 target/ 하나로 공유
  target/                 ← (git 제외) 공유 빌드 캐시. 마지막 빌드의 exe만 남으므로 스냅샷 exe는 exe/로 복사한다
```

## 규칙

1. **NN회 시작** · 직전 폴더 `snapshots/(NN-1)`을 `snapshots/NN`으로 **그대로 복사**한 뒤, 그 안에서만 작업한다.
2. **이전 폴더는 동결** · 끝난 회차의 `snapshots/` 폴더는 고치지 않는다. 이전 회차 코드의 버그를 찾으면 현재 회차 폴더에서 고치고 PROGRESS.md에 기록한다.
3. **출발점은 폴더 내용** · AI는 대화 기억이 아니라 아래를 읽고 시작한다.
   - 이 파일, `docs/development/README.md`·공통 문서·해당 회차 카드
   - `docs/development/PROGRESS.md`의 직전 회차 기록
   - `snapshots/(NN-1)`의 실제 코드
4. **회차 종료** · `snapshots/NN`에서 앱의 **디버그 탭 내용**(`src/debug/features.ts`)에 이번 회차의 구현 목록·자동 테스트·직접 확인 절차를 추가 → `npm run check` 통과 → PROGRESS.md에 기록(경로는 `snapshots/NN/` 기준) → `NN회: …` 메시지로 커밋.
5. **망친 회차** · `snapshots/NN`을 지우고 직전 폴더를 다시 복사해 처음부터 시작해도 된다. 이전 회차는 영향이 없다.
6. **공유하는 것** · `docs/`, `prepare.md`, `tools/`, `.cargo/config.toml`, `target/`(빌드 캐시)만 공유한다. `node_modules/`와 `exe/`는 폴더마다 따로 있다(git 제외).
7. **스냅샷별 실행 파일** · 각 스냅샷의 exe는 `node tools/build-exe.mjs NN`으로 `snapshots/NN/exe/`에 만든다. 동결된 스냅샷도 소스를 바꾸지 않고 exe만 다시 만들 수 있다.

## 명령 (PowerShell, 저장소 루트에서)

새 회차 폴더 만들기 (예: 02 → 03). `node_modules`, `exe`, `target`, `dist`는 복사하지 않는다.

```powershell
robocopy snapshots\02 snapshots\03 /E /XD node_modules exe target dist /NFL /NDL /NJH /NJS
```

```powershell
cd snapshots\03; npm install
```

실행·검사 (현재 회차 폴더 안에서)

```powershell
npm run tauri dev
```

```powershell
npm run check
```

스냅샷별 실행 파일 (저장소 루트에서, NN = 01, 02, 03 …)

```powershell
node tools/build-exe.mjs 03
```

```powershell
node tools/build-exe.mjs 03 release
```

- `debug`(기본): `snapshots\03\exe\galpi-03-debug.exe` — 화면이 exe 안에 들어 있어 개발 서버 없이 실행되고 디버그 탭이 보인다.
- `release`: `snapshots\03\exe\galpi-03.exe` — 최적화 빌드, 디버그 탭 없음. 처음엔 의존성 최적화 컴파일 때문에 몇 분 더 걸린다.
- 설치 파일(.msi/.exe 설치기)은 18회 범위라 여기서는 만들지 않는다(`--no-bundle`).

## 디버그 탭 (03회부터)

- 디버그 빌드(`npm run tauri dev`, `npm run tauri build -- --debug`)에서만 왼쪽 루트 목록의 **세계관 아래**에 **디버그** 탭이 보인다. 릴리스 빌드에서는 숨는다(Rust `debug_assertions` 기준).
- 내용: 빌드 정보 · 현재 상태(열린 작품, 기기 설정 JSON) · 개발 도구(합성 작품 만들기 등) · 회차별 **구현된 것 / 자동 테스트 / 직접 확인 절차**(체크 상태는 그 PC에만 저장).
- 새 개발 도구는 이 탭에 추가한다. Rust 쪽 개발 전용 명령은 `cfg!(debug_assertions)`가 아니면 거절하게 만든다.

## 주의

- 여러 스냅샷 앱을 **동시에** 띄우지 않는다. 개발 서버 포트(1420)와 앱 식별자(`dev.donism.galpi`)가 같아서 기기별 설정 파일 `%APPDATA%\dev.donism.galpi\settings.json`도 공유된다. 스냅샷 exe도 같은 설정 파일을 쓴다.
- 공유 `target/`을 쓰므로 다른 스냅샷을 실행하면 `galpi` 크레이트만 다시 컴파일된다(의존성은 재사용).
- 회차가 진행되며 작품 폴더 형식(`schemaVersion`)이 바뀌면, 옛 스냅샷 앱으로 새 형식의 작품을 열지 않는다. 테스트용 작품 폴더는 회차마다 새로 만든다.
