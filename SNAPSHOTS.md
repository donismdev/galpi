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
  .cargo/config.toml      ← Rust 빌드 캐시를 저장소 루트 target/ 하나로 공유
  target/                 ← (git 제외) 공유 빌드 캐시
```

## 규칙

1. **NN회 시작** · 직전 폴더 `snapshots/(NN-1)`을 `snapshots/NN`으로 **그대로 복사**한 뒤, 그 안에서만 작업한다.
2. **이전 폴더는 동결** · 끝난 회차의 `snapshots/` 폴더는 고치지 않는다. 이전 회차 코드의 버그를 찾으면 현재 회차 폴더에서 고치고 PROGRESS.md에 기록한다.
3. **출발점은 폴더 내용** · AI는 대화 기억이 아니라 아래를 읽고 시작한다.
   - 이 파일, `docs/development/README.md`·공통 문서·해당 회차 카드
   - `docs/development/PROGRESS.md`의 직전 회차 기록
   - `snapshots/(NN-1)`의 실제 코드
4. **회차 종료** · `snapshots/NN`에서 `npm run check` 통과 → PROGRESS.md에 기록(경로는 `snapshots/NN/` 기준) → `NN회: …` 메시지로 커밋.
5. **망친 회차** · `snapshots/NN`을 지우고 직전 폴더를 다시 복사해 처음부터 시작해도 된다. 이전 회차는 영향이 없다.
6. **공유하는 것** · `docs/`, `prepare.md`, `.cargo/config.toml`, `target/`(빌드 캐시)만 공유한다. `node_modules/`는 폴더마다 따로 설치한다(git 제외).

## 명령 (PowerShell, 저장소 루트에서)

새 회차 폴더 만들기 (예: 02 → 03). `node_modules`는 복사하지 않는다.

```powershell
robocopy snapshots\02 snapshots\03 /E /XD node_modules /NFL /NDL /NJH /NJS
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

## 주의

- 여러 스냅샷 앱을 **동시에** 띄우지 않는다. 개발 서버 포트(1420)와 앱 식별자(`dev.donism.galpi`)가 같아서 기기별 설정 파일 `%APPDATA%\dev.donism.galpi\settings.json`도 공유된다.
- 공유 `target/`을 쓰므로 다른 스냅샷을 실행하면 `galpi` 크레이트만 다시 컴파일된다(의존성은 재사용).
- 회차가 진행되며 작품 폴더 형식(`schemaVersion`)이 바뀌면, 옛 스냅샷 앱으로 새 형식의 작품을 열지 않는다. 테스트용 작품 폴더는 회차마다 새로 만든다.
