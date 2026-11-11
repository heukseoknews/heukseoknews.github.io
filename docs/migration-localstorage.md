# 사용자 데이터 형식과 이전(localStorage)

옛 사이트(`insurance-math.github.io/actuary-news-hub/`)에서 흑석일보(`heukseoknews.github.io`)로 북마크·읽음을 옮길 때와, 흑석일보 안에서 백업·복원할 때 쓰는 형식이다. 옛 사이트에 이전 버튼을 넣을 때 이 문서를 기준으로 삼는다.

주소(origin)가 바뀌면 브라우저는 localStorage 를 새로 시작한다. 그래서 옛 사이트에서 데이터를 꺼내 새 사이트의 **내 데이터** 화면(`/insurance/settings/`)으로 넘겨야 한다. 넘기는 방법은 둘이다.

| 방법 | 옛 사이트가 하는 일 | 새 사이트가 하는 일 |
|---|---|---|
| 링크(해시) | 아래 JSON 을 인코딩해 `https://heukseoknews.github.io/insurance/settings/#import=<인코딩>` 으로 이동 | 해시를 읽고 바로 지운 뒤(주소창·방문 기록에 남지 않게) 가져오기 미리보기를 연다 |
| 파일 | 아래 JSON 을 `.json` 파일로 내려받게 한다 | 사용자가 **파일에서 가져오기(복원)** 로 고르면 같은 미리보기를 연다 |

해시(`#` 뒤)는 서버로 전송되지 않는다. 두 방법 모두 미리보기(북마크 N건, 읽음 N건, 확인 시각, 선택한 보험사 N곳, 합친 뒤 건수)를 보여 주고 사용자가 확인해야 저장한다.

## 1. 새 사이트 저장 형식

- localStorage 키: `heukseok-v<schemaVersion>:<채널>` → 지금은 `heukseok-v1:insurance`
- 값(JSON):

| 필드 | 타입 | 내용 |
|---|---|---|
| `schemaVersion` | number | `1` |
| `channel` | string | `insurance` |
| `bookmarks` | `{ [id]: Article }` | 북마크한 기사 객체 전체(`data/<채널>/YYYY-MM.json` 의 원소와 같은 모양). 가지치기 없음 |
| `readAt` | `{ [id]: ISO 시각 }` | 읽은 시각. 1,500건(SOFT)을 넘으면 마지막 확인 이전에 읽은 것부터, 보호 대상이 5,000건(HARD)을 넘으면 가장 오래된 것부터 지운다(`lib/readState.ts`) |
| `lastConfirmed` | ISO 시각 \| null | 마지막 "새 뉴스 확인 완료" 시각 |
| `companies` | string[] | 선택한 보험사(정식명). 옛 사이트에서는 별도 키였다 |

코드: 순수 로직 `lib/userState.ts`, 저장소 어댑터 `lib/storage.ts`(localStorage 구현, 나중에 원격 저장소로 바꿀 자리), 화면 `app/[channel]/settings/page.tsx`.

새 키가 아직 없으면 옛 키(`actuary-news-hub-v3`, `actuary-news-hub-companies-v1`)를 읽는다(같은 origin 에서 띄운 경우 대비). 옛 키는 지우지 않는다. 옛 키 이름은 `channels/insurance/channel.json` 의 `storage.legacy_keys` 에 있다.

## 2. 가져오기가 받는 형식

### (권장) 흑석일보 내보내기 형식

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

- 새 사이트의 **파일로 내려받기(백업)** 가 이 형식을 만든다. 옛 사이트의 이전 버튼도 이 형식으로 만드는 것을 권장한다(옛 키 값을 그대로 옮겨 담고 `companies` 에 옛 보험사 선택 키 값을 넣는다).
- `channel` 이 다르면 거절, `schemaVersion` 이 사이트가 아는 것보다 크면 거절(새로고침 안내).

### 옛 사이트 localStorage 묶음 (그대로 덤프)

```json
{ "actuary-news-hub-v3": "<localStorage 값 문자열 또는 객체>", "actuary-news-hub-companies-v1": "[\"삼성화재\"]" }
```

값은 localStorage 에서 읽은 문자열 그대로여도 된다(JSON 으로 다시 해석). 옛 값의 예전 형식 `readIds[]` 도 받는다.

### 옛 키 값 그대로

`{ "bookmarks": {…}, "lastConfirmed": …, "readAt": {…} }` (또는 `readIds`). 보험 채널에서만 받는다.

### 받을 때 정리하는 것

- 북마크: `title`·`url`·`published_at` 이 문자열이 아니면 버린다. `tags`·`companies`·`orgs` 가 없으면 빈 배열로 채운다(옛 스키마 기사도 화면·필터가 깨지지 않게).
- 읽은 시각·확인 시각: ISO 형식이 아니면 버린다.
- 파일은 10MB, 해시는 압축을 푼 크기 5MB 까지 받는다.

### 병합 규칙(합집합)

| 항목 | 규칙 |
|---|---|
| 북마크 | 합집합. 같은 id 는 지금 브라우저의 것을 유지 |
| 읽음 | 합집합. 같은 id 는 더 이른 읽은 시각 |
| 새 뉴스 확인 시각 | 더 늦은 쪽 |
| 선택한 보험사 | 지금 순서 뒤에 새 항목 |
| 그 뒤 | 읽음 한도 규칙(`pruneReads`) 적용 |

같은 데이터를 두 번 가져와도 결과는 같다.

## 3. 해시 인코딩

```
#import=<base64url( gzip( UTF-8 JSON ) )>
```

- 압축: `new CompressionStream('gzip')`(Chrome 80+, Safari 16.4+, Firefox 113+). 해제: `DecompressionStream('gzip')`.
- base64url: `+`→`-`, `/`→`_`, 끝의 `=` 제거.
- 해시 파라미터 이름은 `import` 하나뿐이다. 루트(`/#import=…`)로 들어와도 `/insurance/settings/#import=…` 로 넘긴다.
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
2. 이전 버튼: 옛 키 두 개를 읽어 2장의 권장 형식으로 만든다 → 3장 방식으로 인코딩 → 32,000자 이하면 `https://heukseoknews.github.io/insurance/settings/#import=…` 로 이동, 넘으면 `.json` 파일을 내려받게 하고 "새 사이트 → 내 데이터 → 파일에서 가져오기" 를 안내한다.
3. 옛 데이터는 지우지 않는다.
