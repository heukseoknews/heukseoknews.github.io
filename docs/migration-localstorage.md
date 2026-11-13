# 사용자 데이터 형식과 이전(localStorage)

옛 사이트(`insurance-math.github.io/actuary-news-hub/`)에서 흑석일보(`heukseoknews.github.io`)로 북마크·읽음을 옮길 때와, 흑석일보 안에서 백업·복원할 때 쓰는 형식이다. 옛 사이트에 이전 버튼을 넣을 때 이 문서를 기준으로 삼는다.

주소(origin)가 바뀌면 브라우저는 localStorage 를 새로 시작한다. 그래서 옛 사이트에서 데이터를 꺼내 새 사이트의 **마이페이지 → 내 데이터** 화면(`/me/data/?ch=insurance`)으로 넘겨야 한다. 옛 주소 `/insurance/settings/` 는 해시를 유지한 채 이 화면으로 보낸다. 넘기는 방법은 둘이다.

| 방법 | 옛 사이트가 하는 일 | 새 사이트가 하는 일 |
|---|---|---|
| 링크(해시) | 아래 JSON 을 인코딩해 `https://heukseoknews.github.io/me/data/?ch=insurance#import=<인코딩>` 으로 이동(옛 주소 `/insurance/settings/#import=…` 도 동작) | 해시를 읽고 바로 지운 뒤(주소창·방문 기록에 남지 않게) 가져오기 미리보기를 연다 |
| 파일 | 아래 JSON 을 `.json` 파일로 내려받게 한다 | 사용자가 **파일에서 가져오기(복원)** 로 고르면 같은 미리보기를 연다 |

해시(`#` 뒤)는 서버로 전송되지 않는다. 두 방법 모두 미리보기(북마크 N건, 읽음 N건, 확인 시각, 선택한 보험사 N곳, 합친 뒤 건수)를 보여 주고 사용자가 확인해야 저장한다.

## 1. 새 사이트 저장 형식(v2)

- localStorage 키: `heukseok-v<schemaVersion>:<채널>` → 지금은 `heukseok-v2:insurance`
- 읽는 순서: `heukseok-v2:<채널>` → 없으면 `heukseok-v1:<채널>`(v1, 읽을 때 v2 로 바꿈) → 없으면 옛 사이트 키. 저장은 v2 키에만 하고, v1·옛 키는 지우지 않는다(되돌릴 때 대비).
- 값(JSON):

| 필드 | 타입 | 내용 |
|---|---|---|
| `schemaVersion` | number | `2` |
| `channel` | string | `insurance` |
| `bookmarks` | `{ [id]: 북마크 \| 삭제 표시 }` | 아래 표 |
| `folders` | `{ [id]: 묶음 }` | 내 폴더(살아 있는 것 20개까지). 북마크 하나는 폴더 하나에 |
| `tags` | `{ [id]: 묶음 }` | 내 태그(살아 있는 것 50개까지). 북마크 하나에 10개까지 |
| `readAt` | `{ [id]: ISO 시각 }` | 읽은 시각. 1,500건(SOFT)을 넘으면 마지막 확인 이전에 읽은 것부터, 보호 대상이 5,000건(HARD)을 넘으면 가장 오래된 것부터 지운다(`lib/readState.ts`) |
| `dismissed` | `{ id, at }[]` | 새 뉴스 탭에서 치운 기사와 치운 시각(`lib/dismissed.ts`). 읽음과 별개라 링크를 열어도 생기지 않는다. 60일 지났고 마지막 확인 이전에 치운 것은 읽을 때 지우고, 3,000건을 넘으면 오래된 것부터 지운다. 이 키가 없는 저장값(2026-11-13 이전)은 처음 읽을 때 '마지막 확인 이후에 읽은 기록'(그때 새 뉴스에서 숨겨져 있던 것)을 한 번 옮겨 저장한다 |
| `lastConfirmed` | ISO 시각 \| null | 마지막 "새 뉴스 확인 완료" 시각 |
| `companies` | string[] | 선택한 보험사(정식명). 옛 사이트에서는 별도 키였다 |

북마크(`lib/bookmarks.ts` 의 `Bookmark`): 기사 파일에서 사라져도 보이도록 북마크할 때 기사 스냅샷을 복사해 둔다.

| 필드 | 내용 |
|---|---|
| `id`, `channel` | 기사 id, 채널 |
| `title`, `url`, `source`, `source_type`, `category`, `sub_categories`, `keywords`, `companies`, `orgs`, `published_at`, `collected_at?`, `score?` | 기사 스냅샷. `keywords` 는 기사 파일의 분류 키워드(`tags`)다 — 사용자 태그와 이름이 겹치지 않게 바꿔 담는다. 기사 파일의 다른 필드(수집 경로·부서 등)는 담지 않는다 |
| `savedAt` | 북마크한 시각(저장순 정렬) |
| `updatedAt` | 마지막으로 바꾼 시각(병합 기준) |
| `folderId?`, `tags`, `memo` | 내 폴더 id, 내 태그 id 목록, 메모(200자) |
| `missing?` | `true` = 기사 정보를 찾지 못한 옛 북마크(id 만 보존). 기사 데이터를 불러오면 채운다 |

삭제 표시: `{ id, channel, savedAt, updatedAt, deletedAt }`. 북마크·폴더·태그를 지우면 바로 없애지 않고 이 표시를 남긴다. 다른 기기·서버와 합칠 때 지운 항목이 되살아나지 않게 하기 위해서다. 30일이 지난 삭제 표시는 읽을 때 지운다(`TOMBSTONE_DAYS`). 지운 폴더·태그를 가리키던 북마크는 그대로 두고 화면에서 '폴더 없음'·태그 없음으로 보이며, 삭제 표시를 지울 때 참조도 정리한다.

묶음(폴더·태그): `{ id, name(20자), createdAt, updatedAt, deletedAt? }`. id 는 기기 사이에서 겹치지 않게 무작위(`f_…`, `t_…`). 같은 이름은 만들 수 없다(대소문자 무시).

### v1 → v2 자동 이전

- v1 북마크는 기사 객체 전체였다 → 그대로 스냅샷으로 옮기고 폴더·태그·메모는 비운다.
- 저장 시각을 모르므로 `savedAt` 은 수집 시각(없으면 발행 시각), `updatedAt` 은 고정값 `2000-01-01T00:00:00.000Z`. 여러 기기가 따로 이전해도 같은 값이 되어 합칠 때 충돌하지 않고, 실제로 고친 기록이 항상 이긴다.
- 제목·링크가 없거나 id 만 있는 북마크(옛 형식의 id 배열 포함)는 버리지 않고 `missing: true` 로 보존한다. 화면이 기사 데이터를 불러오면 같은 id 의 기사로 채운다(`fillMissing`).

코드: 순수 로직 `lib/userState.ts`(상태·가져오기·병합)와 `lib/bookmarks.ts`(북마크·폴더·태그), 저장소 어댑터 `lib/storage.ts`(localStorage 구현, 나중에 원격 저장소로 바꿀 자리), 화면 마이페이지 `app/me/`(내 북마크 `/me/`, 내 데이터 `/me/data/`, 채널은 `?ch=`).

새 키가 아직 없으면 옛 키(`actuary-news-hub-v3`, `actuary-news-hub-companies-v1`)를 읽는다(같은 origin 에서 띄운 경우 대비). 옛 키는 지우지 않는다. 옛 키 이름은 `channels/insurance/channel.json` 의 `storage.legacy_keys` 에 있다.

## 2. 가져오기가 받는 형식

### (권장) 흑석일보 내보내기 형식

새 사이트의 **파일로 내려받기(백업)** 는 v2(위 1장 형식 + `format`·`exported_at`, 삭제 표시는 빼고)를 만든다. 가져오기는 v1·v2 를 모두 받는다. 옛 사이트의 이전 버튼은 아래 v1 형식으로 만든다.

```json
{
 "format": "heukseok-user-state",
 "schemaVersion": 1,
 "channel": "insurance",
 "exported_at": "2026-11-11T09:00:00.000Z",
 "bookmarks": { "a12d2a1696182e95": { "id": "a12d2a1696182e95", "title": "…", "url": "https://…", "source": "…", "source_type": "media", "published_at": "…", "collected_at": "…", "category": "손해보험", "tags": [], "score": 3, "feed_name": "…", "companies": [], "orgs": [] } },
 "readAt": { "a12d2a1696182e95": "2026-11-10T23:01:02.000Z" },
 "lastConfirmed": "2026-11-10T22:00:00.000Z",
 "companies": ["삼성화재"]
}
```

- 옛 사이트의 이전 버튼은 이 v1 형식으로 만드는 것을 권장한다(옛 키 값을 그대로 옮겨 담고 `companies` 에 옛 보험사 선택 키 값을 넣는다). 받으면 1장의 v1 → v2 이전을 거친다.
- `channel` 이 다르면 거절, `schemaVersion` 이 사이트가 아는 것보다 크면 거절(새로고침 안내).

### 옛 사이트 localStorage 묶음 (그대로 덤프)

```json
{ "actuary-news-hub-v3": "<localStorage 값 문자열 또는 객체>", "actuary-news-hub-companies-v1": "[\"삼성화재\"]" }
```

값은 localStorage 에서 읽은 문자열 그대로여도 된다(JSON 으로 다시 해석). 옛 값의 예전 형식 `readIds[]` 도 받는다.

### 옛 키 값 그대로

`{ "bookmarks": {…}, "lastConfirmed": …, "readAt": {…} }` (또는 `readIds`). 보험 채널에서만 받는다.

### 받을 때 정리하는 것

- 북마크: 제목·링크가 없으면 버리지 않고 '정보 없음'(`missing`)으로 보존한다. 배열 필드가 없으면 빈 배열로 채운다(옛 스키마 기사도 화면·필터가 깨지지 않게). 메모는 200자에서 자르고, id 형식이 아닌 폴더·태그는 버린다.
- 읽은 시각·확인 시각: ISO 형식이 아니면 버린다.
- 파일은 10MB, 해시는 압축을 푼 크기 5MB 까지 받는다.

### 병합 규칙

| 항목 | 규칙 |
|---|---|
| 북마크·폴더·태그 | 같은 id 는 `updatedAt` 이 늦은 쪽(삭제 표시도 같은 기준). 같으면 지금 브라우저의 것. 한쪽에만 있으면 그대로 남는다 |
| 읽음 | 합집합. 같은 id 는 더 이른 읽은 시각 |
| 새 뉴스 확인 시각 | 더 늦은 쪽 |
| 선택한 보험사 | 지금 순서 뒤에 새 항목 |
| 그 뒤 | 읽음 한도 규칙(`pruneReads`) 적용 |

- 같은 데이터를 두 번 가져와도 결과는 같다. 지운 북마크는 삭제 표시가 더 늦으므로 옛 백업을 가져와도 되살아나지 않는다(30일 안).
- 두 기기에서 같은 이름의 폴더를 따로 만들면 id 가 달라 둘 다 남는다(이름 뒤에 구분 없이 두 개로 보임 — 하나를 지우거나 이름을 바꾼다).
- 메모·폴더·태그는 북마크 단위로 함께 비교한다(늦게 고친 기기의 메모·폴더·태그 전체가 남는다).

## 3. 해시 인코딩

```
#import=<base64url( gzip( UTF-8 JSON ) )>
```

- 압축: `new CompressionStream('gzip')`(Chrome 80+, Safari 16.4+, Firefox 113+). 해제: `DecompressionStream('gzip')`.
- base64url: `+`→`-`, `/`→`_`, 끝의 `=` 제거.
- 해시 파라미터 이름은 `import` 하나뿐이다. 루트(`/#import=…`)나 옛 주소(`/insurance/settings/#import=…`)로 들어와도 `/me/data/?ch=insurance#import=…` 로 넘긴다.
- 구현·테스트: `lib/transfer.ts`, `tests/transfer.test.ts`.

옛 사이트 쪽 인코딩 예시:

```js
async function encodeForHash(obj) {
  const gz = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(gz).arrayBuffer());
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

## 4. 길이 한도와 파일 안내 기준

링크(해시)는 옛 사이트의 v1 이전용이다. 새 사이트는 링크를 만들지 않고 파일로만 백업한다. v2 백업 파일 크기(채널 1개, `tests/bookmarks.test.ts` 측정): 북마크 50·메모 20자·읽음 300건 약 64KB, 북마크 300·메모 60자·읽음 1,500건 약 358KB, 북마크 1,000·메모 200자·읽음 5,000건 약 1.6MB — 파일 한도(10MB)·해시 해제 한도(5MB) 안이다.

측정(실제 기사 id, 읽은 시각은 밀리초까지 서로 다름, 2026-11-11):

| 담은 데이터 | JSON | 해시 길이 |
|---|---:|---:|
| 읽음 100건 + 북마크 10건 | 9,564자 | 5,138자 |
| 읽음 500건 + 북마크 20건 | 32,750자 | 17,156자 |
| **읽음 1,500건** | 69,164자 | **36,690자** |
| 읽음 1,500건 + 북마크 20건 | 78,704자 | 41,648자 |
| 읽음 1,500건 + 북마크 100건 | 122,132자 | 60,034자 |
| 읽음 1,500건 + 북마크 300건 | 233,603자 | 110,035자 |

(기사 id 는 16자리 16진수라 잘 압축되지 않는다. 읽음 1건당 약 24자.)

브라우저 한도(공개 자료 기준, 버전마다 다름): Chrome 은 주소창 표시 약 32,779자(내부 URL 은 2MB까지), Safari 는 약 80,000자에서 오류, Firefox 는 주소창 표시 약 65,536자. 카카오톡 일반 채팅의 글자 수 상한은 공식 자료를 찾지 못했다. 카카오 링크 SDK 는 약 10KB 를 넘는 링크에서 오류 사례가 있다.

**기준**

- 해시 길이 **32,000자 이하**(`HASH_MAX_CHARS`)일 때만 링크로 이동한다. 옛 사이트 버튼은 같은 브라우저 안에서 새 주소로 이동하는 용도다.
- 32,000자를 넘으면 링크를 만들지 않고 **파일 방식**으로 안내한다. 읽음 1,500건을 가득 채운 사용자는 북마크가 없어도 36,690자라 파일 방식이 된다. 읽음 1,300건 안팎부터 한도에 닿는다.
- 링크를 메신저(카카오톡 등)로 보내는 방식은 안내하지 않는다. 길이 제한이 불확실하고, 링크에 개인 읽음 기록이 담기기 때문이다. 다른 기기로 옮길 때는 파일을 쓴다.

## 5. 옛 사이트 작업 체크리스트(이번 작업 범위 밖)

1. 상단 배너: "흑석일보로 이전했습니다 → https://heukseoknews.github.io/".
2. 이전 버튼: 옛 키 두 개를 읽어 2장의 권장 형식으로 만든다 → 3장 방식으로 인코딩 → 32,000자 이하면 `https://heukseoknews.github.io/me/data/?ch=insurance#import=…` 로 이동, 넘으면 `.json` 파일을 내려받게 하고 "새 사이트 → 마이페이지 → 내 데이터 → 파일에서 가져오기" 를 안내한다.
3. 옛 데이터는 지우지 않는다.
