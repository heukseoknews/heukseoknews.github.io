# 일정 캘린더(/calendar/) — 채용·시험·학회 마감·입시

다가오는 일정을 주 단위로 묶어 보여 주는 포털 화면이다. 금융·보험·AI 채널 공통이고 색은 포털 공통 색(globals.css `:root`)을 쓴다.
구독용 iCal 은 `/calendar.ics`(빌드 때 만드는 정적 파일, 수집 뒤 배포마다 갱신).

## 파일

| 파일 | 내용 | 누가 쓰나 |
|---|---|---|
| `data/calendar/auto.json` | 자동 수집 일정 | `collector/calendar_collect.py`(직접 편집하지 않음) |
| `data/calendar/status.json` | 출처별 마지막 시도·성공·실패 시각, 오류, 건수, ETag | 수집기 |
| `calendar/manual.json` | 수동 입력 일정 | 사람(아래 규칙) |
| `channels/ai/calendar.json` | ccfddl 학회 목록(화면에 보일 학회) | 사람 |
| `channels/insurance/calendar.json` | 보험개발원 보험전문인시험 일정표 주소 | 사람 |

화면(`app/calendar/page.tsx`, 로직 `lib/calendar.ts`)은 자동·수동을 합쳐 보여 준다. 같은 `id` 면 수동이 이긴다.

## 일정 한 건의 형식(자동·수동 공통)

저장하는 것은 아래 필드뿐이다. 공고 본문·첨부, 개인정보, 로컬 경로, 키는 넣지 않는다.

| 필드 | 필수 | 뜻 |
|---|---|---|
| `id` | 예 | 고유 이름. 수동은 `manual:<기관>:<시험·공고>:<단계>` |
| `title` | 예 | 제목(회차·단계 포함, 예: `제32회 보험심사역 시험`) |
| `org` | 예 | 기관(예: 보험개발원, 한국FPSB, NeurIPS) |
| `kind` | 예 | `exam`(시험) · `job`(채용) · `conf`(학회 마감·결과 발표·개최) · `admission`(입시) |
| `channel` | 예 | `finance`(은행 취업·금융 자격시험) · `insurance`(계리사·보험 시험과 보험사 채용) · `ai`(학회 마감과 대학원 입시) |
| `start` | 예 | `YYYY-MM-DD`(하루 종일, 한국 날짜) 또는 시간대가 붙은 ISO 시각(원래 시간대의 벽시계 그대로, 예: `2027-01-28T23:59:59-12:00`) |
| `end` | 아니오 | 기간의 끝(같은 형식). 접수 기간 등 |
| `tz` | 아니오 | 원래 시간대 표기(`KST`, `AoE`, `UTC-7`, `PT` …). 화면은 한국 시각으로 보이고, 한국 시각이 아니면 원래 시각을 작게 덧붙인다 |
| `link` | 예 | 공식 페이지(http/https) |
| `source` | 예 | `ccfddl` · `kidi` · `manual` |
| `checked` | 예 | 공식 페이지에서 확인한 날(`YYYY-MM-DD`, 한국 날짜). 자동은 마지막으로 받은 날(304 포함) |

## 수동 입력 규칙
- 공식 페이지를 직접 읽어 확인한 일정만 넣는다. 확인하지 못한 날짜는 넣지 않는다(비어 있어도 된다).
- 시각이 있으면 `+09:00` 처럼 시간대를 붙이고, 날짜만 있으면 `YYYY-MM-DD`.
- 형식이 틀린 항목은 화면에서 버려지고 `tests/calendar.test.ts` 가 실패한다.

## 자동 수집(`python collector/calendar_collect.py [--dry-run] [--force]`)
- **ccfddl**(github.com/ccfddl/ccf-deadlines, MIT): `channels/ai/calendar.json` 의 학회별 YAML. 초록 마감·논문 마감·결과 발표(`decision_deadline`)는 YAML 의 시간대(`AoE`·`UTC±N`·`PT`, 없으면 AoE)를 붙인 시각으로, 학회 개최는 날짜로 저장한다(여러 도시 표기 등 단순하지 않은 날짜는 넣지 않음). 올해-1년 이후 회차만. `ETag`/`If-Modified-Since` 로 바뀐 파일만 받는다(파서를 바꾸면 `PARSER_VERSION` 을 올려 다시 받게 한다).
- **보험개발원 보험전문인시험**(certi.kidi.or.kr, 정적 HTML): 표마다 위 제목(`제49회 보험전문인 제1차시험 일정표`)으로 회차를 읽고, 시행 공고·원서 접수·시험·합격자 발표만 넣는다(영어성적·경력 서류 등은 뺌). 시각이 있는 칸은 `+09:00`.
- 요청: 출처마다 하루 한 번(수집은 03:45 예약 실행에서만 돌고, 6시간 안에 다시 실행하면 건너뜀), 같은 사이트는 1.2초 간격, 로그인·접근 제한 우회 없음.
- **실패 허용**: 가져오기·파싱이 실패하거나 결과가 비정상적으로 적으면(이전엔 있었는데 0건, 이전 4건 이상에서 절반 미만) 그 출처의 이전 일정을 그대로 두고 `status.json` 에 `ok:false`, `error`, `last_error_at` 만 남긴다. ccfddl 은 학회 하나가 실패하면 그 학회만 이전 일정을 쓴다(`errors`). 화면은 출처별 마지막 성공 시각과 최근 실패를 보여 준다.
- 실행 시점: `.github/workflows/deploy.yml` 의 `calendar` 잡. 한국 03:45 예약 실행(cron `45 18 * * *`)에만, 채널 수집 잡이 끝난 뒤에 돈다(data 커밋 push 가 동시에 몰리지 않게. 다른 예약·수동 실행·push 에는 돌지 않음). 결과는 `data/calendar` 만 커밋(`scripts/commit-data.sh`)하고, 같은 실행의 빌드가 아티팩트로 받아 배포한다.

## 해외 IP(GitHub Actions)에서 열리는지 확인
첫 03:45 예약 실행 뒤:
1. Actions → 해당 'Collect and deploy' 실행 → `calendar` 잡 → `Collect calendar` 단계 로그. 출력 JSON 의 `sources.kidi.ok`·`error`(예: `HTTP 403`, 타임아웃)와 `sources.ccfddl.ok` 를 본다.
2. 저장소의 `data/calendar/status.json`(`data: 뉴스 수집 … (calendar)` 커밋): `sources.kidi.last_success_at` 이 그 실행 시각이면 열린 것, `ok:false` 와 `error` 가 있으면 막힌 것.
3. 화면 `/calendar/` 위쪽 '자동 수집' 줄의 확인 시각·최근 실패.
