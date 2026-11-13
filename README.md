# 흑석일보 (Heukseok Ilbo)

보험·AI·금융 뉴스 모아보기. 기사 **제목·링크·출처·발행시각**만 모아 보여 주는 정적 사이트입니다(본문·요약·이미지는 저장하지 않음). 개인이 운영하는 비공식 프로젝트이며 기사의 저작권은 각 언론사에 있습니다.

- 사이트: https://heukseoknews.github.io/ (지금은 보험 채널 하나: https://heukseoknews.github.io/insurance/)
- 구조: GitHub Actions에서 Python 수집기 → `data/<채널>/YYYY-MM.json` 커밋 → Next.js 정적 빌드 → GitHub Pages 배포. 서버·DB·비밀키 없음. 상세는 [docs/architecture.md](docs/architecture.md).
- 만든 이: Seungu Sin · 문의: [GitHub Issues](https://github.com/heukseoknews/heukseoknews.github.io/issues) (GitHub 계정 필요, 없으면 팀 채널로)

## 채널 구조
| 위치 | 내용 |
|---|---|
| `channels/<채널>/` | 채널 설정. `channel.json`(이름·부제·로케일·타임존·탭 이름·필터 라벨·예약 시각), `theme.json`(CSS 변수), 그리고 소스·분류·점수·보험사·기관 설정(`feeds.json`, `boards.json`, `categories.json`, `score.json`, `companies.json`, `orgs.json`, `keywords.json`, `source_aliases.json`, `blocked_sources.json`, `title_filters.json`, `context_exclude.json`) |
| `data/<채널>/` | 수집 결과(`YYYY-MM.json`, `index.json`, `status.json`, `trends.json`) |
| `collector/` | 공통 수집 코드. `--channel <채널>`(기본 `insurance`)로 설정·데이터 경로를 받는다 |
| `app/[channel]/` | 공통 화면. 채널마다 `/<채널>/`, `week/`, `trends/`, `status/`, `settings/`(내 데이터) 페이지가 만들어진다. `/` 는 `/insurance/` 로 이동 |
| `lib/channels.ts` | 채널 레지스트리(채널을 추가하면 여기에 한 줄 등록. 폴더·등록·워크플로 매트릭스가 맞는지 `tests/channels.test.ts` 가 확인) |

## 운영
- **자동 수집**: 매일 한국시간 07:45(전날 22:45 UTC)에 예약 실행됩니다(AI 채널은 15:45·23:45 에 한 번씩 더). GitHub 예약은 수 시간 늦거나 건너뛸 수 있어 일찍 잡았습니다. 급할 때는 `gh workflow run deploy.yml`(또는 Actions → "Collect and deploy" → Run workflow)로 수동 실행합니다. 오래된 실행의 Re-run 은 옛 코드를 다시 배포하므로 쓰지 않습니다.
- **채널별 독립 수집**: 워크플로의 수집 잡은 채널 매트릭스입니다. 한 채널이 실패해도 다른 채널의 수집과 사이트 배포는 계속되고, 실행은 '실패'로 표시됩니다(알림 메일).
- **지연 안내**: 마지막 수집이 36시간보다 오래되면 모든 페이지 상단에 "수집이 지연되고 있습니다"가 표시됩니다.
- **data 커밋 실패 시**: push가 GitHub 쪽 오류 등으로 실패하면 최대 3회 재시도(`scripts/commit-data.sh`)하고, 그래도 실패하면 사이트는 새 데이터로 배포하되 실행을 '실패'로 표시합니다. 저장소에는 그 수집분이 없으므로 다음 실행이 다시 수집하며 중복은 생기지 않습니다.
- 코드를 `main`에 push하면 수집 없이 빌드·배포만 실행됩니다.
- 배포 확인: https://heukseoknews.github.io/version.json 의 `commit` 이 main 최신 커밋과 같은지 봅니다.
- 저장소 Settings → Pages → Source 는 **GitHub Actions** 입니다.

## 로컬 개발 (Node 22, Python 3.12)
```
python3 -m venv .venv && .venv/bin/pip install -r collector/requirements.txt
.venv/bin/python collector/collect.py --channel insurance   # data/insurance/ 갱신 (--dry-run 가능)
npm install && npm test && npm run build                     # out/ 생성
npm run dev                                                  # http://localhost:3000/insurance/
```
- 공유 이미지(public/og.png·favicon·apple-touch-icon)는 `scripts/make-share-images.mjs` 로 손으로 다시 만들고 결과를 커밋한다(빌드 때 실행하지 않음, Playwright 필요).

## 데이터
- `data/<채널>/YYYY-MM.json`(발행시각 기준 월별), `index.json`(월 목록·건수·바이트·마지막 수집 시각), `status.json`(소스별 수집 결과), `trends.json`(키워드 주별 집계). 자동 삭제 없음.
- 기사 ID는 추적 파라미터를 제거한 URL의 해시. 같은 제목+출처는 합치고 구글 중간 링크보다 직접 링크를 우선합니다.
- 키워드가 맞지 않으면 카테고리는 `미분류`(카테고리 버튼에는 없고 "전체"에서만 표시).
- **새 뉴스 = 마지막 확인 이후 수집 + 안 읽음.** 제목 링크를 클릭·휠클릭·Enter로 열면 읽음 처리됩니다. 읽음 기록은 1,500건을 넘으면 '마지막 확인 이전에 읽은 기록'부터 지우고, 확인 이후 기록은 5,000건까지 보호합니다.

## 내 데이터(북마크·읽음)
- 북마크·읽음·새 뉴스 확인 시각·선택한 보험사는 이 브라우저의 localStorage(`heukseok-v1:<채널>`)에만 저장되며 기기 간 동기화되지 않습니다. 저장은 어댑터(`lib/storage.ts`) 뒤에 있어 나중에 로그인·원격 저장소를 붙일 수 있습니다.
- 헤더의 **내 데이터**(`/insurance/settings/`)에서 JSON 파일로 내려받기(백업)·가져오기(복원)를 할 수 있습니다. 가져오기는 미리보기 후 기존 데이터와 합칩니다.
- 옛 사이트의 데이터 형식·이전 링크(`#import=…`) 규격: [docs/migration-localstorage.md](docs/migration-localstorage.md).

## 학습 중요도(★) 산식
- 산식·핵심어·상한은 `channels/insurance/score.json` 한 곳: `★ = 2 + (키워드 점수 3점 이상 +1, 6점 이상 +1) + (핵심어 1개 +1, 2개 이상 +2)`, 상한 5. 금융시장 카테고리인데 제목에 보험 관련 단어가 없으면(시장 속보) ★2 상한, 금리·대출 계열도 ★2 상한.
- 바꾼 뒤에는 `python collector/collect.py --rescore`(네트워크 불필요, 점수만 갱신)로 저장된 기사에 반영. 키워드 충돌 점검: `python scripts/audit/keyword_collisions.py`.

## 분류 규칙 관리
- 규칙: `channels/insurance/categories.json`, 출처명: `source_aliases.json`, 노이즈 제목: `title_filters.json`.
- 규칙을 바꾼 뒤 `python collector/collect.py --reclassify` 로 저장된 기사에 반영(네트워크 불필요).
- 정확도: `python collector/eval_classify.py`(정답 샘플 `tests/classify_samples.json`). 새 샘플은 `python collector/make_samples.py --n 100`.

## 백업·복구
데이터는 git 저장소에 커밋되므로 이력이 곧 백업입니다. 복구: `git log -- data/` 로 시점을 찾아 `git checkout <커밋> -- data/<채널>/` 후 커밋.

## 소스와 약관 (점검 필요)
| 소스 | 방식 | 비고 |
|---|---|---|
| 보험매일·보험저널·한국보험신문 | 공식 RSS | 메타데이터(제목·링크)만 저장. 약관 확인 필요 |
| 한경·매경·이데일리·머니투데이·연합·뉴시스 | 구글 뉴스 검색 RSS | 구글 중간 링크(원문으로 리다이렉트) 사용. 약관 확인 필요 |
| 금융위원회 | 공식 RSS + 게시판 + 구글 검색 | 공식 RSS는 2026-11-04 이후 503(점검 중) → 게시판으로 대체 수집 |
| 금융감독원 | 게시판 + 구글 검색 | |

공개 저장소·사이트입니다. 개인정보·키·내부 메모를 올리지 마세요.
