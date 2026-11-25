# galpi · snapshot 08 (세계관 카드·범용 템플릿·사용자 태그)

웹소설·장편 작가를 위한 로컬 글쓰기 작업실 (Windows 데스크톱, Tauri 2 + React + Rust).

- 개발 계획: [docs/development/README.md](docs/development/README.md)
- 진행 기록: [docs/development/PROGRESS.md](docs/development/PROGRESS.md)
- PC 준비: [prepare.md](prepare.md)

## 명령

| 목적 | 명령 |
|---|---|
| 의존성 설치 | `npm install` |
| 데스크톱 앱 실행 (개발) | `npm run tauri dev` |
| 브라우저 미리보기만 | `npm run dev` → http://localhost:1420 |
| 전체 검사 | `npm run check` |
| 화면 쪽만 | `npm run check:web` (타입 검사 · ko/en 키 검사 · 단위 테스트) |
| Rust 쪽만 | `npm run check:rust` (fmt · clippy · test) |
| 설치 파일 빌드 | `npm run tauri build` |
| 디버그 탭 | 디버그 빌드에서 왼쪽 ‘세계관’ 아래 ‘디버그’ — 회차별 구현 목록·테스트 절차·도구 (`src/debug/`) |
| 테스트용 합성 작품 만들기 | `cargo run --manifest-path src-tauri/Cargo.toml --example make_sample_work -- "<빈 폴더>" [제목] [회차 수]` |

## 구조

```
src/                React 화면
  App.tsx           좌측 네 루트 + 작업 영역
  i18n/locales/     ko.json(기준), en.json
scripts/            check-i18n.ts
tests/              CLI 테스트, fixture
src-tauri/          Rust 코어 (Tauri)
  src/lib.rs        명령 등록
  src/settings.rs   기기별 설정 (%APPDATA%\dev.donism.galpi\settings.json)
```
