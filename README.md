# Actuary News Hub

보험계리사 시험 준비·팀 공유용 뉴스 대시보드. 기사 **제목·링크·출처·발행시각**만 모아 보여주는 정적 사이트입니다(본문·요약·이미지는 저장하지 않음).

- 사이트: https://insurance-math.github.io/actuary-news-hub/
- 구조: GitHub Actions에서 Python 수집기 → `data/YYYY-MM.json` 커밋 → Next.js 정적 빌드 → GitHub Pages 배포. 서버·DB·비밀키 없음.

## 운영
- **자동 수집**: 매일 한국시간 05:37(20:37 UTC)에 예약 실행됩니다. GitHub 예약은 수 시간 늦거나 건너뛸 수 있어 일찍 잡았습니다. 급할 때는 GitHub → Actions → "Collect and deploy" → **Run workflow**로 수동 실행하면 됩니다. 완료되면 사이트가 자동 갱신됩니다.
- **지연 안내**: 마지막 수집이 36시간보다 오래되면 모든 페이지 상단에 "수집이 지연되고 있습니다"가 표시됩니다.
- **data 커밋 실패 시**: push가 GitHub 쪽 오류 등으로 실패하면 최대 3회 재시도(`scripts/commit-data.sh`)하고, 그래도 실패하면 사이트는 새 데이터로 배포하되 실행을 '실패'로 표시합니다(알림 메일). 저장소에는 그 수집분이 없으므로 다음 실행이 다시 수집하며 중복은 생기지 않습니다.
- 코드를 `main`에 push하면 수집 없이 빌드·배포만 실행됩니다.
- 최초 1회: 저장소 Settings → Pages → Source를 **GitHub Actions**로 설정.
- 일부 피드가 실패하거나 비어 있어도 실행은 계속되고, 기존 데이터·사이트는 유지됩니다. 실패 피드는 Actions 로그의 `WARNING ... 실패`에서 확인합니다.

## 로컬 개발 (Node 22, Python 3)
```
python3 -m venv .venv && .venv/bin/pip install -r collector/requirements.txt
.venv/bin/python collector/collect.py      # data/ 갱신 (--dry-run 가능)
npm install && npm test && npm run build   # out/ 생성
npm run dev                                # http://localhost:3000/actuary-news-hub/
```

## 데이터
- `data/YYYY-MM.json`(발행시각 기준 월별), `data/index.json`(월 목록·건수·바이트·마지막 수집 시각). 자동 삭제 없음.
- 기사 ID는 추적 파라미터를 제거한 URL의 해시. 같은 제목+출처는 합치고 구글 중간 링크보다 직접 링크를 우선합니다.
- 키워드가 맞지 않으면 카테고리는 `미분류`(7개 탭에는 안 보이고 "전체"에서만 표시).
- `config/keywords.json`: 키워드 추이 차트의 키워드(한 곳에서 관리). 수집 실행 시 `data/trends.json`(주별 집계)이 과거분까지 다시 만들어집니다. `data/status.json`은 소스별 수집 결과입니다.
- **새 뉴스**는 `collected_at`(수집시각) > 마지막 "확인 완료" 시각 기준입니다(늦게 수집된 과거 발행 기사 누락 방지). 화면 표시 시각은 발행시각.
- 북마크·읽음·확인 시각은 브라우저 localStorage에만 저장되며 기기 간 동기화되지 않습니다.
- **새 뉴스 = 마지막 확인 이후 수집 + 안 읽음.** 제목 링크를 클릭·휠클릭·Enter로 열면 읽음 처리되어 새 뉴스 목록과 건수에서 빠집니다("읽은 기사 N건 숨김 · 다시 보기"로 다시 볼 수 있고 "안 읽음으로"로 취소). 다른 탭은 필터 없이 읽은 기사를 흐리게만 표시합니다. 컨텍스트 메뉴의 "새 탭에서 열기"는 브라우저가 알려주지 않아 읽음으로 잡히지 않습니다.
- **읽음 기록 한도**: 읽은 시각과 함께 저장하고(`readAt`), 1,500건을 넘으면 '마지막 확인 완료 이전에 읽은 기록'부터 오래된 순으로 지웁니다. 확인 이후에 읽은 기록(=새 뉴스 범위)은 보호하며 5,000건을 넘을 때만 가장 오래된 것부터 지웁니다.

## 학습 중요도(★) 산식
- 산식·핵심어·상한은 `config/score.json` 한 곳: `★ = 2 + (키워드 점수 3점 이상 +1, 6점 이상 +1) + (핵심어 1개 +1, 2개 이상 +2)`, 상한 5. 이후 **금융시장 카테고리인데 제목에 보험 관련 단어가 없으면(시장 속보) ★2 상한**, 금리·대출 계열도 ★2 상한.
- 키워드 점수는 긴 키워드와 **겹치는 구간의 짧은 키워드는 세지 않는다**(예: '실손보험' 안의 '손보'). 핵심어 별칭(IFRS17/IFRS 17)은 1개로 센다.
- 바꾼 뒤에는 `python collector/collect.py --rescore`(네트워크 불필요, 점수만 갱신, 변경 요약 출력)로 저장된 기사에 반영. 키워드 충돌 점검: `python scripts/audit/keyword_collisions.py`.

## 분류 규칙 관리
- 규칙: `config/categories.json`(키워드 가중치·제외·피드 단서), 출처명: `config/source_aliases.json`, 노이즈 제목: `config/title_filters.json`.
- 규칙을 바꾼 뒤 `python collector/collect.py --reclassify` 로 저장된 기사에 반영(네트워크 불필요).
- 정확도: `python collector/eval_classify.py`(정답 샘플 `tests/classify_samples.json`). 새 샘플은 `python collector/make_samples.py --n 100`으로 뽑으면 같은 사건을 다룬 비슷한 제목이 하나로 묶인다.
- 분류 튜닝은 2주 운영 후 실제 데이터로 새 라벨 100건을 만들어 다시 검증한다. 지금 수치는 일부 샘플로 튜닝한 값이라 실제보다 높을 수 있다.

## 용량 추적
`data/index.json`의 `months[].bytes`로 월별 크기를 확인합니다. 현재 약 170KB/월 수준이며, 5년 누적 목표는 약 80MB로 가정합니다. 클라이언트는 최근 2개월만 먼저 읽고 검색 시 과거 월을 불러옵니다.

## 백업·복구
데이터는 git 저장소에 커밋되므로 이력이 곧 백업입니다. 복구: `git log -- data/` 로 시점을 찾아 `git checkout <커밋> -- data/` 후 커밋.

## 소스와 약관 (점검 필요)
| 소스 | 방식 | 비고 |
|---|---|---|
| 보험매일·보험저널·한국보험신문 | 공식 RSS | 메타데이터(제목·링크)만 저장. 약관 확인 필요 |
| 한경·매경·이데일리·머니투데이·연합·뉴시스 | 구글 뉴스 검색 RSS | 구글 중간 링크(원문으로 리다이렉트) 사용. 약관 확인 필요 |
| 금융위원회 | 공식 RSS + 구글 검색 | 공식 RSS는 2026-11-04 기준 503(점검 중) → 재확인 필요 |
| 금융감독원 | 구글 검색 | 직접 수집이 아님(화면에 표시) |

공개 저장소·사이트입니다. 개인정보·키·내부 메모를 올리지 마세요.
