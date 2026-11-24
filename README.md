# galpi

웹소설·장편 작가를 위한 로컬 글쓰기 작업실 (Windows 데스크톱, Tauri 2 + React + Rust).

- **현재 회차 앱 소스: [snapshots/06](snapshots/06)** · 회차별 폴더 규칙은 [SNAPSHOTS.md](SNAPSHOTS.md)
- 개발 계획: [docs/development/README.md](docs/development/README.md) · 변경분 [PLAN_CHANGES.md](docs/development/PLAN_CHANGES.md)
- 진행 기록: [docs/development/PROGRESS.md](docs/development/PROGRESS.md)
- PC 준비: [prepare.md](prepare.md)

| 스냅샷 | 회차 | 상태 |
|---|---|---|
| [snapshots/01](snapshots/01) | 01 · 실행 뼈대와 첫 작업 화면 | 동결 |
| [snapshots/02](snapshots/02) | 02 · 작품 폴더 열기와 안전한 저장 기반 | 동결 |
| [snapshots/03](snapshots/03) | 03 · 다음 화 생성과 외부 편집기 (+디버그 탭) | 동결 |
| [snapshots/04](snapshots/04) | 04 · 내장 집필과 한글 입력 | 동결 |
| [snapshots/05](snapshots/05) | 05 · 외부 변경·충돌·초안 복구 | 동결 |
| [snapshots/06](snapshots/06) | 06 · 회차 커밋·판 비교·복원 | 진행 |

각 스냅샷 폴더의 `README.md`에 명령과 구조가 있다. 스냅샷별 실행 파일은 `node tools/build-exe.mjs NN` → `snapshots/NN/exe/galpi-NN-debug.exe` (자세히는 SNAPSHOTS.md).
