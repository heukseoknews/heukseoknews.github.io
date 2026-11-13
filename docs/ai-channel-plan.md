> 상태: 완료·보관(2026-11-11 조사·계획 기준). AI 채널은 운영 중이고 현재 설정은 `channels/ai/`, 구조는 [architecture.md](architecture.md)를 본다.

# AI 채널(/ai/) 사전 조사와 구현 계획

> 작성 2026-11-11. 조사 전용 문서다(collector·app·channels 코드 변경 없음).
> 기준: main `832dcee`. 현재 구조는 docs/architecture.md(특히 6장 (c), 8.7)를 따른다.
> 소스 확인 방법: 조사 스크립트로 후보 URL을 직접 열어 응답 코드·피드 형식·항목 수·발행 시각 범위를 기록하고, 각 호스트의 robots.txt를 같은 UA로 해석했다. 요청 간 1.3초, 로그인·우회 없음. 아래 숫자는 2026-11-11 09:30~10:00 UTC 한 번의 측정값이다.

## 0. 요약

- **소스**: 공식 블로그는 대부분 RSS가 있다. OpenAI·Google DeepMind·Google Research·Google AI(Keyword)·Mistral·Hugging Face·NVIDIA·Microsoft Research·AWS·Apple ML에서 확인했다. **Anthropic·Meta AI·World Labs는 RSS가 없다** → Google News `site:` 검색 쿼리로 시작하고, 나중에 사이트맵 diff 방식을 검토한다. 영어 언론 6곳, 한국 언론 3~4곳의 AI 피드가 쓸 만하다. GitHub releases Atom은 모두 열리지만 llama.cpp·pytorch는 빌드 태그 때문에 시끄러워 제목 필터가 필요하다.
- **엔진**: 지금 매처로는 영어를 제대로 처리하지 못한다(복수형 실패, `gpt-4.5` 경계 없음, 관련도 판정이 `said` 안의 `ai`에 걸림). 그 외에도 직접 RSS 목록 하드코딩, `PRESS_RE`(보험 단어 필수), 구글 `hl=ko` 고정, 피드별 시간대 처리를 채널 설정으로 옮겨야 AI 채널을 만들 수 있다. **보험 채널 동작은 동등성 스크립트로 같음을 유지**하면서 바꾼다.
- **도메인 5개**: 카테고리와 직교하는 "분야"이므로 **필터(다중 선택)로 쓰기를 추천**한다. 첫 단계는 기존 `orgs` 필터 칸을 '분야'로 재사용하면 코드 변경 없이 된다.
- **첫 단계**: 엔진 일반화(보험 동등성 유지) → 소스 8개·카테고리 4개로 /ai/ 공개.

---

## 1. 소스 후보

표의 열: 응답(HTTP), 형식, 항목(피드가 준 항목 수), 하루 평균(피드 안 항목의 발행 시각 범위로 계산), 덮는 기간(항목 수 ÷ 하루 평균 — **하루 1회 수집이면 이 값이 24시간 이상이어야 누락이 없다**), robots(우리 UA로 해당 URL 허용 여부/robots.txt 응답).

### 1.1 공식 블로그

| 소스 | URL | 응답 | 형식 | 항목 | 하루 평균 | 덮는 기간 | robots | 판단 |
|---|---|---|---|---:|---:|---|---|---|
| OpenAI News | `https://openai.com/news/rss.xml` | 200 | RSS 2.0 | 1,380(2015~ 전체) | 0.3* | 충분 | 허용 | **추천**. 전체 이력을 주므로 `FEED_CAP`(100)으로 자름. 제목에 고객 사례가 많아 관련도·점수 조정 필요 |
| Google DeepMind | `https://deepmind.google/blog/rss.xml` | 200 | RSS 2.0 | 100 | 0.3 | 충분 | 허용 | **추천**(Genie·로보틱스 포함, 월드모델 핵심 소스) |
| Google Research | `https://research.google/blog/rss/` | 200 | RSS 2.0 | 100 | 0.3 | 충분 | 허용 | 2단계 |
| Google AI (Keyword) | `https://blog.google/technology/ai/rss/` | 200 | RSS 2.0 | 20 | 0.4 | 충분 | 허용 | 2단계(제품 발표 위주, AI 외 글 섞임) |
| Google for Developers | `https://developers.googleblog.com/feeds/posts/default` | 200 | RSS | 20 | - | - | 허용 | 선택 |
| Meta AI | `https://ai.meta.com/blog/` | 200(HTML) / `rss/` 404 / `sitemap.xml` 404 | - | - | - | - | 허용 | **RSS 없음** → Google News `site:ai.meta.com`(최근 30일 12건) |
| Mistral | `https://mistral.ai/rss.xml` | 200 | RSS 2.0 | 94 | 0.1 | 충분 | 허용 | **추천**(뉴스 페이지에는 링크가 없지만 rss.xml 존재) |
| Hugging Face | `https://huggingface.co/blog/feed.xml` | 200 | RSS 2.0 | 903(전체) | 0.4* | 충분 | 허용 | **추천**(오픈소스·도구) |
| NVIDIA Blog | `https://blogs.nvidia.com/feed/` | 200 | RSS 2.0 | 18 | 1.4 | 약 13일 | 허용 | **추천**(Physical AI·Cosmos·Isaac 발표 포함) |
| NVIDIA Developer | `https://developer.nvidia.com/blog/feed/` | 200 | Atom | 100 | 1.5 | 충분 | 허용 | 2단계(기술 글 위주) |
| NVIDIA Dev — Cosmos 태그 | `https://developer.nvidia.com/blog/tag/cosmos/feed/` | 200 | Atom | 36 | 0.1 | 충분 | 허용 | 월드모델 단계에서 추가 |
| Microsoft AI 블로그 | `https://blogs.microsoft.com/ai/feed/` | **410** | - | - | - | - | 허용 | 폐지됨 |
| Microsoft Source AI | `https://news.microsoft.com/source/topics/ai/feed/` | 200 | RSS 2.0 | 10 | 0.1 | 충분 | 허용 | 선택(최근 글 10-21) |
| Microsoft Research | `https://www.microsoft.com/en-us/research/feed/` | 200 | RSS 2.0 | 10 | 0.3 | 약 30일 | 허용 | 2단계 |
| Anthropic | `https://www.anthropic.com/news` | 200(HTML) / `rss.xml` 404 | - | - | - | - | 허용 | **RSS 없음** → 아래 1.6 |
| AWS ML 블로그 | `https://aws.amazon.com/blogs/machine-learning/feed/` | 200 | RSS 2.0 | 20 | 4.6 | 약 4일 | 허용 | 제외 권고(고객 사례·튜토리얼 위주, 양이 많음) |
| Apple ML Research | `https://machinelearning.apple.com/rss.xml` | 200 | RSS 2.0 | 10 | 0.4 | 약 25일 | 허용 | 선택(연구) |
| BAIR | `https://bair.berkeley.edu/blog/feed.xml` | 200 | RSS 2.0 | 10 | 0.0 | 충분 | robots 404(허용) | 선택(드묾) |

\* 전체 이력을 주는 피드라 하루 평균이 실제 최근 빈도보다 낮게 나온다. 최근 빈도는 주 2~5건 수준이다.

### 1.2 영어 언론

| 소스 | URL | 응답 | 형식 | 항목 | 하루 평균 | 덮는 기간 | robots | 판단 |
|---|---|---|---|---:|---:|---|---|---|
| TechCrunch AI | `https://techcrunch.com/category/artificial-intelligence/feed/` | 200 | RSS 2.0 | 20 | 15.0 | **약 32시간** | 허용 | **추천**(업계·투자) |
| The Verge AI | `https://www.theverge.com/rss/ai-artificial-intelligence/index.xml` | 200 | Atom | 10 | 43.1 | **약 6시간** | 허용 | 하루 1회면 대부분 놓침 → 2단계(수집 빈도 결정 후) 또는 제외 |
| VentureBeat AI | `https://venturebeat.com/category/ai/feed/` | **429**(두 번 시도) | - | - | - | - | 허용 | 요청 제한 → 제외(Google News로만 발견) |
| MIT Technology Review AI | `https://www.technologyreview.com/topic/artificial-intelligence/feed` | 200 | RSS 2.0 | 10 | 1.4 | 약 7일 | 허용 | **추천 후보**(정책·분석) |
| Ars Technica AI | `https://arstechnica.com/ai/feed/` | 200 | RSS 2.0 | 20 | 1.8 | 약 11일 | 허용 | **추천**(양 적고 질 높음) |
| Wired AI | `https://www.wired.com/feed/tag/ai/latest/rss` | 200 | RSS 2.0 | 10 | 4.8 | 약 2일 | 허용 | 2단계 |
| The Decoder | `https://the-decoder.com/feed/` | 200 | RSS 2.0 | 10 | 9.8 | 약 24시간(경계) | 허용 | **추천 후보**(모델 출시 속보가 많음, 누락 위험 표시 감시) |
| IEEE Spectrum AI | `https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss` | 200 | RSS 2.0 | 30 | 0.6 | 충분 | 허용 | 2단계 |

### 1.3 한국 언론

| 소스 | URL | 응답 | 형식 | 항목 | 하루 평균 | 덮는 기간 | robots | 판단 |
|---|---|---|---|---:|---:|---|---|---|
| AI타임스 | `https://www.aitimes.com/rss/allArticle.xml` | 200 | RSS 2.0 | 50 | 46.9 | **약 26시간(경계)** | 허용 | **추천**. 보험매일과 같은 CMS라 시각에 타임존이 없음(KST 보정 필요) |
| 인공지능신문 | `https://www.aitimes.kr/rss/allArticle.xml` | 200 | RSS 2.0 | 50 | 21.2 | 약 57시간 | 허용 | **추천**. 같은 CMS(KST 보정) |
| 지디넷코리아 | `https://feeds.feedburner.com/zdkorea` | 200 | RSS 2.0 | 30 | 444.7(전체 섹션) | **약 1.6시간** | 허용 | RSS로는 부적합(전 섹션 30건) → Google News `site:zdnet.co.kr (AI OR 인공지능)`(하루 100건 상한 도달, 쿼리를 좁혀야 함) |
| 전자신문 | `https://rss.etnews.com/Section901.xml`(전체), `Section902.xml` | 200 | RSS 2.0 | 30 | 182~347 | **약 2~4시간** | 허용 | RSS 부적합(AI 섹션 피드 없음) → Google News |
| 바이라인네트워크 | `https://byline.network/feed/` | 200 | RSS 2.0 | 20 | 15.7 | 약 30시간 | 허용 | 2단계(IT 전반, AI 비중 중간) |
| 디지털데일리 | `https://www.ddaily.co.kr/rss/allArticle.xml` | 200(HTML) | - | - | - | - | 허용 | RSS 경로 아님(제외) |
| 로봇신문 | `https://www.irobotnews.com/rss/allArticle.xml` | 200 | RSS 2.0 | 50 | 22.6 | 약 53시간 | 허용 | 월드모델·로보틱스 단계에서 추가(KST 보정) |

### 1.4 GitHub releases (Atom)

모두 `https://github.com/<owner>/<repo>/releases.atom`, 200, Atom, 10건(고정), robots 허용.

| 레포 | 하루 평균 | 표본 제목 | 판단 |
|---|---:|---|---|
| huggingface/transformers | 0.3 | `v4.xx.0` 류 | 추천 |
| vllm-project/vllm | 0.4 | `v0.x.y` | 추천 |
| langchain-ai/langchain | 1.5 | 패키지별 릴리스(`langchain-core==…`) | 정식 릴리스만 필터 |
| ollama/ollama | 0.8 | `v0.x.y` | 추천 |
| ggml-org/llama.cpp | **25.0** | `b12284: CUDA: …`, `b12283` | 빌드마다 릴리스 → **제외** 또는 주 1회 요약만 |
| pytorch/pytorch | **43.4** | `viable/strict/1794390644` | 내부 태그가 섞임 → `^v\d` 만 남기는 필터 필수 |

주의: 릴리스 제목은 `v4.57.0` 처럼 레포 이름이 없어 그대로 보이면 의미가 없다 → 피드별 제목 접두어(`transformers v4.57.0`)와 제목 포함/제외 정규식이 필요하다(2.6). 링크는 GitHub 릴리스 페이지다(본문 저장 없음).

### 1.5 월드모델·로보틱스

| 소스 | 확인 결과 | 판단 |
|---|---|---|
| Google DeepMind | 위 RSS에 Genie·로보틱스 글 포함(별도 로보틱스 피드는 404) | 추천(공식 RSS 하나로 충분) |
| NVIDIA Cosmos/Isaac | 블로그 robotics 카테고리 피드는 메인 피드와 같은 내용을 줌. Developer 블로그 `tag/cosmos/feed/` 는 36건(Atom), `tag/robotics/feed/` 는 0건 | Cosmos 태그 피드 + 메인 블로그 |
| Meta FAIR / V-JEPA | 블로그 RSS·사이트맵 없음 | Google News `("V-JEPA" OR JEPA)`(30일 10건) 또는 `site:ai.meta.com` |
| World Labs | `/blog` HTML, `rss.xml` 404, **`sitemap.xml` 200**(블로그 URL 19개, lastmod는 모두 빌드 시각으로 같음) | 사이트맵 diff(새 URL 감지) 또는 Google News `site:worldlabs.ai` |
| Wayve | `/feed/`, `/thinking/`, **robots.txt까지 403**(봇 차단) | **제외**(접근 차단을 우회하지 않는다) |
| Physical Intelligence | `/blog` HTML, RSS 없음 | Google News로만 |
| The Robot Report | `https://www.therobotreport.com/feed/` 200, 15건, 하루 2.9 | 추천(로보틱스 산업) |
| IEEE Spectrum Robotics | `https://spectrum.ieee.org/feeds/topic/robotics.rss` 200, 30건 | 추천 |
| 로봇신문(한국) | 위 1.3 | 추천 |
| arXiv cs.RO | `https://rss.arxiv.org/rss/cs.RO` 200, 하루 111건 | 논문은 이번 범위 밖. 나중에 '논문' 소스 종류로 |

**월드모델 매칭 키워드 후보**

- 영어(구 단위로만, 단어 경계 + 복수형 허용): `world model(s)`, `world simulator`, `world foundation model`, `physical AI`, `embodied AI`, `embodied agent`, `JEPA`, `V-JEPA`, `Genie 3`(모델명 목록), `Cosmos`(NVIDIA와 함께 나올 때만), `Isaac Sim`/`Isaac GR00T`, `GR00T`, `humanoid`, `robot foundation model`, `sim-to-real`, `digital twin`(보조), `video world model`, `interactive world`
- 한국어: `월드모델`, `월드 모델`(띄어쓰기 무시 매칭이라 하나로 됨), `세계 모델`, `피지컬 AI`/`피지컬AI`, `물리 AI`, `체화 AI`, `구현형 AI`, `휴머노이드`, `로봇 파운데이션 모델`, `디지털 트윈`(보조)
- **오탐 주의**
  - `world` 단독은 쓰지 않는다: `World Cup`, `world's first`, `real world`, `World Labs`(회사명은 기업 목록으로 처리), `Worldcoin`, `World of Warcraft`, `World Bank`. 지금 매처로도 `World Cup final`에 `world`가 걸린다(실측).
  - `Cosmos`는 단독이면 Cosmos(블록체인)·잡지 등과 겹친다 → `NVIDIA` 동시 출현 조건(combos)으로.
  - `Genie`는 일반 단어 → 모델명 패턴(`Genie 2/3`)으로만.
  - `digital twin`은 제조·스마트시티 기사가 대부분 → 단독으로는 관련도만 주고 분야는 붙이지 않는다.
  - `휴머노이드`는 로봇 산업 일반 기사(전시회·주가)가 많다 → 로보틱스 분야로는 맞지만 '월드모델' 태그로는 쓰지 않는다.
  - Google News는 본문까지 검색하므로 `"world model"` 결과 중 제목에 그 말이 있는 것은 29건 중 16건(55%)이었다. 검색 결과도 제목 기준 재판정이 필요하다.

### 1.6 Anthropic(RSS 없음) 대안

| 방법 | 내용 | 장단점 |
|---|---|---|
| (1단계 권장) Google News `site:anthropic.com` | 최근 30일 41건. 제목 끝 `- Anthropic` | 코드 변경 없음. 구글 중간 링크, 지연 가능 |
| 사이트맵 diff | `https://www.anthropic.com/sitemap.xml` 200, URL 589개 중 `/news/` 280개. **lastmod는 수정 시각**(2023년 글도 2026-10 lastmod)이라 발행일로 못 씀 → 전날 목록에 없던 `/news/` URL만 새 글로 보고, 제목은 해당 페이지 `<title>`/`og:title` 한 번 요청(새 글당 1회), 발행 시각은 처음 본 시각 | 직접 링크, 정확. 새 소스 종류(`sitemap`)와 '이미 본 URL' 상태 파일이 필요 |
| HTML 목록 파싱(boards.py 방식) | `/news` 목록 페이지 | 구조 변경에 약함 → 비권장 |

같은 방식(사이트맵 diff)으로 World Labs도 처리할 수 있다. Meta AI는 사이트맵도 없어 Google News만 가능하다.

### 1.7 Google News 검색 쿼리(실측)

영어는 `hl=en-US&gl=US&ceid=US:en`, 한국어는 `hl=ko&gl=KR&ceid=KR:ko`. 쿼리당 100건 상한.

| 언어 | 쿼리 | 결과 | 판단 |
|---|---|---:|---|
| en | `site:anthropic.com when:30d` | 41 | 추천(Anthropic 대체) |
| en | `site:ai.meta.com when:30d` | 12 | 추천(Meta 대체) |
| en | `(OpenAI OR Anthropic OR "Google DeepMind" OR Mistral) when:1d` | **100(상한)** | 너무 넓음. 회사별 분할 + `when:1d` 로도 부족 |
| en | `("AI model" OR LLM) (launch OR release OR unveils) when:1d` | 20 | 추천(모델 출시) |
| en | `("AI Act" OR "AI regulation" OR "AI safety") when:2d` | **100(상한)** | `when:1d` + 핵심어 축소 필요 |
| en | `(AI startup) (raises OR funding OR acquires) when:1d` | 50 | 추천(투자) |
| en | `("world model" OR "world models" OR "physical AI" OR "embodied AI") when:7d` | **100(상한)** | `physical AI`가 넓음 → `"world model"`(29), `"world models"`(28)로 분리 |
| en | `(open-source model OR "open weights") when:2d` | 26 | 추천(오픈소스) |
| ko | `(생성형 AI OR LLM OR 거대언어모델) when:1d` | **100(상한)** | 한국 AI 기사는 하루 100건을 넘는다 → 주제별로 좁히기 |
| ko | `(AI 기본법 OR AI 규제 OR AI 안전) when:3d` | 33 | 추천(정책) |
| ko | `(월드모델 OR 피지컬 AI OR 피지컬AI OR 휴머노이드) when:7d` | **100(상한)** | `휴머노이드`가 넓음 → `(월드모델 OR "월드 모델")`(18건, 제목 일치 17)로 |
| ko | `site:zdnet.co.kr (AI OR 인공지능) when:1d` | **100(상한)** | 지디넷 대체로 쓰려면 더 좁혀야 함 |

AI 채널은 쿼리 상한(채널당 25개 유지 권장)보다 **쿼리당 100건 상한**이 먼저 문제다. 직접 RSS를 기본으로 하고, 검색은 RSS 없는 공식 출처(`site:`)와 좁은 주제 쿼리(정책·투자·월드모델)에만 쓰기를 권장한다. 1단계 쿼리 목록 초안은 5장에 있다.

### 1.8 약관·저작권·robots

- robots.txt: 측정한 모든 URL이 우리 UA로 허용이었다. 예외는 Wayve(robots.txt 자체가 403 — 차단으로 보고 제외)와 VentureBeat(429 — 반복 요청 금지, 제외)다.
- 저장 범위: 제목·링크·출처·시각·우리 메타만 저장하므로(본문·요약·이미지 없음) 보험 채널과 같은 위험 수준이다. 다만 다음은 주의한다.
  - Condé Nast(Wired, Ars Technica)·Vox Media(The Verge)·MIT TR은 RSS를 개인·비상업 이용 전제로 제공한다. 비상업 공개 사이트이고 제목+링크만 쓰므로 허용 범위로 보지만, 각 약관을 확인할 때까지 "약관 확인 필요"로 README 소스 표에 올린다.
  - 국내 언론(AI타임스·인공지능신문·로봇신문)은 보험 채널의 전문지 RSS와 같은 방식이다(제목·링크). 같은 기준으로 "약관 확인 필요" 표시.
  - GitHub: Atom 피드는 공개 엔드포인트. 하루 1회·10개 레포 이하면 부담이 없다(API 미사용).
  - Google News: 보험 채널과 같은 방식(구글 중간 링크).
- **제외 권고**: Wayve(차단), VentureBeat RSS(429), 지디넷·전자신문 전체 섹션 RSS(전 섹션이라 AI 외 기사가 대부분이고 하루 1회 수집으로는 대부분 놓침), llama.cpp releases(빌드마다 릴리스), AWS ML 블로그(튜토리얼 위주), arXiv(범위 밖).

---

## 2. 엔진 변경점

### 2.1 영어 제목 매처 — 지금 상태(실측)

`collector/classify.py:21-45` `Matcher`: 키워드가 `^[a-z0-9\- ]+$`(`classify.py:12`)이면 단어 경계 정규식(`word`), 아니면 띄어쓰기를 지운 부분일치(`sub`). 기존 코드를 그대로 불러 확인한 결과:

| 키워드 | 제목 | 결과 | 문제 |
|---|---|---|---|
| `model` | Google releases two new **models** | 불일치 | 복수형 처리 없음 |
| `llm` | **LLMs** are getting cheaper | 불일치 | 〃 |
| `world model` | DeepMind **world models** explained | 불일치 | 〃 |
| `open source` | Meta **open-sources** Llama 5 | 불일치 | 하이픈·띄어쓰기 변형, 동사형 |
| `ai` | Open**AI** unveils new model | 불일치 | (단어 경계로는 정상) 회사명 안의 AI는 별도 처리 필요 |
| `gpt-4.5` | **GPT-4.55** benchmark | **일치** | 마침표가 있어 `sub`(경계 없음)로 떨어짐 → 오탐 |
| `llama 3.1` | Llama 3.1 405B | 일치 | `sub` 모드(경계 없음, `llama 3.10`도 일치) |
| `world` | **World** Cup final | 일치 | 단독 일반어 오탐 |
| `jepa` | V-**JEPA** 2 released | 일치 | 정상 |
| `월드모델` | 엔비디아 월드 모델 공개 | 일치 | 정상(한글은 문제 없음) |

**관련도 판정은 더 심각하다**: `classify.py:81` `relevant = any(k in sq for k in self.relevance)` 는 띄어쓰기를 지운 제목에서 단순 부분일치를 한다. 관련도 키워드에 `ai`를 넣으면 `said`·`again`·`maintain`·`Thailand`에 모두 걸린다(실측: `"Sam Altman said …"` → 참).

**바꿔야 할 것**

1. 관련도 키워드도 `Matcher`로 판정(`classify.py:72, 81`). 보험 채널은 한글 키워드라 결과가 같아야 한다(동등성 스크립트로 확인).
2. 채널 설정 `match.language: "ko" | "en" | "mixed"` 또는 키워드 단위 옵션.
   - 영어 단어 모드: 끝에 `s?`/`es?` 허용(복수형), 하이픈·공백·없음을 같은 것으로(`open[- ]?source`), 영숫자에 `.`·`+`·`/`·`_` 를 포함한 토큰도 경계 모드로(`gpt-4.5`, `c++`, `o3-mini`, `qwen2.5`) — 경계 문자를 `[a-z0-9.]` 로 확장하되 문장 끝 마침표는 제외.
   - 키워드 대신 정규식(`{"re": "\\bgpt-?\\d+(\\.\\d+)?\\b"}`)도 허용 → 모델명 계열에 필요.
   - 한글 키워드는 지금처럼 띄어쓰기 무시 부분일치(혼합 제목 `오픈AI, GPT-5 공개`에서 한글·영문 각각 정상 동작).
3. 대소문자: 지금도 casefold라 문제 없음. 단 `AI`·`Apple` 같은 약어·고유명사는 단어 경계로만.
4. 겹침 처리(`star_top`, `classify.py:113-125`)는 `sub` 키워드 전제다. 영어 키워드가 `word`면 겹침 제거가 안 되어 `world model` + `model` 이중 가산이 생길 수 있다 → 영어도 매칭 구간(start,end)을 돌려주게 해서 같은 규칙을 적용.

### 2.2 AI용 점수 공식

지금 `score.json`은 구조가 보험 전제다(`classify.py:68-71`: `market_cap.insurance_terms`·`insurance_company_categories` 필수). AI 채널은 같은 엔진에 **플러그형 가산·상한 항목**을 추가하는 방향을 권장한다.

| 항목 | 내용 | 설정 예 |
|---|---|---|
| 기본 | base 2, max 5, 키워드 합 임계 가산(지금 구조 재사용) | `keyword_thresholds` |
| 신규 모델·제품명 | 모델명 정규식(`GPT-\d`, `Gemini \d`, `Claude`, `Llama \d`, `Qwen\d`, `Mistral …`, `Genie \d`, `Cosmos`) + 출시 동사(`launch/release/unveil/introduce/공개/출시`) 동시 → +1 | `core_terms` 그룹을 정규식으로 |
| 공식 출처 가산 | 공식 블로그·릴리스 피드(`source_type: official`)면 +1 | 피드 설정 `official: true` |
| 보도 규모 가산 | 같은 사건 묶음(2.4)의 매체 수 ≥3 → +1(대표 기사에만) | `cluster_bonus` |
| 중복 감쇠 | 묶음의 대표가 아닌 기사는 ★ 최대 2(목록에서 같은 사건이 상위를 독점하지 않게) | `cluster_member_max` |
| 낮은 중요도 상한 | 의견·칼럼·목록형(`Best`, `Top 10`, `How to`, `[칼럼]`, `[AI픽]`), 고객 사례(`rethinks … with AI`), 할인·주가 → ★2 상한 | 지금 `low_importance` 재사용 |
| 시장 상한 | 보험 전용(`market_cap`) → AI는 비활성(빈 목록 허용) | 필수 키 해제 |

### 2.3 KST·ko 하드코딩 위치(파일:줄)

| 위치 | 내용 | AI 채널 영향 |
|---|---|---|
| `collector/collect.py:30` | 구글 뉴스 `hl=ko&gl=KR&ceid=KR:ko` 고정 | **변경 필요**(쿼리별 언어) |
| `collector/collect.py:111-118` | 타임존 없는 RSS 시각을 KST로 보고 −9h | 피드별 설정으로(한국 CMS 피드만 KST, 영어 피드는 시각에 타임존 있음 — 실측: AI타임스는 타임존 없음) |
| `collector/boards.py:13, 20` | 게시판 날짜를 KST 09:00으로 | AI 채널은 게시판 미사용 |
| `collector/boards.py:93` | `Accept-Language: ko` | 〃 |
| `collector/trends.py:1, 9, 13` | 주별 집계 KST, 월요일 시작 | 독자가 한국이므로 유지 가능 |
| `collector/classify.py:10` | `UNCATEGORIZED = '미분류'` | 유지(화면 한국어) |
| `collector/eval_classify.py:6, 41-43` | 샘플 경로 고정, `'자동차보험'` 직접 참조 | 채널별 샘플·지표로 일반화 필요 |
| `lib/dates.ts:1-5` | 날짜 키 KST 고정(`KST_MS`) | 유지 가능(화면 기준 KST) |
| `lib/format.ts:4` | 기본값 `ko-KR`/`Asia/Seoul`(채널 설정이 덮어씀) | 문제 없음 |
| `lib/facets.ts:10`, `lib/sources.ts:8` | `localeCompare(…, 'ko')` | 영문 이름도 정상 정렬 — 유지 |
| `lib/highlights.ts:5`, `lib/version.ts:5` | KST 주석·표기 | 유지 |
| `app/layout.tsx:6` | `<html lang="ko">` | 영어 제목에 `lang="en"` 지정 권장(3장) |
| `app/[channel]/trends/page.tsx:28` | 안내 문구 "발행일(KST)" | 유지 |
| `scripts/make-version.mjs:7-9` | 빌드 시각 `+09:00` | 유지 |

### 2.4 같은 발표를 여러 매체가 다룬 기사 묶기

지금은 `normalize.dedupe_key`(`normalize.py:23-24`) = 띄어쓰기 제거 제목 + 출처의 **완전 일치**만 합친다. 다른 매체가 쓴 같은 사건은 별개 기사다(보험 채널도 같음).

제안: **기사는 그대로 저장하고 묶음 메타 `cluster`(대표 기사 id)를 붙인다**(삭제·병합 없음, 되돌리기 쉬움).

1. 후보: 발행 시각 48시간 이내.
2. 같은 언어 안에서 제목 유사도: 영어는 소문자·불용어·구두점 제거 후 토큰 Jaccard ≥ 0.5, 한국어는 공백 제거 문자 2-gram Jaccard ≥ 0.45(`make_samples.py`의 `difflib` 0.75보다 느슨하게, 실데이터로 조정).
3. 언어를 넘는 묶음(영어 발표 ↔ 한국어 보도): 제목 유사도로는 안 된다 → **같은 모델·제품명(정규식 일치) + 같은 회사(entities) + 24시간 이내**면 같은 묶음.
4. 대표 선택: 공식 출처 > 직접 링크 > 먼저 발행 > ★ 높은 것(지금 `prefer` 규칙의 연장).
5. 화면: 기본 목록은 대표만 보여 주고 "+N개 매체" 펼치기. 새 뉴스 건수는 묶음 단위로 센다.

### 2.5 채널 설정 구조(`channels/ai/`)

| 파일 | 보험 채널과 공유 | AI 채널 내용 |
|---|---|---|
| `channel.json` | 구조 공유 | slug `ai`, 이름 'AI', 부제(예: 'AI 모델·도구·정책·산업'), locale ko-KR, timezone Asia/Seoul, 탭(새 뉴스·전체 뉴스·**공식 발표**·북마크), 필터 라벨(**출처**·**기업**·**분야**), `schedule_utc` |
| `theme.json` | 구조 공유 | 채널 색 |
| `categories.json` | 구조 공유 | 4개 카테고리 + priority + exclude + relevance_keywords(영·한) + feed_hints + `match` 옵션(신규) |
| `score.json` | 엔진 공유, 값 별도 | 2.2 |
| `companies.json` | 엔진(entities) 공유 | AI 기업·연구소(OpenAI, Anthropic, Google/DeepMind, Meta, Mistral, xAI, NVIDIA, Microsoft, 네이버, 카카오, LG AI연구원, 업스테이지, World Labs 등). `relevance.company_mention_is_relevant`는 **false 권장**(Google·Meta·Microsoft는 AI 외 기사가 많음) |
| `orgs.json` | 엔진 공유 | **1단계: 분야 5개**를 '기관' 칸에 넣어 필터로 사용(아래 3장). 나중에 일반화된 facets로 이전 |
| `feeds.json` | 구조 확장 필요 | 지금은 구글 검색 쿼리만 읽는다. **직접 RSS 목록을 이 파일로 옮기는 변경이 선행**(2.6) |
| `boards.json` | 공유 | `{"boards": []}` |
| `keywords.json` | 공유 | 추이 키워드(예: GPT, Gemini, Claude, Llama, 오픈소스, 규제, 월드모델) |
| `source_aliases.json`·`blocked_sources.json`·`title_filters.json`·`context_exclude.json` | 공유 | 영문 매체 별칭(`TechCrunch`, `The Verge` 등), 차단 출처, 노이즈 제목, 제외어 |

### 2.6 수집기 일반화 목록(필요 순)

| # | 위치 | 지금 | 바꿀 것 | 보험 채널 영향 |
|---|---|---|---|---|
| E1 | `collect.py:34-40` `RSS_SOURCES`·`RSS_SUBSTITUTE` | 코드에 하드코딩 | `feeds.json`의 `rss` 목록(이름·URL·type·고정 출처·`naive_tz`·`official`·제목 접두어/필터) | 보험 4개를 그대로 옮기고 동등성 확인 |
| E2 | `collect.py:88, 129` `PRESS_RE` | press 기사는 보험 단어가 없으면 관련 없음 | 채널 설정(`categories.json` 의 `press_relevance_keywords`, 빈 목록이면 규칙 끔) | 같은 목록을 설정으로 |
| E3 | `classify.py:72, 81` 관련도 판정 | 부분일치 | Matcher 사용 | 한글이라 결과 같음(확인 필요) |
| E4 | `classify.py:12, 21-45` Matcher | 2.1 | 영어 모드·정규식 키워드 | 기본값은 지금 동작 |
| E5 | `collect.py:30` `google()` | ko 고정 | 쿼리별 `lang` | 기본 ko |
| E6 | `collect.py:111-118` `parse_date` | 무조건 KST 가정 | 피드별 `naive_tz`(기본 Asia/Seoul) | 같음 |
| E7 | `classify.py:68-71` score 필수 키 | 보험 키 필수 | 선택 항목·플러그형 가산(2.2) | 같음 |
| E8 | `normalize.py:9` `ORG_SUFFIX` | 금융위·금감원 | 채널 설정(제목 접미어 정규식 목록) | 같음 |
| E9 | 묶음(2.4) | 없음 | `cluster` 메타 | 보험 채널은 끈 채로 시작 |
| E10 | 새 소스 종류 | rss·google·board | `github`(제목 접두어·필터), `sitemap`(diff + 제목 1회 요청) | 없음 |
| E11 | `eval_classify.py:6, 41` | 보험 샘플·지표 고정 | `--channel`, 채널별 `tests/<채널>_samples.json` | 같음 |

**SoTA·리더보드 확장 지점(이번 범위 밖)**: 소스 종류를 `kind` 로 구분하는 지금 구조(`rss`·`search`·`board`, `status.json`의 `kind`)를 유지하고, 나중에 `kind: leaderboard`(공개 리더보드 JSON/CSV)를 추가한다. 결과는 기사 샤드에 섞지 않고 `data/ai/leaderboards/<이름>.json`(날짜별 순위 스냅샷)으로 따로 저장하고, 화면은 별도 페이지(`/ai/leaderboards/`)로 둔다. 순위 변화(새 1위 등)는 그때 기사 형식의 '이벤트'로 만들어 목록에 넣을 수 있게 `make_article` 를 재사용한다.

---

## 3. UI 영향

| 항목 | 현재 | AI 채널에서 |
|---|---|---|
| 영어 제목 | 폰트(Arial·Apple SD Gothic Neo)로 표시 문제 없음. 줄바꿈 정상 | 제목 요소에 `lang="en"` 을 붙이면 스크린리더 발음·하이픈 처리 개선(기사에 `lang` 메타 추가 — 제목 문자 비율로 판정) |
| 카테고리 4개 | 버튼은 `categories.json` 키 순서로 자동 생성 | 코드 변경 없음 |
| 출처 필터 | '언론사' 다중 선택(출처 이름) | 라벨만 '출처'로(설정). 공식 블로그·GitHub도 출처로 보임 |
| 기업·분야 필터 | 보험사·유관기관 칸(라벨 설정 가능, 그룹 지원) | 보험사 칸 → '기업'(그룹: 빅테크·AI 연구소·국내 기업), 유관기관 칸 → '분야'(5개, aliases=분야 키워드) — **코드 변경 없이 가능** |
| 공식 발표 탭 | `source_type === 'press'` | 탭 이름 '공식 발표'(설정). 단 E2(PRESS_RE) 해결이 선행 |
| 보험 전용 문구(하드코딩) | `app/[channel]/page.tsx:156`(관련도 낮음 툴팁 "보험 관련 단어"), `:166`(감독당국 탭 안내), `components/ArticleCard.tsx:18`(공식 RSS/검색으로 발견), `:25`('학습 중요도') | 채널 설정으로 옮겨야 함(소) |
| 묶음 표시 | 없음 | "+N개 매체" 펼치기(중, E9 이후) |
| 날짜·시간 | KST 표시 | 유지(독자 기준). 미국 발표는 한국 날짜로 다음날이 될 수 있음 |

**채널 활성화 절차**(8.7 구조 기준)

1. `channels/ai/` 에 2.5의 파일을 만든다(`channel.json` 의 `slug: "ai"`, `schedule_utc` 는 지금 테스트상 deploy.yml cron과 같아야 함).
2. `lib/channels.ts` 에 `ai` 설정 import 5줄과 `CHANNELS` 항목 1줄을 추가한다(정적 빌드라 import 필요).
3. `.github/workflows/deploy.yml` 의 `matrix.channel` 에 `ai` 추가.
4. `npm test`(`tests/channels.test.ts` 가 폴더·등록·매트릭스·cron 일치를 확인), 빌드 → `/ai/`·`/ai/week/`·`/ai/trends/`·`/ai/status/`·`/ai/settings/` 생성. 헤더 채널 전환이 2개부터 자동으로 보인다.
5. 첫 실행은 `gh workflow run deploy.yml` 로 수동(데이터 `data/ai/` 첫 커밋 전 요약 보고·승인).
6. 채널별 cron을 다르게 하려면 deploy.yml에 schedule을 하나 더 두고 `tests/channels.test.ts` 의 cron 검사를 "채널 cron이 workflow schedule 중 하나"로 바꿔야 한다.
7. 공개 전 숨기기가 필요하면 레지스트리에 `hidden`(빌드는 하되 전환 버튼·포털에서 숨김)을 두는 방법이 있다(새 기능 — 결정 필요).

---

## 4. 규모와 리스크

### 4.1 예상 수집량(1단계 8개 소스 기준, 실측 하루 평균으로)

| 묶음 | 하루 후보 |
|---|---:|
| 공식 블로그 4개(OpenAI·DeepMind·Hugging Face·NVIDIA) | 약 3~5 |
| 영어 언론 2개(TechCrunch AI·Ars Technica) | 약 17 |
| 한국 언론 2개(AI타임스·인공지능신문) | 약 68 |
| Google News `site:` 2개(Anthropic·Meta) | 약 2 |
| **합계(중복 제거 전)** | **약 90/일** |

2단계(언론·쿼리 확대) 이후는 하루 200~400건으로 본다(검색 쿼리 하나가 하루 20~100건).

### 4.2 저장 용량

- 보험 채널 실측: 기사 1건 ≈ 700바이트(2026-11 1,661건 = 1.19MB).
- AI 1단계: 90건/일 × 30일 ≈ 2,700건 ≈ **1.9MB/월**. 2단계(300건/일) ≈ **6.3MB/월** → architecture.md의 월 5MB 알림 기준을 넘는다.
- 화면은 첫 표시 때 최근 2개월 파일을 받는다(`lib/useNews.ts`). 월 6MB면 첫 화면에 최대 12MB → **2단계 전에 주 단위 샤드 또는 '관련도 낮음 미저장' 결정이 필요**하다.
- 저장소 증가: 연 20~70MB(텍스트, git 압축 전). 1GB 권장 한도까지 여유는 있다.

### 4.3 Actions 실행 시간

- 보험 채널 수집 약 35초, 수집 잡 전체 약 51초(실측).
- AI 1단계: 피드 8~10개(병렬 5) + 구글 쿼리(0.6초 간격) → 수집 30초 내외. 매트릭스 병렬이라 전체 실행 시간 증가는 거의 없고, 빌드 잡은 데이터 크기에 비례해 수 초 증가.
- 사이트맵 diff 도입 시 새 글당 페이지 1회 요청(하루 0~3회, 1.2초 간격).

### 4.4 리스크

| 리스크 | 내용 | 대응 |
|---|---|---|
| 피드 깊이 부족 | The Verge(약 6시간), AI타임스(약 26시간), The Decoder(약 24시간)는 하루 1회 수집으로 누락 가능 | 상태 페이지 `gap_risk` 감시, 수집 횟수 결정(질문 1), 깊은 피드 우선 |
| 영어 오분류 | 2.1의 매처 한계 | E3·E4 선행, 영어 정답 샘플 100건 |
| 관련도 과대 | 공식 블로그·Google 피드에 AI 외 글(고객 사례·문화 행사) | 공식 출처도 제목 재판정, 낮은 중요도 상한 |
| 용량 증가 | 4.2 | 주 단위 샤드 또는 관련도 낮음 미저장 |
| 약관 | 1.8 | 제외 권고 준수, README 소스 표에 "약관 확인 필요" |
| 보험 채널 회귀 | 엔진 공통 변경 | 매 단계 `scripts/audit/equivalence_*` 로 "같음" 확인 |

---

## 5. 단계별 구현 제안

### 단계 0 — 엔진 일반화(보험 채널 동작 동일)
- 내용: E1(직접 RSS를 `feeds.json`으로), E2(PRESS_RE 설정화), E3(관련도 Matcher), E5(구글 쿼리별 언어), E6(피드별 `naive_tz`), E7(score 선택 키), E8(ORG_SUFFIX 설정화), E11(eval 채널화). Matcher 영어 모드(E4)는 기본 꺼짐으로 추가.
- 완료 기준: collector 테스트·npm test 통과, **동등성 스크립트 두 개 모두 '같음'**(옛 코드 대비), 영어 매처 단위 테스트(2.1 표의 사례가 기대대로).

### 단계 1 — AI 채널 최소 공개(소스 8개, 카테고리 4개)
- 소스(8): OpenAI News, Google DeepMind, Hugging Face, NVIDIA Blog, TechCrunch AI, Ars Technica AI, AI타임스, 인공지능신문. 그리고 Google News 2개(`site:anthropic.com when:3d`, `site:ai.meta.com when:7d`).
- 카테고리 4개 + 미분류, 분야 5개는 '분야' 필터(orgs 칸), 기업 필터(companies 칸), 탭 '공식 발표'.
- 정답 샘플: 실제 수집분에서 영어·한국어 각 60건 이상, 총 120건 라벨(사람).
- 완료 기준: `/ai/` 5개 페이지 배포, 상태 페이지에서 소스 10개 성공, 샘플 정확도 전체 ≥ 75%(검증 ≥ 70%), 관련도 낮음 비율 확인(목표 30% 이하), 보험 채널 동등성 '같음' 유지, 첫 data 커밋 전 요약 보고·승인.

### 단계 2 — 소스 확대와 쿼리
- 영어: MIT TR AI, The Decoder, Wired AI, IEEE Spectrum AI, Google Research, Mistral, Microsoft Research. 한국: 바이라인네트워크, Google News 주제 쿼리(정책·투자·오픈소스·모델 출시, 영·한 합쳐 12개 이하).
- 화면 보험 전용 문구 설정화(3장), 영어 제목 `lang`.
- 완료 기준: 소스별 `gap_risk` 없음(또는 결정된 수집 빈도에서 해소), 월 용량 추정 재계산, 정확도 유지.

### 단계 3 — 묶음·점수 v2
- E9(cluster 메타), 2.2 점수 항목(공식 가산·모델명·보도 규모·중복 감쇠), 화면 "+N개 매체".
- 완료 기준: 표본 200건 수동 검수에서 같은 사건 묶음 정밀도 ≥ 90%, 이번 주 핵심 상위 20에 같은 사건 중복 2건 이하.

### 단계 4 — 개발 도구·월드모델 소스
- GitHub releases(transformers·vllm·ollama·langchain 정식 릴리스, pytorch는 `^v\d` 필터), 새 소스 종류 `github`.
- 월드모델: NVIDIA Dev Cosmos 태그, The Robot Report, IEEE Spectrum Robotics, 로봇신문, Google News `"world model"`·`"world models"`·`(월드모델 OR "월드 모델")`, 사이트맵 diff(World Labs·Anthropic) 검토.
- 완료 기준: 릴리스 노이즈(빌드 태그) 0건, '월드모델·로보틱스' 분야 오탐(1.5 주의 목록) 표본 검수 10% 이하.

### 단계 5 — (나중) 리더보드
- 2.6 끝의 확장 지점대로 `kind: leaderboard`, 별도 데이터·페이지.

---

## 6. 결정이 필요한 질문

1. **수집 빈도**: 깊이가 얕은 피드(The Verge 약 6시간, AI타임스 약 26시간) 때문에 AI 채널만 하루 2~4회 수집을 허용할지, 하루 1회를 유지하고 누락을 감수(또는 그런 피드 제외)할지. (CLAUDE.md 원칙: 하루 1회 수준)
2. **분야 5개**: 필터로 쓰기(추천, 1단계는 orgs 칸 재사용) vs 카드 태그만.
3. **관련도 낮은 기사 저장**: 보험 채널처럼 저장(용량 증가) vs AI 채널은 저장하지 않음.
4. **샤드 단위**: 2단계 전에 AI 채널을 주 단위 샤드로 바꿀지(화면 로딩 코드 변경 동반).
5. **Anthropic·World Labs**: Google News `site:` 로 충분한지, 사이트맵 diff(새 소스 종류) 구현까지 갈지.
6. **GitHub 릴리스 위치**: 일반 목록에 섞기 vs '릴리스' 탭·카테고리('오픈소스·개발 도구' 안 서브 표시).
7. **공개 시점**: 단계 1 직후 채널 전환에 바로 노출할지, 숨김(`hidden`) 상태로 1~2주 운영 후 공개할지.
8. **cron**: 보험과 같은 20:37 UTC(당시 시각. 미국 업무일 기사가 대부분 포함되는 시각)로 둘지, 따로 둘지.
9. **'학습 중요도' 문구**: AI 채널에서는 '중요도'로 바꿀지(채널 설정화 필요).

---

## 7. 확정 결정 (2026-11-11)

- **수집 빈도**: AI 채널은 하루 3회(피드가 얕은 소스 때문). 보험 채널은 하루 1회 그대로. CLAUDE.md 수집 원칙에 반영.
- **분야 5개**(LLM·NLP / 비전·멀티모달 / 음성·오디오 / 통계·ML·시계열 / 월드모델·로보틱스): 필터 + 카드 태그로 표시. 단계 1에서는 기존 '유관기관' 필터 칸(`orgs.json`, 라벨은 channel.json `filters.orgs`)을 '분야'로 재사용.
- **공개 시점**: 숨긴 채 1~2주 운영한 뒤 공개(헤더·채널 전환에 노출하지 않음).
- **범위 제외**: SoTA·리더보드(확장 지점만 2.6장 끝에 기록).

## 8. 단계 0 결과 — 채널 설정으로 옮긴 엔진 항목

키가 없으면 이전과 같은 기본값을 쓴다. 보험 채널은 `feeds.json` 의 `rss`, `categories.json` 의 `press_relevance_keywords`·`eval_focus` 만 추가했다.

| 설정 파일 · 키 | 내용 | 기본값(키 없을 때) | 보험 채널 |
|---|---|---|---|
| `feeds.json` `rss[]` | 직접 RSS: `name`, `url`, `type`(media/press), `source`(고정 출처), `timezone`, `substitute`(점검 중이면 이 출처의 게시판이 대신함 — 상태 '참고' 표시) | 없음 | 예전 코드 상수 4개를 같은 순서·값으로 이전 |
| `feeds.json` `default_timezone` | 타임존 없는 피드 시각의 해석 | `Asia/Seoul`(이전의 −9h와 같음) | 미설정 |
| `feeds.json` `google_lang`, `queries[].lang` | 구글 뉴스 언어 `ko`(hl=ko&gl=KR) / `en`(hl=en-US&gl=US) | `ko` | 미설정 |
| `categories.json` `match_mode` | `ko`: 이전 규칙 그대로 / `en`: 영어 키워드에 복수형(s/es)·띄어쓰기·하이픈 변형, 버전 번호 경계(`gpt-4.5` ≠ `GPT-4.55`), `. + /` 포함 토큰도 단어 경계. 한글 키워드는 두 모드 모두 띄어쓰기 무시 부분일치 | `ko` | 미설정 |
| `categories.json` `relevance_mode` | `substring`(이전) / `word`(단어 경계 — `said` 안의 `ai` 불일치) | `match_mode` 가 `en` 이면 `word`, 아니면 `substring` | 미설정 |
| `categories.json` `press_relevance_keywords` | 공식 발표(press) 기사가 관련 있으려면 제목에 있어야 할 낱말(예전 `PRESS_RE`) | 조건 없음 | 예전 정규식과 같은 8개 |
| `categories.json` `eval_focus` | `eval_classify.py` 가 따로 정밀도·재현율을 보여 줄 카테고리 | 없음 | `["자동차보험"]` |
| `score.json` 모든 항목 | `base`·`max`·`keyword_thresholds`·`core_terms`·`market_cap`·`low_importance`·`excluded_score` 모두 선택 | base 2, max 5, 나머지 규칙 없음 | 변경 없음 |
| `channel.json` `timezone` | 주별 키워드 집계(trends)의 날짜 기준 | `Asia/Seoul` | 이미 있음 |

- `companies.json`·`orgs.json`·`context_exclude.json` 의 별칭 매칭도 같은 `match_mode` 를 쓴다.
- 그대로 둔 것: 게시판 파서(fsc·fss, 한국 정부 사이트 전용이라 KST·`Accept-Language: ko` 가 사이트의 성질), `ORG_SUFFIX`(' - 금융위원회' 접미 제거, AI 제목에는 영향 없음), 화면의 날짜 키(`lib/dates.ts` KST)와 이름 정렬(`'ko'`). 화면 쪽은 `tests/channels.test.ts` 가 모든 채널의 `timezone=Asia/Seoul`, `locale=ko*` 를 강제한다 — 다른 값이 필요해지면 화면 코드를 먼저 일반화한다.
- 검증: 옛 코드(a292208) 대비 `scripts/audit/equivalence_collector.py` 차이 0(1,798건 재분류·분류 지운 사본 재계산·index·trends·정확도), `scripts/audit/equivalence_site.ts` 같음. 새 테스트 `collector/test_engine.py`.
