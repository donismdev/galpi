# 작품 폴더와 데이터 계약

경로는 첫 버전의 제안 규격이다. 앱 소스의 디렉터리 이름과 작품 데이터 디렉터리를 구분한다. 경로 예시의 e001 등은 설명용 축약 ID다. 실제 파일에는 충돌에 강한 불변 ID를 쓴다.

```text
MyNovel/
  workspace.json
  episodes/000001-e001/episode.json
  episodes/000001-e001/manuscript.md
  episodes/000001-e001/history/r001/revision.json
  episodes/000001-e001/history/r001/manuscript.md
  summaries/e001/summary.md
  summaries/e001/summary.json
  notes/next/e001.md
  lore/characters/c001/card.md
  lore/characters/c001/card.json
  lore/places/
  lore/groups/
  lore/notes/
  tags/t001.json
  timelines/collections/k001.json
  timelines/events/v001.json
  timelines/views/s001.json
  links/a001.json
  threads/f001.json
```

## 필드와 식별

| 레코드 | 영구 필드의 최소 구성 | 제약 |
|---|---|---|
| 작품 | schemaVersion, workspaceId, title, storyTracks | 균일한 상대 경로. 화면의 절대 경로를 원고나 링크에 기록하지 않는다. 트랙마다 고유 ID와 표시명이 있다. |
| 회차 | episodeId, number, title, createdAt | 같은 작품에서 number 유일·양수. 작동 중 ID 불변. 제목 변경은 다른 회차 링크나 경로를 깨지 않는다. 다음 번호는 현재 최대 번호 + 1. |
| 커밋 | revisionId, episodeId, parentRevisionId, ordinal, createdAt, message, contentHash | 초회 parent는 null. hash는 보관 원문 바이트 기준. 비교 화면의 개행 정규화와 분리한다. |
| 요약 | episodeId, reviewedRevisionId, reviewedAt | ‘미작성’, ‘작성했으나 확정본 없음’, ‘최신 확인’, ‘재확인’을 구분한다. 다 받지 않은 변경을 자동 확인 처리하지 않는다. |
| 다음에 쓸 메모 | 작성 회차 ID에 귀속된 Markdown | 다음 회차에서 직전 회차의 메모를 읽는다. 새 화를 만들어도 기존 메모를 보존한다. |
| 설정 카드 | cardId, templateId, name, aliases, tagIds, folder | 본문은 자유 편집 Markdown. 캐릭터·성격·장소·세력·세계 규칙·자유 메모 제공. 미리 채우는 질문은 처음 만들 때만 삽입. |
| 태그 | tagId, label | 태그명 변경은 ID를 보존한다. 뷰에서 숨기기, 항목에서 떼기, 전역 정리를 구별한다. |
| 타임라인 / 사건 | collectionId, name / eventId, collectionIds, title, detail, tagIds, episodeId?, episodeOrder?, storyTrackId?, storyOrder?, storyLabel?, relatedCardIds, reviewedRevisionId? | 사건은 회차 또는 작중 좌표 중 하나 이상. 작중 좌표는 트랙+정렬 숫자+표시 문구. 같은 사건을 둘 이상의 타임라인에 공유 가능. 동일 좌표는 명시 순서와 ID로 안정 정렬. |
| 상태 변화 | 사건의 선택 필드 entityId, propertyKey, value | ‘주인공 / 화염 능력 / 불씨 감지’처럼 같은 속성의 마지막 변화를 조회한다. 한 사건에 여러 변화라면 고정 순서의 목록으로 저장한다. |
| 저장한 보기 | viewId, label, collectionIds, mode, episodeRange?, storyRange?, includeTagIds, hideTagIds, groupBy | 조건만 저장한다. 구간은 양 끝 포함. 회차 범위의 첫 버전 의미는 표시 번호 범위이며 화면에 명시한다. |
| 문장 링크 / 복선 | anchorId, episodeId, originRevisionId?, quote, prefix, suffix, lastKnownRange, targetId / threadId, title, openedAnchorId, resolvedAnchorId?, status | 편집 후 인용이 여러 군데 맞으면 수동 재연결. 이력 기준 인용과 현재 원고 인용을 구별한다. |

## 쓰기와 복구

1. 작업 원고와 확정 커밋은 별도다. 작업 저장은 파일을 갱신하고 회차 커밋만 이력을 늘린다. 외부 편집 직후 커밋하면 앱은 디스크 내용을 다시 읽는다. 앱에 다른 초안이 동시에 있으면 충돌을 먼저 해결한다.
2. 앱 내부의 문서 변경은 작품/문서 단위 쓰기 소유자를 통해 직렬화한다. 편집 창은 읽은 시점의 지문과 요청 ID를 보낸다. Rust가 쓰기 직전 상태를 확인하고 불일치면 양쪽 내용을 보존한다. 같은 요청 ID로 다시 시도해도 회차·커밋이 중복 생성되지 않는다.
3. 본문 한 개는 같은 볼륨의 임시 파일에 쓴 뒤 대상 OS에서 검증한 교체 방식으로 게시한다. 여러 파일로 된 회차·커밋은 임시 디렉터리에서 완성 후 한 번에 게시하는 방법을 우선한다. 영구 객체의 가시성·실패 시 복구 규칙을 정하고 실제 중단 지점에 실패를 주입한다. 임의의 외부 편집기와 경합하는 최후의 순간까지 OS가 보장한다고 가정하지 않는다. 관측한 외부 버전과 미저장 초안의 복구 사본을 보존한다.
4. 재시작하면 미완성 기록과 남은 초안을 검사한다. 작가에게 양쪽 사본을 표시하고 선택 전까지 복구 원본을 보존한다. 잠긴 파일, 권한 부족, 용량 부족 시 ‘저장됨’을 표시하지 않는다. 처음 여는 작품은 쓰기 전에 형식과 버전을 확인하고 모르는 상위 버전은 원본을 보존하며 안내한다.
5. 인앱 쓰기는 UTF-8을 사용한다. 외부에서 연 UTF-8 BOM·CRLF 파일은 가능한 한 기존 형식을 유지한다. 읽기 실패·지원하지 않는 인코딩은 원문 바이트를 보존하고 설명한다. 검색용 정규화는 복사본에서만 한다.
6. SQLite 및 기기별 창 배치·최근 작품 경로는 앱 사용자 데이터에 분리한다. 작품 원본은 위 폴더만으로 다른 PC에서 복원된다. 작품 복사본을 원본과 섞지 않도록 캐시·세션 식별에 실제 경로도 포함한다. 감지하지 못한 외부 변경은 앱 시작·전면 복귀·수동 새로고침에서 재대조한다.
7. 한 작품을 두 프로세스에서 열면 쓰기 소유권은 하나다. 두 번째는 기존 프로세스로 전달하거나 읽기 전용으로 연다. 앱 내부 보조 창은 같은 코어를 공유한다. 경로를 벗어나는 링크·접합점은 쓰기 전에 검사하고, 사용자가 고른 기존 폴더의 무관한 파일은 보존한다.

## 02회에 정한 구현 규칙

- **앱 내부 폴더 `.galpi/`** · `tmp/`(같은 볼륨 임시 파일, 이름 끝 `.galpi-tmp`), `lock`(쓰기 소유권 OS 잠금), `init.json`(작품 만들기 진행 표식). 작가 데이터가 아니며 백업(CH5)에서 제외한다. 작품 쓰기 경로로 `.galpi/` 아래를 쓸 수 없다.
- **작품 만들기 순서** · ① `.galpi/init.json`(작품 ID 확정) → ② 고정 폴더 생성 → ③ `workspace.json` 게시(덮어쓰기 없는 hard link, 이것이 완료 시점) → ④ 표식 삭제. ①~② 사이에서 멈추면 같은 작품 ID로 이어서 완료, ③ 뒤에서 멈추면 다음 열기에서 표식만 정리한다.
- **이미 있는 폴더** · 무관한 항목이 있으면 작가가 확인해야 만든다. `workspace.json`·`.galpi`·`episodes`·`summaries`·`notes`·`lore`·`tags`·`timelines`·`links`·`threads`와 이름이 같은 항목(대소문자 무시)이 있으면 만들지 않고 목록과 새 하위 폴더를 제안한다.
- **열기 모드** · 상위 schemaVersion → 읽기 전용, 폴더에 아무것도 쓰지 않음(잠금·정리도 안 함). 다른 프로세스가 `lock` 보유 → 읽기 전용. 쓰기 권한 없음/`workspace.json` 읽기 전용 속성 → 읽기 전용. 쓰기 가능하면 `tmp/`의 우리 임시 파일만 정리한다.
- **파일 교체** · 단일 파일은 `.galpi/tmp/`에 쓰고 flush 후 Windows `MoveFileExW(REPLACE_EXISTING)`(`std::fs::rename`)로 교체. 새 파일은 hard link로 게시해 이미 있으면 실패한다.
- **쓰기 계약 (`WorkspaceSession::write_file`)** · 입력: 요청 ID, 작품 상대 경로, 바이트, 기대 상태(`없음` 또는 읽을 때의 `sha256:` 해시). 디스크가 기대와 다르면 쓰지 않고 `writeConflict`(기대·실제 해시)를 돌려준다. 무조건 덮어쓰기 경로는 없다.

### 요청 ID와 재시도 (03회 이후 회차 생성·커밋에 적용)

1. 화면은 사용자 동작 하나(예: ‘다음 화 쓰기’ 한 번, ‘새 작품 만들기’ 화면 하나)마다 `requestId`(UUID)를 하나 만들고, 같은 동작의 재시도·중복 클릭에는 같은 ID를 다시 보낸다. 다른 동작은 새 ID다.
2. Rust는 열린 세션 안에서 `(requestId, 대상)`의 첫 결과를 기억하고 같은 요청에는 다시 쓰지 않고 그 결과를 돌려준다.
3. 앱 재시작을 넘는 재시도가 필요한 생성(회차·커밋)은 결과 레코드(`episode.json`, `revision.json`)에 `requestId`를 함께 기록하고, 생성 전에 같은 `requestId`의 기존 레코드를 찾아 재사용한다. 이것으로 S03.B ‘동일 요청 재시도는 1개’를 보장한다.
4. 작품 만들기는 `.galpi/init.json`이 같은 역할을 한다(이어서 완료 시 같은 작품 ID).
5. 모든 명령 결과는 `sessionId`를 가진다. 화면은 마지막 사용자 동작 이후의 응답만 반영하고, 닫힌·바뀐 세션의 응답·이벤트는 버린다. Rust는 다른 `sessionId`의 닫기 요청을 `staleSession`으로 거절한다.

### 회차 폴더 (03회)

- 경로: `episodes/<번호 6자리>-<episodeId 앞 8자리>/episode.json` + `manuscript.md`. 폴더 이름은 만들 때 정해지고 바뀌지 않는다. 제목 변경은 `episode.json`의 `title`만 바꾼다.
- `episode.json`: `episodeId`, `number`, `title`(빈 문자열 허용), `createdAt`, `requestId`(만든 요청). 모르는 필드는 다시 쓸 때 보존한다.
- 두 파일은 `.galpi/tmp/<uuid>.galpi-tmpdir/`에서 완성한 뒤 폴더 이름 변경 한 번으로 게시한다. 남은 스테이징 폴더는 다음 열기에서 정리한다.
- 다음 번호 = 디스크에 있는 가장 큰 번호 + 1(결번은 다시 채우지 않음). 쓰기 잠금 안에서 계산한다. 읽을 수 없거나 번호·ID가 겹치는 폴더는 목록에 문제로 표시하고 건드리지 않는다.

### 원고 저장과 복구 초안 (04회)

- 내장 편집기는 LF 텍스트로 편집하고, 읽을 때의 형식(UTF-8 BOM 유무, CRLF/LF)으로 다시 저장한다. 열기만 하면 쓰지 않는다. 줄바꿈이 섞인 파일은 많은 쪽으로 맞춰 저장하며 화면에 알린다.
- 저장은 읽은 시점의 `sha256:` 해시와 함께 `write_file`로 간다. 디스크가 다르면 쓰지 않는다(`writeConflict`).
- UTF-8이 아닌 원고는 텍스트로 만들지 않고 바이트를 그대로 둔다(자동저장·초안 쓰기 없음). 다른 프로그램이 독점한 파일(Windows 공유 위반 32/33)은 `locked`.
- 저장 실패·보류된 텍스트는 `.galpi/drafts/<episodeId>.json`(`episodeId`, `baseHash`, `text`, `savedAt`)에 보관한다. 앱 내부 파일이며 원고와 섞이지 않는다. 같은 회차를 저장하는 데 성공하면 지운다.

### 외부 변경과 충돌 (05회)

- 작품을 열면 `episodes/`를 감시한다. 감시 이벤트는 힌트일 뿐이고, 0.2초 조용해진 뒤 `manuscript.md`를 다시 읽어 **내용 해시**로 판단한다. 앱이 직접 쓴 해시와 같으면 보고하지 않는다. 창이 앞으로 올 때·‘다시 읽기’ 때도 해시를 다시 대조한다. 더 새 형식(읽기 전용)의 작품은 감시하지 않는다.
- 보고에는 `sessionId`·`workspaceId`·`episodeId`가 붙고, 편집기는 자기 세션·회차의 보고만 받는다. 작품을 닫거나 바꾸면 감시를 멈춘다.
- 복구 초안 `.galpi/drafts/<episodeId>.json`에 `baseText`(기준본 텍스트)가 더해졌다(없으면 04 초안으로 읽음). 충돌이 나면 즉시 `baseHash`·`baseText`·`text`(내 초안)를 쓰고, 고르기 전까지 원고 파일은 바꾸지 않는다. 재시작 시 `baseHash`가 디스크와 다르면 충돌을 복원한다.
- 해결 저장은 충돌 창에 보여 준 디스크 판의 해시를 기대값으로 쓴다(파일이 없으면 ‘없어야 함’). 저장 후 다시 읽어 바이트가 다르면 동시 쓰기로 보고 새 충돌을 낸다. 해결 저장은 작업본만 갱신하며 커밋을 만들지 않는다(CH1).

### 회차 커밋 (06회)

- 경로: `episodes/<회차 폴더>/history/r<ordinal 3자리>/revision.json` + `manuscript.md`(커밋 순간 작업 원고의 바이트 그대로). 앱은 판을 고치거나 지우지 않는다.
- `revision.json`: `revisionId`, `episodeId`, `parentRevisionId`(첫 판 null), `ordinal`, `createdAt`, `message`, `contentHash`(보관 바이트의 sha256), `requestId`. 모르는 필드는 보존.
- 게시: `.galpi/tmp/<uuid>.galpi-tmpdir/`에서 두 파일을 완성 후 폴더 이름 변경 한 번. 중단되면 판이 없거나 완전한 판만 있다. 남은 스테이징은 다음 열기에서 정리.
- 같은 `requestId` → 그 판, 작업 원고 = 최신 판 → `noChange`(쓰지 않음), 편집기가 기대한 해시와 디스크가 다르면 거절(다시 읽고 커밋), 충돌·복구 사본(`.galpi/drafts`)이 있으면 거절. 번호는 디스크의 가장 큰 번호 + 1(손상된 판 번호도 다시 쓰지 않음). 내용이 기록된 해시와 다른 판은 목록에서 빼고 경고.
- 복원은 작업 원고만 바꾼다(일반 저장). 커밋 안 된 작업 내용이 있으면 먼저 `.galpi/backups/<episodeId>/<시각>-<id>.md`에 사본을 둔다. 다음 커밋이 새 판.
- 최신 판 조회(07회 재확인 기준): Rust `workspace::history::latest(session, episodeId)` → `RevisionInfo { revisionId, ordinal, contentHash, … }`.

### 회차 요약·다음 화 메모 (07회)

- 경로: `summaries/<episodeId>/summary.md`(요약 본문, 자유 Markdown), `summaries/<episodeId>/summary.json`(검토 기록), `notes/next/<episodeId>.md`(그 회차에서 남긴 ‘다음 화 메모’). 앱은 UTF-8·LF로 쓰고, 읽을 때의 해시를 기대값으로 저장한다(밖에서 바뀌었으면 쓰지 않음).
- `summary.json`: `schemaVersion`(1), `episodeId`, `reviewedRevisionId`, `reviewedAt`, `reviewedSummaryHash`. 모르는 필드는 보존. 파일이 없으면 ‘확인 기록 없음’.
- 검토 상태는 파일에 쓰지 않고 계산한다: `unwritten`(요약 비었음) / `noRevision`(커밋 없음) / `unreviewed` / `reviewed`(reviewedRevisionId = 최신 커밋) / `recheck`(더 새 커밋이 있음). 별도 표시: `uncommittedEdits`(작업 원고 ≠ 최신 커밋), `summaryEditedSinceReview`(요약 해시 ≠ 확인 때 해시).
- 확인은 작가의 명시적 동작(‘이대로 확인’ / ‘수정 후 확인’)으로만 기록되며, 확인하는 순간의 최신 커밋 ID여야 한다(그 사이 새 커밋이 생기면 거절). 원고 저장·외부 편집·충돌 해결 저장·요약 파일 수정은 상태를 바꾸지 않는다(CH1).
- 다음 화 메모는 N화 폴더 기준으로 저장되고, N+1화(번호가 바로 앞인 회차 기준) 상세에 읽기 전용으로 보인다. 원고·요약에 복사하지 않는다.

### 세계관 카드·사용자 태그 (08회)

- 카드 경로: `lore/<폴더>/<cardId>/card.md`(본문, 자유 Markdown) + `card.json`. `<폴더>`는 맨 위 폴더 `characters`·`places`·`groups`·`notes` 중 하나와 작가가 만든 하위 폴더(최대 8단계, 경로 규칙은 02회와 같음). 폴더 안에 `card.json`이 있으면 카드, 없으면 분류 폴더.
- `card.json`: `cardId`(UUID, 폴더 이름과 같아야 함), `templateId`(`character`·`personality`·`place`·`group`·`rule`·`note`), `name`, `aliases`(이름과 같은 것·빈 값·중복 제거), `tagIds`, `folder`, `createdAt`, `requestId`. 모르는 필드는 보존.
- 템플릿 기본 폴더: 인물·성격 → characters, 장소 → places, 세력 → groups, 세계 규칙·자유 메모 → notes. 질문 문구는 만들 때 UI 언어 리소스에서 복사해 `card.md`에 쓰며, 그 뒤로는 작가 본문이라 앱 언어를 바꿔도 바뀌지 않는다.
- 만들기: 두 파일을 `.galpi/tmp`의 스테이징 폴더에 쓰고 폴더째 한 번에 게시(없거나 완전함). 같은 `requestId`로 다시 오면 그 카드를 돌려준다.
- 이름 변경·별칭·태그: `card.json`만 읽을 때의 해시로 교체. 본문 저장: `card.md`만 해시로 교체. 밖에서 바뀌었으면 쓰지 않는다.
- 이동: 카드 폴더를 `fs::rename`으로 통째로 옮긴 뒤 `card.json.folder`를 갱신. **실제 위치가 기준**이며, 그 사이 끊기면 다음 메타데이터 저장 때 `folder`가 고쳐진다. 대상에 같은 ID 폴더가 있으면 거절.
- 이름 중복 허용. 카드 ID와 태그 ID는 이름 변경·이동에도 바뀌지 않는다(09회 사건·13회 링크는 ID로 연결).
- 태그: `tags/<tagId>.json` = `{ tagId, label }`. 이름 변경은 `label`만 바꾼다. 카드에서 제거 = 그 카드의 `tagIds`만 수정. 전역 정리 = 모든 카드에서 떼고 태그 파일 삭제(UI가 영향 카드 수를 먼저 보여주고 확인받음).
- ‘보기에서 숨기기’는 작품 파일에 쓰지 않는다(이 PC의 보기 설정, 작품 ID별 localStorage `galpi.world.hiddenTags.<workspaceId>`).

### 타임라인·사건·작중 트랙 (09회)

- 타임라인: `timelines/collections/<collectionId>.json` = `schemaVersion`(1), `collectionId`, `name`, `defaultMode`(`episode` / `story` / `both`), `createdAt`, `requestId`. 이름·기본 보기 변경은 읽을 때의 해시로 교체.
- 사건: `timelines/events/<eventId>.json` = `schemaVersion`(1), `eventId`, `collectionIds`(1개 이상, 올린 타임라인 전부), `title`, `detail`, `tagIds`(08 태그), `relatedCardIds`(08 카드 ID), `episodeId?`, `episodeOrder?`, `storyCertainty`(`confirmed` / `estimated` / `unknown`), `storyTrackId?`, `storyOrder?`, `storyLabel?`, `reviewedRevisionId?`, `reviewedAt?`, `createdAt`, `requestId`. 모르는 필드는 보존. 사건 하나는 파일 하나라 어느 타임라인에서 고쳐도 모두에 반영된다.
- 좌표 규칙: 회차 좌표(`episodeId`)와 작중 좌표 중 하나 이상. 작중 좌표는 확실성이 확정·추정일 때만 `storyTrackId` + 유한한 `storyOrder`(+ 선택 `storyLabel`)로 존재하고, 미상이면 셋 다 비워 저장한다. 둘 다 없으면 저장하지 않는다(오류 `invalidEvent`, 이유 `noCoordinate`; 그 밖에 `titleEmpty`·`noTimeline`·`storyIncomplete`·`unknownTrack`·`episodeOrder`). `episodeOrder`를 비우면 같은 회차의 최대값 + 1.
- 정렬: 회차 보기·회차순 = (회차 번호, episodeOrder, eventId). 작중 보기·작중순 = (workspace.json의 트랙 순서, storyOrder, eventId). 빈 좌표는 해당 정렬에서 맨 뒤, 화면에는 ‘미정’(미상은 ‘미상’)으로 보이고 함께 보기 필터(회차 미정만 / 작중 시점 미정만 / 둘 다)로 찾는다.
- **예전 파일 읽기 규칙(CH2)** · `storyCertainty`가 없는 사건은 `storyTrackId`와 유한한 `storyOrder`가 있으면 `confirmed`, 없으면 `unknown`으로 읽는다. 읽기만으로 파일을 바꾸지 않고, 그 사건을 앱에서 저장할 때 필드가 기록된다. 필드 추가는 schemaVersion을 올리지 않는다(작품 schemaVersion 1 유지, 모르는 필드 보존 규칙으로 하위 호환).
- 트랙: `workspace.json`의 `storyTracks`(`trackId`, `label`). 이름 바꾸기·추가는 `workspace.json`을 읽을 때의 해시로 교체하며 트랙 ID는 바뀌지 않는다. 트랙 삭제는 아직 없다.
- 검토(CH1): 회차가 있는 사건만 `reviewedRevisionId`를 가진다. 상태는 그 회차의 최신 커밋과 비교해 계산(`noEpisode` / `noRevision` / `unreviewed` / `reviewed` / `recheck`). 확인은 그 순간 최신 커밋 ID일 때만 기록. 요약(`summaries/<id>/summary.json`)과는 다른 파일이라 서로의 상태를 바꾸지 않는다. 사건의 `episodeId`가 바뀌면 이전 확인 기록을 지운다.

## 회차 간 추가 계약

- 복선의 현재 status는 표시용 파생값이다. 등장·회수·재개는 불변 transitionId, 공개 회차, 회차 내 순서, 선택적 장면 링크를 지닌 이력으로 보존한다. 7화 등장 → 32화 회수 → 40화 재개라면 25/35/41화 기준 상태는 각각 미회수/회수/미회수다.
- 인용 위치는 문서 ID와 어느 텍스트 버전을 읽었는지 함께 기록한다. UI·Rust·SQLite에서 쓰는 바이트/문자/UTF-16 단위가 다를 수 있으므로 변환 경계에서 같은 본문으로 왕복 검증한다. 원문으로 되돌아갈 수 없는 검색 정규화 오프셋을 직접 적용하지 않는다.
- `timelines/collections/`는 이름 있는 타임라인, `timelines/views/`는 타임라인을 조회하는 저장 조건이다. 작가가 사건을 숨기면 보기 조건만 바뀐다. 사건을 한 타임라인에서 떼면 소속 관계만 바뀐다. 사건 자체 삭제는 남은 소속과 링크 영향을 확인한 명시적 동작이다.
- (CH2, 09회) 사건에 작중 시점 확실성 `storyCertainty: "confirmed" | "estimated" | "unknown"`을 더한다. confirmed·estimated는 storyTrackId·storyOrder를 갖고 unknown은 좌표를 비운다. 필드가 없는 예전 사건은 유효한 작중 좌표가 있으면 confirmed, 없으면 unknown으로 읽는다. 작중 상태 계산은 confirmed만 쓴다. 트랙의 표시명(‘회귀 전’, ‘1차 회귀’)은 작품의 storyTracks에서 작가가 편집한다.
- (CH5, 18회) 작품 백업 ZIP은 작품 밖에 만든다. ZIP 안에 파일 목록·내용 해시 manifest를 함께 넣고 앱 임시 파일·기기별 캐시는 넣지 않는다. 복원은 새 빈 폴더에만 한다.
- `dictionary/words.json`은 16회부터 사용하는 작품별 사용자 사전이다. 빈 폴더는 첫 사용 시 만들 수 있다. 새 필드는 기본값을 정의해 02~15회의 작품도 그대로 연다. `workspace.json`의 schemaVersion과 개별 데이터 변환 정책을 함께 기록한다.
- `독자 기준`에 들어가는 구조화된 사실은 공개 회차로 선별한다. 자료 전체에 공개 범위를 줄 수 없는 자유 메모는 기본 제외한다. 사용자가 직접 작성한 요약 안의 의미상 스포일러를 자동 검출한다고 보장하지 않는다. AI 자료 미리보기에서 문서별 제외가 가능해야 한다.
