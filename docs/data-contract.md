# 기사 데이터 계약(data/<채널>/YYYY-MM.json)

화면(세션 A)과 수집기(세션 B)가 함께 보는 기사 필드 약속이다. 기존 필드의 이름·타입·의미는 바꾸지 않는다. 새 필드는 모두 **선택 필드**로만 더하고, 필드가 없을 때의 기본값을 여기에 적는다.

## 1. 기존 필드(변경 없음)

`id`, `title`, `url`, `source`, `source_type`(`media`|`press`), `published_at`, `collected_at`, `category`, `sub_categories`, `tags`, `score`(int 2~5, 현재 ★), `feed_name`, `relevant`(없으면 true), `companies`, `orgs`, `department`(선택). 자세한 뜻은 [architecture.md 4.2](architecture.md).

## 2. 기사 품질 필드(선택, 2026-11-12 추가)

채널 설정의 플래그가 켜진 채널에만 생긴다. **지금은 두 채널 모두 꺼져 있어 data 에 아직 없다.** 화면은 필드가 없을 때 기본값으로 동작해야 한다.

| 필드 | 타입 | 의미 | 없을 때(기본값) | 생기는 조건 |
|---|---|---|---|---|
| `cluster_id` | string | 같은 사건 묶음의 식별자. 같은 값을 가진 기사끼리 한 사건이다. 값은 묶음을 처음 만든 기사의 `id` 지만, 그 기사가 나중에 바뀔 수 있으니 **기사 id 로 해석하지 말고 묶음 라벨로만** 쓴다. 한 번 2건 이상으로 묶이면 값이 바뀌지 않는다. | 혼자인 기사(묶음 없음) | `channels/<채널>/cluster.json` `enabled: true` |
| `cluster_size` | int ≥ 2 | 묶음의 기사 수(전체 월 파일 합계) | 1 | 〃 |
| `cluster_sources` | int ≥ 1 | 묶음에 속한 서로 다른 출처(`source`) 수 = 이 사건을 다룬 매체 수 | 1 | 〃 |
| `cluster_lead` | true | 묶음의 대표 기사(묶음당 정확히 1건). 대표가 아닌 구성원에는 필드가 없다. | 대표 아님. 단 `cluster_id` 가 없으면 그 기사 자체가 대표 | 〃 |
| `score_v2` | int 1~5 | 중요도 v2(★). 제목 키워드·사건 유형·공식 출처·보도 매체 수를 반영한 새 산식. 같은 묶음의 관련 기사는 같은 값(사건 점수). 1 은 관련도 낮은 기사만 받는다. | `score` 를 쓴다 | `channels/<채널>/score.json` `v2.enabled: true` |

대표 기사 규칙: 공식 발표(`source_type: press`) > 관련 있음(`relevant`) > 높은 `score_v2`(없으면 `score`) > 직접 링크(구글 뉴스 중간 링크 아님) > 먼저 발행 > `id`.

### 화면에서 쓰는 방법(권장)

- 목록에 보일 기사: `!cluster_id || cluster_lead === true`. 대표 카드에 "+{cluster_sources - 1}개 매체"(또는 `cluster_size - 1`건)를 붙이고, 펼치면 같은 `cluster_id` 기사를 보여 준다.
- 중요도: `score_v2 ?? score`. 정렬 동점은 `cluster_sources`(많을수록 위) → `published_at`.
- '새 뉴스' 건수를 사건 단위로 세려면 대표만 센다. 같은 묶음의 기사가 나중에 수집되면 그 기사만 새로 생기고 대표는 바뀔 수 있다(`cluster_lead` 이동).
- 북마크 스냅샷에 이 필드가 들어 있어도 무시해도 된다(수집할 때마다 다시 계산되는 값이다).

### 값이 바뀌는 시점

수집 실행마다(보험 하루 1회, AI 하루 3회) 최근 `lookback_days`(기본 10일) 안의 기사만 다시 판정한다. 그래서 `cluster_size`·`cluster_sources`·`cluster_lead`·`score_v2` 는 실행마다 바뀔 수 있고, `cluster_id` 는 한 번 묶인 뒤로는 바뀌지 않는다. 오래된 기사의 묶음은 그대로 남는다.

### 되돌리기

플래그를 끄고 `python collector/collect.py --channel <채널> --strip-quality` 를 실행하면 위 다섯 필드만 지워지고 월 파일은 필드 추가 전과 같은 바이트가 된다. 화면은 필드가 없으면 기본값으로 동작하므로 따로 바꿀 것이 없다.

설계·실험 근거: [article-quality-plan.md](article-quality-plan.md)
