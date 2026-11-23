# 0회차 · 개발 시작 전 준비 (prepare.md)

> **프로젝트명: galpi** · 저장소 `C:\Users\azuli\Documents\Other Projects\galpi` (GitHub `donismdev/galpi`)
>
> **0회차 완료 (2026-11-23 확인)** · rustc/cargo 1.100.0, `stable-x86_64-pc-windows-msvc` 기본, rustfmt·clippy 설치, Tauri 예제 앱(`tauri-smoke.exe`) 디버그 빌드 성공. `.gitignore` = GitHub Rust 템플릿 + `node_modules/`, `dist/`, `*.tsbuildinfo`. `Cargo.lock`·`package-lock.json`은 커밋 대상.
>
> 아래는 처음 준비할 때의 기록이다.

01회(`docs/development/sessions/01-foundation.md`)를 AI에게 맡기기 **전에** 이 PC에 직접 깔아 둘 것들이다.
코드·라이브러리(React, CodeMirror, SQLite 등)는 01회 이후 AI가 프로젝트 안에 설치하므로 여기서는 **바깥(PC 전체)** 에 필요한 것만 다룬다.

---

## 1. 이 프로젝트가 쓰는 플랫폼 한눈에 보기

| 이름 | 한 줄 설명 | 이 앱에서 하는 일 |
|---|---|---|
| **Tauri 2** | 웹 화면(HTML/JS)을 Windows 데스크톱 앱으로 감싸는 틀. Electron과 비슷하지만 훨씬 가볍다. | 앱 창, 여러 창, 설치 파일(.exe/.msi) 만들기 |
| **Rust** | 빠르고 안전한 시스템 언어. Tauri의 "뒤쪽(백엔드)"이 Rust로 돌아간다. | 작품 폴더 읽기/쓰기, 회차 커밋, 파일 변경 감지, 검색 색인 |
| **Node.js + npm** | JavaScript 실행기와 패키지 관리자. | 화면 쪽 도구(Vite, TypeScript, React) 설치·실행 |
| **React + TypeScript + Vite** | 화면을 만드는 라이브러리 / 타입 있는 JS / 개발 서버. | 왼쪽 네 루트, 편집기, 타임라인 화면 |
| **WebView2** | Windows에 내장된 Edge 기반 브라우저 엔진. Tauri 앱의 화면이 여기서 그려진다. | 앱 화면 표시, 한글 IME 입력 |
| **MSVC (Visual Studio C++ 빌드 도구)** | Windows에서 Rust 코드를 실행 파일로 묶는 링커. | Rust 컴파일에 필수 |
| **SQLite FTS5** | 파일 하나짜리 데이터베이스 + 전문 검색. | 11회 검색 색인. **Rust 라이브러리에 포함되어 별도 설치 불필요** |

```
[ React 화면 (WebView2) ]  ←— 명령/이벤트 —→  [ Rust 코어 ]  —→  작품 폴더(.md / .json)
         ↑ Node/Vite가 개발 중 띄움                 ↑ MSVC로 컴파일          └→ SQLite 검색 캐시
```

---

## 2. 현재 이 PC 상태 (2026-11-23 확인)

| 항목 | 상태 | 할 일 |
|---|---|---|
| Node.js | ✅ v24.12.0 | 없음 |
| npm | ✅ 설치됨 | 없음 (pnpm 등 다른 관리자는 쓰지 않는다) |
| Git | ✅ 2.52.0 | 없음 (소스 버전 관리용. 작가용 앱은 Git을 요구하지 않는다) |
| VS Code | ✅ 설치됨, `code` 명령 사용 가능 | 확장 몇 개 추가 (5번) |
| WebView2 런타임 | ✅ 157.x | 없음 |
| Visual Studio 2022 Community + C++ 도구 | ✅ 감지됨 | Windows SDK 포함 여부만 확인 (3번) |
| **Rust (rustup / cargo)** | ❌ **없음** | **설치 필요 (4번)** |

> 실제로 새로 설치할 것은 **Rust 하나**, 확인할 것은 **Visual Studio 구성요소**, 편의용으로 **VS Code 확장**이다.

---

## 3. Visual Studio C++ 구성요소 확인

Rust가 Windows용 실행 파일을 만들 때 이게 필요하다.

1. 시작 메뉴 → **Visual Studio Installer** 실행
2. *Visual Studio Community 2022* 옆 **수정(Modify)** 클릭
3. **워크로드** 탭에서 **"C++를 사용한 데스크톱 개발 (Desktop development with C++)"** 에 체크가 되어 있는지 확인
4. 오른쪽 "설치 세부 정보"에 아래 두 개가 체크되어 있는지 확인
   - **MSVC v143 - VS 2022 C++ x64/x86 빌드 도구** (최신)
   - **Windows 11 SDK** (아무 최신 버전, 10.0.2xxxx)
5. 빠진 게 있으면 체크하고 **수정** → 끝나면 PC 재부팅 권장

---

## 4. Rust 설치 (필수)

PowerShell을 열고 실행한다.

```powershell
winget install --id Rustlang.Rustup -e
```

설치가 끝나면 **PowerShell 창을 닫고 새로 연 다음** 기본 도구 체인을 맞춘다.

```powershell
rustup default stable-msvc
```

```powershell
rustup component add rustfmt clippy
```

- `stable-msvc`: Windows + MSVC 조합의 안정판. Tauri가 요구하는 조합이다.
- `rustfmt`(코드 정리), `clippy`(코드 검사)는 01회 "Rust 검사·테스트"에서 쓴다.

> winget이 막혀 있으면 https://rustup.rs 에서 `rustup-init.exe`를 받아 실행하고, 물어보면 기본값(1)으로 진행한다.

---

## 5. VS Code 확장 (권장)

이 앱은 VS Code를 "외부 편집기" 기본값으로 쓰고, 개발도 VS Code에서 하면 편하다.

```powershell
code --install-extension rust-lang.rust-analyzer
```

```powershell
code --install-extension tauri-apps.tauri-vscode
```

```powershell
code --install-extension dbaeumer.vscode-eslint
```

| 확장 | 이유 |
|---|---|
| rust-analyzer | Rust 코드 자동완성·오류 표시 |
| Tauri | `tauri.conf.json` 설정 자동완성 |
| ESLint | TypeScript/React 코드 검사 |

---

## 6. 설치 확인 (전부 숫자가 나오면 통과)

새 PowerShell 창에서 한 줄씩 실행한다.

```powershell
node -v
```

```powershell
npm -v
```

```powershell
rustc -V
```

```powershell
cargo -V
```

```powershell
rustup show
```

`rustup show` 결과에 `stable-x86_64-pc-windows-msvc (default)`가 보이면 정상이다.

### (선택) 진짜로 빌드되는지 미리 시험

빈 임시 폴더에서 Tauri 예제 앱을 한 번 띄워 보면 "PC 준비"가 끝났는지 확실히 알 수 있다. 프로젝트 폴더가 아니라 **임시 위치**에서 하고, 확인 후 지워도 된다.

```powershell
cd $env:TEMP; npm create tauri-app@latest tauri-smoke -- --template react-ts --manager npm --yes
```

```powershell
cd $env:TEMP\tauri-smoke; npm install; npm run tauri dev
```

- 처음엔 Rust 라이브러리를 내려받고 컴파일하느라 **3~10분** 걸린다. 정상이다.
- 작은 앱 창이 뜨면 성공. 창에 한글을 입력해 보고(IME 확인) 닫는다.
- 확인이 끝나면 `tauri-smoke` 폴더는 삭제해도 된다.

---

## 7. 지금 설치하지 않아도 되는 것 (AI가 해당 회차에서 처리)

| 항목 | 언제 | 비고 |
|---|---|---|
| React, Vite, TypeScript, CodeMirror 6 | 01·04회 | 프로젝트 `package.json`에 들어감 (`npm install`) |
| Tauri CLI | 01회 | 프로젝트 devDependency(`@tauri-apps/cli`)로 설치, 전역 설치 불필요 |
| SQLite / FTS5 | 11회 | Rust 라이브러리(`rusqlite` bundled)에 포함 |
| Hunspell 한국어·영어 사전 | 16회 | 라이선스 검토 후 프로젝트에 포함 |
| 설치 파일 도구 (NSIS / WiX) | 18회 | `tauri build` 시 자동으로 내려받음 |
| 코드 서명 인증서 | 공개 배포 시 | 1.0 개인 사용엔 불필요. 없으면 설치 시 SmartScreen 경고가 뜰 수 있음 |

---

## 8. 작가(본인)가 직접 준비해 두면 좋은 것

- **테스트용 빈 폴더**: 예) `C:\Users\<본인>\Documents\WriterHelper-test-works\` — 앱이 작품 폴더를 만들 연습장. **실제 원고 폴더는 절대 테스트에 쓰지 않는다.**
- **한글 입력기(Microsoft 한국어 IME)** 활성화 확인 — 04회 한글 조합 테스트에 필요.
- (14회) 가능하면 **보조 모니터** — 다중 창·모니터 분리 시험용. 없으면 "미검증"으로 기록된다.
- (18회) **새 Windows 사용자 계정**을 하나 만들 수 있는 권한 — 깨끗한 환경 설치 시험용.

---

## 9. 준비 끝나면

이 저장소를 VS Code / 코딩 AI에서 열고 `docs/development/README.md`의 **첫 지시**를 그대로 붙여 넣는다.

```text
이 저장소의 docs/development/sessions/01-foundation.md를 열고 이번 회차 작업 지시로 실행해줘.
프로젝트 규칙과 기초 설계를 확인하고, 구현·검증·PROGRESS.md 인계 기록까지 마쳐줘.
다음 회차는 시작하지 말고, 이번에 내가 직접 켜서 확인할 동작과 실제 테스트 결과를 알려줘.
```

> 참고: Git 저장소(`main`, origin = GitHub `donismdev/galpi`) 설정 완료. 회차가 끝날 때마다 커밋해 두면 되돌리기 쉽다. 01회 문서의 앱 작업명 ‘글쓰기 작업실’은 제품명 **galpi**로 읽는다.

### 문제가 생기면

| 증상 | 원인 / 해결 |
|---|---|
| `rustc`를 찾을 수 없음 | PowerShell 창을 새로 열기. 그래도 안 되면 PC 재부팅 |
| `link.exe not found` / `LNK1181` | 3번 Visual Studio C++ 워크로드·Windows SDK 누락 |
| `npm run tauri dev`가 오래 걸림 | 첫 빌드는 정상. 두 번째부터 수십 초 |
| 백신이 빌드를 막음 | 프로젝트 폴더의 `src-tauri\target`을 실시간 검사 예외로 추가 |
| 공식 안내 | https://v2.tauri.app/start/prerequisites/ (Windows 항목) |
