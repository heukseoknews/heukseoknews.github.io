# 기사 품질 라벨 표(확인용)

`scripts/audit/quality/labels_md.py` 로 생성. 원본은 `scripts/audit/quality/pairs_labeled.tsv`·`importance_labeled.tsv`. **두 판정자 모두 모델(A: 메인 세션, B: 라벨을 보지 않은 독립 서브에이전트)이라 사람 확인이 필요하다.** 고칠 때는 TSV 의 `final` 열을 바꾸고 평가·시뮬레이션 스크립트를 다시 돌린다.

## 1. 같은 사건 쌍 114개

판정 기준: **Y** 같은 사건(같은 발표·같은 실적 공시의 다른 수치·공식 글과 그 보도·사건을 다시 말하는 분석 제목) / **R** 관련(후속·반응·해설·예고·같은 이야기의 다른 진전) / **N** 다른 사건(같은 형식의 다른 회사, 릴레이 캠페인의 다른 참여자, 같은 회사의 다른 소식).

두 판정자 일치 105/114(92%), 불일치는 ⚠ 표시. final 분포: N 44, R 10, Y 60

표본: 72시간 안 기사 쌍을 유사도 층(S1 ≥0.6, S2 0.45~0.6, S3 0.35~0.45, S4 0.25~0.35, S5 0.15~0.25, E 유사도 낮지만 같은 회사, R 무작위)별로 무작위 추출. N = 그 층의 전체 쌍 수.

| id | 층(N) | 기사 A | 기사 B | 시간차 | A | B | final |
|---|---|---|---|---|---|---|---|
| ins-S1-01 | S1(2820) | 현대해상, 성남시의료원에 ‘마음도서관’ 개관...정서적 회복 지원 · 스마트투데이 | 현대해상, 성남시의료원에 ‘마음도서관’ 문 열어 · 핀포인트뉴스 | 7.2h | Y | Y | **Y** |
| ins-S1-02 | S1(2820) | 한화손보, 이대서울병원에 환자·지역 주민 위한 ‘웰니스 존’ 조성 · 파이낸셜투데이 | [보험 뉴스브리핑] 한화손보 이대서울병원 친환경 쉼터 '웰니스 존' 조성 · 아시아타임즈 | 3.2h | Y | Y | **Y** |
| ins-S1-03 | S1(2820) | 현대해상, 성남시의료원에 34번째 ‘마음도서관’ 개관 · 퍼블릭뉴스통신 | 현대해상, 성남시의료원에 ‘마음도서관’ 개관…11년간 병원 34곳에 조성 · 헤럴드경제 | 0.0h | Y | Y | **Y** |
| ins-S1-04 | S1(2820) | 라이나전성기재단 운영 한국전통호텔 바랑재, 5성급 획득 · 중앙이코노미뉴스 | 라이나전성기재단 운영 한국전통호텔 ‘바랑재’, 5성급 획득 · 한국보험신문 | 3.9h | Y | Y | **Y** |
| ins-S1-05 | S1(2820) | 현대해상, 성남시의료원에 ‘마음도서관’ 개관…전국 34곳 조성 · 서울타임즈뉴스 | 현대해상, 성남시의료원에 병원 내 쉼터 '마음도서관' 개관 · 뉴스핌 | 2.6h | Y | Y | **Y** |
| ins-S1-06 | S1(2820) | 삼성화재, 2.3조 들여 캐노피우스 경영권 인수 · 딜사이트 | 삼성화재, 영국 캐노피우스 경영권 인수…글로벌 보험사업 확대 · 한국면세뉴스 | 10.0h | Y | Y | **Y** |
| ins-S1-07 | S1(2820) | 현대해상, 성남시의료원에 ‘마음도서관’ 개관 · 보험신보 | [보험 뉴스브리핑] 현대해상 성남시의료원 '마음도서관' 개관 · 아시아타임즈 | 7.6h | Y | Y | **Y** |
| ins-S1-08 | S1(2820) | 현대해상, 성남시의료원에 마음도서관 개관 · 아주경제 | 현대해상, 병원 로비에 독서 공간 마련…성남시의료원 ′마음도서관′ 개관 · KPI뉴스 | 5.6h | Y | Y | **Y** |
| ins-S1-09 | S1(2820) | 김철주 생보협회장, 사람 살리는 금융 캠페인 동참…금융 안전망 강화 · 아주경제 | 김철주 생명보험협회장, ‘사람 살리는 금융’ 릴레이 캠페인 동참 · 세계일보 | 4.3h | Y | Y | **Y** |
| ins-S1-10 | S1(2820) | 김철주 생명보험협회장, 사람 살리는 금융 릴레이 캠페인 동참 · www.ebn.c… | 김철주 생보협회장, ‘사람 살리는 금융’ 캠페인 동참 · 서울타임즈뉴스 | 7.3h | Y | Y | **Y** |
| ins-S1-11 | S1(2820) | 메리츠화재, 3분기 누적 순이익 1조3528억원…전년比 6.8%↓ · 아주경제 | 메리츠화재, 3분기 누적 순익 1조3528억원 · 메트로신문 | 0.6h | Y | Y | **Y** |
| ins-S1-12 | S1(2820) | 한화손보, '여성 운전자 안심위치공유' 배타적사용권 획득 · 뉴시스 | 한화손보, ‘안심위치공유서비스’ 배타적사용권 획득 · 보험매일 | 0.4h | Y | Y | **Y** |
| ins-S2-01 | S2(2622) | 삼성화재, 2.3조원에 英 캐노피우스 경영권 인수···지분율 80.6% · 서울파이낸스 | [분석] 삼성화재, 캐노피우스 경영권 인수로 글로벌 도약 · 메디컬투데이 | 23.7h | Y | Y | **Y** |
| ins-S2-02 | S2(2622) | 삼성화재, 英 캐노피우스 3조에 인수…북미·유럽 특수보험 시장 공략 · 서울경제 | 삼성화재, 英 특수보험사 캐노피우스 지분 80%로 확대…해외시장 공략 · 알파경제 | 2.6h | Y | Y | **Y** |
| ins-S2-03 | S2(2622) | 현대해상, 성남시의료원 로비에 도서관…34번째 쉼터 · 중앙이코노미뉴스 | 현대해상, 성남시의료원에 ‘마음도서관’ 문 열어 · 핀포인트뉴스 | 6.3h | Y | Y | **Y** |
| ins-S2-04 | S2(2622) | 삼성화재, 영국 로이즈 캐노피우스 경영권 인수… 지분율 80.6%로 확대 · 한국보험신문 | 삼성화재, 2조2647억원 들여 英 캐노피우스 경영권 인수 · 더글로벌기빙뉴스 | 9.4h | Y | Y | **Y** |
| ins-S2-05 | S2(2622) | DB손보, ‘교통∙환경챌린지 8기’ 데모데이 개최...소셜벤쳐 5곳 성과 공유 · https://w… | [보험브리핑] DB손보, 교통·환경 소셜벤처 육성 데모데이 개최 외 · 서울파이낸스 | 2.8h | Y | Y | **Y** |
| ins-S2-06 | S2(2622) | 삼성화재, 英 보험사 로이즈 캐노피우스 경영권 인수 · Chosunbiz | 삼성화재, 2조2647억원 들여 英 캐노피우스 경영권 인수...해외사업 확대 · 녹색경제신문 | 7.5h | Y | Y | **Y** |
| ins-S2-07 | S2(2622) | 김연경 감독 원더독스, 흥국생명 상대 3세트 초반 10:0 리드…역스윕 도전 (‘신인… · MHN스포츠 | ‘신인감독 김연경2’ 원더독스, 흥국생명에 역전승…5주 연속 일요 예능 2054 1위 · 싱글리스트 | 71.4h | R | R | **R** |
| ins-S2-08 | S2(2622) | 삼성화재, 2.3조원 투입해 英 캐노피우스 경영권 품는다 · 조세일보 | 삼성화재, 캐노피우스 경영권에 2.3조원…미국 사업 수익성 과제 · 한국공제보험신문 | 28.3h | Y | R | **Y** ⚠ |
| ins-S2-09 | S2(2622) | 한화손보, 이대서울병원 內 친환경 치유 쉼터 ‘웰니스 존’ 조성 · 보험저널 | 한화손보, ‘웰니스 존’ 조성으로 친환경 치유센터 개소 · 한국보험신문 | 3.4h | Y | Y | **Y** |
| ins-S2-10 | S2(2622) | 한화손보, 이대서울병원에 '웰니스 존' 조성… 왕벚나무 80그루 식재 · 비즈트리뷴 | 한화손해보험, 이대서울병원에 친환경 쉼터 조성 · 팝콘뉴스 | 3.8h | Y | Y | **Y** |
| ins-S2-11 | S2(2622) | 현대해상, 성남시의료원에 '마음도서관' 조성… 병원에 독서·휴식 공간 마련 · Korea IT … | 현대해상, 성남시의료원에 ‘마음도서관’ 개관…환자·보호자 정서적 안정 지원 · 백세시대 | 5.1h | Y | Y | **Y** |
| ins-S2-12 | S2(2622) | 신경계질환 진단금, 중증도 높을수록 커진다…라이나생명 ‘통합특약’ 6개월 배타적사용권 · 보험저널 | 라이나생명, 신경계질환 진단특약 6개월 독점권 획득 · 경제타임스 | 0.8h | Y | Y | **Y** |
| ins-S2-13 | S2(2622) | KDB생명, 사망보험금 최대 2배 늘어나는 '더!행복플러스종신보험' 출시 · 뉴스1 | KDB생명, 사망보험금 체증형 종신보험 출시 · 포인트데일리 | 2.0h | Y | Y | **Y** |
| ins-S2-14 | S2(2622) | 우리금융그룹 ABL생명, ‘사람 살리는 금융’ 릴레이 캠페인 동참 · 퍼블릭뉴스통신 | 김철주 생보협회장, ‘사람 살리는 금융’ 캠페인 동참 · 경제타임스 | 0.0h | N | Y | **N** ⚠ |
| ins-S3-01 | S3(2660) | 삼성화재, 캐노피우스 품고 글로벌 영토 확장···수익성 개선 기대 · 뉴스웨이 | [분석] 삼성화재, 캐노피우스 경영권 인수로 글로벌 도약 · 메디컬투데이 | 0.3h | Y | Y | **Y** |
| ins-S3-02 | S3(2660) | '신인감독' 김연경, 흥국생명에 3대2 대역전 '2연승 쾌거' - 머니투데이 · 머니투데이 | ‘신인감독 김연경2’ 필승 원더독스, 흥국생명 상대로 5세트 끝 역전승 · 톱스타뉴스 | 5.1h | Y | Y | **Y** |
| ins-S3-03 | S3(2660) | 메리츠증권, 3분기 누적 순익 7205억…전년비 12% 증가 · 이데일리 | 메리츠화재, 3분기 누적 순익 1조3528억원···전년比 6.8%↓ · 서울파이낸스 | 0.8h | N | N | **N** |
| ins-S3-04 | S3(2660) | 차기 생보협회장 '민간' 무게 · DFT 대한금융신문 | 김철주 생보협회장, '사람 살리는 금융' 캠페인 동참 · 더팩트 | 17.8h | N | R | **N** ⚠ |
| ins-S3-05 | S3(2660) | 한화손보, 3Q 보험손익 209%↑ 전망…장기보험 반등 · PRESS9 | 삼성생명, 3Q 보험손익 반등 기대…CSM 성장 탄력 · PRESS9 | 23.5h | N | N | **N** |
| ins-S3-06 | S3(2660) | [포토] 교보생명, 보호아동과 베트남서 집짓기 봉사활동 · FETV | 교보생명, 베트남 취약가정 주택 4채 건립 지원…보호아동도 봉사 참여 · 로이슈 | 0.5h | Y | Y | **Y** |
| ins-S3-07 | S3(2660) | 메리츠화재, 3분기 누적 순이익 1조3528억원…전년比 6.8%↓ · 아주경제 | 메리츠화재 3Q 별도 순이익 3285억원…전년 동기 대비 29.2% 감소 · 뉴스저널리즘 | 0.4h | Y | Y | **Y** |
| ins-S3-08 | S3(2660) | KB라이프, 출범 후 줄곧 지배구조 ‘A’… ‘대표·이사회 분리’ 통했다 · 보험저널 | KB라이프, 지배구조 평가 4년 연속 A등급 · 보험매일 | 0.7h | Y | Y | **Y** |
| ins-S3-09 | S3(2660) | 한화손보, 3분기 누적 순익 3114억…장기보험손익 16.9%↑ · 파이낸셜투데이 | 한화손보, 3분기 순익 961억원 … 보험손익 개선에 34.1%↑ · 뉴데일리 | 1.3h | Y | Y | **Y** |
| ins-S3-10 | S3(2660) | 김철주 생명보험협회장, 생명존중 가치 바탕 ‘사람 살리는 금융’ 캠페인 동참 · 한국보험신문 | 김철주 생보협회장, 불법사금융 예방 캠페인 동참 · 뉴시스 | 6.0h | Y | R | **Y** ⚠ |
| ins-S3-11 | S3(2660) | ‘신인감독 김연경2’ 흥국생명 직관 경기 · BNT뉴스 | 김연경, '옛 주장' 표승주 꺾었다…흥국생명에 역전승, 최고 7.0% (신인감독2)[… · www.xport… | 15.1h | Y | R | **Y** ⚠ |
| ins-S3-12 | S3(2660) | DB손보, 소방공무원에 감사 쿠키·손편지 전달...안전문화 지원 이어가 · 더퍼블릭 | DB손보, 소방공무원 응원 봉사활동 · 보험매일 | 8.2h | Y | Y | **Y** |
| ins-S3-13 | S3(2660) | 보험연구원, 스위스 생갈렌대와 연구 교류…글로벌 협력 네트워크 확대 · 파이낸셜뉴스 | 보험연구원, 스위스 장크트갈렌대와 AI·사이버리스크 공동연구 · 한국경제 | 4.8h | Y | Y | **Y** |
| ins-S3-14 | S3(2660) | 자동차보험 '8주룰' 심사 본격화…손해율 개선 효과 주목 · 데일리안 | 실적 발표: Kemper, 자동차보험 손해율 개선에 2026년 3분기 예상 이익 상회 · Investing… | 33.0h | N | N | **N** |
| ins-S4-01 | S4(3869) | 한화證 “삼성화재, 캐노피우스 인수로 ROE 개선…연간 순익 2600억 원 증가 기대” · 팝콘뉴스 | 삼성화재, 3분기 누적 순익 1.86조…캐노피우스 투자손익 견인 - 머니투데이 · 머니투데이 | 26.8h | N | R | **N** ⚠ |
| ins-S4-02 | S4(3869) | 메리츠화재, 3분기 순익 3285억⋯전년比 29.2%↓ · 이투데이 | 한화손보, 3분기 누적 순익 3114억… 전년比 5.8%↑ · 글로벌이코노믹 | 17.1h | N | N | **N** |
| ins-S4-03 | S4(3869) | 삼성화재가 지분 80.56%로 품은 英 캐노피우스는 · 자본시장뉴스 | 삼성화재, 캐노피우스 품고 글로벌 영토 확장···수익성 개선 기대 · 뉴스웨이 | 21.4h | R | R | **R** |
| ins-S4-04 | S4(3869) | 메리츠화재, 보험손익 선방에도 투자손익 부진…3분기 순익 6.8% 감소 - 머니투데이 · 머니투데이 | 삼성화재, 3분기 누적 순익 1조8676억원…보험·투자손익 동반 증가 · 보험저널 | 17.3h | N | N | **N** |
| ins-S4-05 | S4(3869) | 김철주 생보협회장, '사람 살리는 금융' 릴레이 캠페인 동참 · 파이낸셜포스트 | ABL생명, 불법사금융 예방 ‘사람 살리는 금융’ 동참 · 한국보험신문 | 1.3h | N | Y | **N** ⚠ |
| ins-S4-06 | S4(3869) | DB손해보험, '마음을 잇다' 소방공무원 응원 봉사활동 실시 · 전자신문 | 교보생명, 보호아동과 함께 베트남 봉사활동 실시 · 보험신보 | 25.2h | N | N | **N** |
| ins-S4-07 | S4(3869) | 메리츠화재, 3분기 순익 3285억원…전년 대비 29.2%↓ · 더팩트 | 한화손보, 3분기 순익 961억원…작년 동기대비 34%↑ · www.ebn.c… | 13.8h | N | N | **N** |
| ins-S4-08 | S4(3869) | "차 안 타면 보험료 깎아준다"…롯데손보, 업계 첫 주차일수 할인 · 아시아경제 | 롯데손보, ‘주차한 날’도 보험료 최대 15% 할인 · 핀포인트뉴스 | 0.8h | Y | Y | **Y** |
| ins-S4-09 | S4(3869) | 국민연금 ‘11년지기 친구’ JP모건과 전 자산군 협력키로 · 매일경제 | "위탁운용에서 한발 더" 국민연금, JP모간자산운용과 협력확대 협약 - 머니투데이 · 머니투데이 | 0.3h | Y | Y | **Y** |
| ins-S4-10 | S4(3869) | 삼성화재, 英 특수보험사 캐노피우스 지분 80%로 확대…해외시장 공략 · 알파경제 | 삼성화재, 2.3조원 투입해 英 캐노피우스 경영권 품는다 · 조세일보 | 2.2h | Y | Y | **Y** |
| ins-S4-11 | S4(3869) | 현대해상, 성남시의료원에 ‘마음도서관’ 개관...정서적 회복 지원 · 스마트투데이 | 현대해상, 병원에 책과 휴식을 더하다…'마음도서관' 34곳 조성 · 뉴스1 | 0.4h | Y | Y | **Y** |
| ins-S4-12 | S4(3869) | 삼성화재 英 캐노피우스 인수 놓고 외신 "상당한 수익 거둘 것" · 더구루 | 삼성화재, 2조2647억원 들여 英 캐노피우스 경영권 인수 · 더글로벌기빙뉴스 | 10.7h | R | R | **R** |
| ins-S4-13 | S4(3869) | 메리츠금융, 보험·증권 엇갈린 실적…3분기 누적 순익 3.2%↓ - 머니투데이 · 머니투데이 | 메리츠금융, 3분기 순익 전년比 27% 감소…증시 악화에 화재 투자손익 급감 · 인베스트조선 | 1.4h | Y | Y | **Y** |
| ins-S4-14 | S4(3869) | 현대해상, AI 보험설계 지원 시스템 ‘Hi-헬퍼’ 도입 · 보험매일 | 현대해상, AI로 1분 만에 보험설계안 3종 생성 · 신아일보 | 0.4h | Y | Y | **Y** |
| ins-S5-01 | S5(7035) | 한화손보, 3분기 순이익 961억⋯전년비 34.1%↑ · 이투데이 | 한화손보, 3분기 누적 순익 3114억…신계약 CSM 1兆 · www.fetv.… | 0.5h | Y | Y | **Y** |
| ins-S5-02 | S5(7035) | [빅데이터로본다] 생명보험 2026년 11월 브랜드평판... 1위 교보생명, 2위 미… · 일간투데이 | 미래에셋, 개인투자용 국채 11월 청약…총발행규모 2천억원 · 연합뉴스 | 32.0h | N | N | **N** |
| ins-S5-03 | S5(7035) | 삼성생명 주가 7,500원 상승 후 장마감 · 아시아뉴스통신 | [오늘의 주목주] '실적 경계' 삼성화재 주가 5%대 내려, 코스피 외국인 순매수에 … · 비즈니스포스트 | 25.6h | N | N | **N** |
| ins-S5-04 | S5(7035) | [보험브리핑]롯데손보·카카오페이손보·DB손보 · 메트로신문 | [보험브리핑]현대해상·농협손보·ABL생명·DB생명 · 메트로신문 | 23.1h | N | N | **N** |
| ins-S5-05 | S5(7035) | 삼성화재, 영국 특종보험사 캐노피우스 경영권 인수 · DealSite경… | [오늘Who] 삼성화재 영국 보험사 품는다, 이문화 해외사업 성장판 확대 '3조 승부… · 비즈니스포스트 | 2.5h | Y | Y | **Y** |
| ins-S5-06 | S5(7035) | [함께가자 우리ESG] DB손해보험, 교통·환경챌린지 데모데이 성료 · 뉴스락 | 한화손해보험, 이대서울병원에 친환경 쉼터 조성 · 팝콘뉴스 | 7.5h | N | N | **N** |
| ins-S5-07 | S5(7035) | 한화손보, 3분기 순이익 961억⋯전년비 34.1%↑ · 이투데이 | 한화손보, 탄탄한 본업 체력…3분기 순익 키웠다 · DealSite경… | 0.9h | Y | Y | **Y** |
| ins-S5-08 | S5(7035) | NH농협생명, 경기 안성 양파농가 찾아 농촌일손돕기 실시 · 사회적경제뉴스 | 서울시·NH농협생명, 노숙인 농촌 단기 일경험 사업 첫발 · 핀포인트뉴스 | 69.3h | N | N | **N** |
| ins-S5-09 | S5(7035) | 삼성화재, 2~3년차 보장성보험 유지율 개선…25차월 76% · 토요경제 | 삼성화재 2.3조·DB손보 2.3조…보험사 해외 M&A 판 커진다 · 뉴스1 | 16.3h | N | N | **N** |
| ins-S5-10 | S5(7035) | 김철주 생명보험협회장, ‘사람 살리는 금융’ 릴레이 캠페인 동참 · 세계일보 | 금감원, 보험사 '릴레이 현장점검'…장기민원 해결 주력 · KB Think | 18.6h | N | N | **N** |
| ins-E-01 | E(20603) | 삼성화재, 2조2647억원 들여 英 캐노피우스 경영권 인수...해외사업 확대 · 녹색경제신문 | 삼성화재, 횡단보도 6명 중 1명 ′스몸비′…사고 67.5% 보행자 과실 0% · 메가경제 | 20.3h | N | N | **N** |
| ins-E-02 | E(20603) | 삼성생명, 2027년 순익 8조원 전망 · PRESS9 | 이주연 없어도 이겼다! 이해란 '21득점 9리바운드' 미친 활약, 삼성생명 신한은행에… · 마이데일리 | 7.5h | N | N | **N** |
| ins-E-03 | E(20603) | DB손해보험, ‘교통·환경챌린지 8기’ 데모데이 개최… 선정 5개 기업 성과 공유 · 퍼블릭뉴스통신 | 침수·화재 막는 벤처 육성…DB손보의 '소셜 혁신 8기' · 경제타임스 | 1.2h | Y | Y | **Y** |
| ins-E-04 | E(20603) | 삼성화재, '2조원대 베팅'에 커지는 기대와 부담…해외사업 '시험대' · 프라임경제 | 삼성화재 "횡단보도 6명 중 1명 스마트폰 사용…96% 좌우 확인 안 해" · 뉴스티앤티 | 5.0h | N | N | **N** |
| ins-E-05 | E(20603) | 한화손보 직원, 금융 AI 챌린지 대상…‘모의창구' 주목 · 경제타임스 | [더밸류 브리핑] 오늘의 손해보험사 소식…삼성화재·한화손보·NH 농협손보 · 더밸류뉴스 | 30.6h | N | N | **N** |
| ins-E-06 | E(20603) | 한화손해보험, 12일 컨퍼런스콜로 3분기 실적 발표 · 비건뉴스 | 한화손보, 3분기 누적 당기순익 3114억원…손해율 개선에 보험손익 껑충 · 이데일리 | 69.8h | R | R | **R** |
| ins-E-07 | E(20603) | 삼성화재, 英 특수보험사 인수… 수익원 다변화 · 세계일보 | 삼성화재, 3분기 순이익 8.3% 감소…자동차보험은 흑자 전환 · 한국경제 | 28.7h | N | R | **N** ⚠ |
| ins-E-08 | E(20603) | '우스만 개인 최다 33점' 한국전력, 삼성화재 꺾고 2연승(종합) · 연합뉴스 | 삼성화재 3분기 순이익 4천932억·8.3%↓…예상치 소폭 상회 · 연합인포맥스 | 34.6h | N | N | **N** |
| ins-R-01 | R(1063643) | 건보공단, 공공·민간보험 데이터 연계 추진 방향 논의…의료비 통합지원 모색 · 전자신문 | 메트라이프(MET) 주식은 40%의 가치 격차가 있음에도 불구하고 합리적인 수준으로 … · Simply Wa… | 40.3h | N | N | **N** |
| ins-R-02 | R(1063643) | [빅데이터투데이] 생명보험 2026년 11월 브랜드평판 랭킹... 1위 교보생명, 2… · 파이낸스투데이 | DB생명, 독서소외 아동에 '동화 목소리' 기부 · 포인트데일리 | 8.6h | N | N | **N** |
| ins-R-03 | R(1063643) | 산재보험급여 첫 8조원 돌파…수급자 42만명 육박 · 보험매일 | 대출금리 공시 얼마나 구체화하나…포용금융·소비자보호 평가 반영 검토 - 머니투데이 · 머니투데이 | 24.7h | N | N | **N** |
| ins-R-04 | R(1063643) | NH농협생명, 안성 양파농가 일손 돕기 나서 · 비즈월드 | [소비자 분쟁] 3대 생보사, 분쟁조정 22% 증가…보험금 갈등 심화 · FETV | 16.3h | N | N | **N** |
| ai-S1-01 | S1(6) | Meta releases Muse Ember, a $0.10-per-million-t… · MLQ.ai | Meta Releases Muse Ember, a 1M-Context Model fo… · MarkTechP… | 11.1h | Y | Y | **Y** |
| ai-S1-02 | S1(6) | 휴머노이드 로봇에 ‘제미나이 로보틱스 2.5’ 탑재…구글, 벤츠 생산라인서 작업 성공… · 인공지능신문 | 구글, '제미나이 로보틱스 2.5' 공개…공장 작업 성공률 96% · AI타임스 | 7.3h | Y | Y | **Y** |
| ai-S1-03 | S1(6) | Meta releases Muse Ember, a lightweight model f… · news.lavx… | Meta Launches Muse Ember, Lightweight AI Model … · Analytics… | 12.6h | Y | Y | **Y** |
| ai-S1-04 | S1(6) | Meta releases Muse Ember, a new lightweight mod… · TechCrunch | Meta Launches Muse Ember, Lightweight AI Model … · Analytics… | 15.5h | Y | Y | **Y** |
| ai-S1-05 | S1(6) | Meta releases Muse Ember, a new lightweight mod… · TechCrunch | Meta releases Muse Ember, a lightweight model f… · news.lavx… | 2.9h | Y | Y | **Y** |
| ai-S1-06 | S1(6) | Nvidia CEO Jensen Huang’s affair with alleged C… · TechCrunch | Congress to call Jensen Huang in to answer for … · TechCrunch | 26.3h | R | R | **R** |
| ai-S2-01 | S2(30) | Meta releases Muse Ember, a $0.10-per-million-t… · MLQ.ai | Meta releases Muse Ember, a lightweight model f… · news.lavx… | 1.3h | Y | Y | **Y** |
| ai-S2-02 | S2(30) | Meta Releases Muse Ember, a 1M-Context Model fo… · MarkTechP… | Meta Releases Muse Ember, a Low-Cost AI Model D… · Tekedia | 4.4h | Y | Y | **Y** |
| ai-S2-03 | S2(30) | Case Study - Rakuten · Anthropic | Case Study - Lilly · Anthropic | 0.0h | N | N | **N** |
| ai-S2-04 | S2(30) | Gemini 4 Argon: Built to solve your hardest pro… · Google De… | Gemini 4 Argon for Robotics · Google De… | 0.0h | R | R | **R** |
| ai-S2-05 | S2(30) | Case Study - Rakuten · Anthropic | Case Study - Walmart · Anthropic | 0.0h | N | N | **N** |
| ai-S2-06 | S2(30) | Meta releases Muse Ember, a lightweight model f… · news.lavx… | Meta Releases Muse Ember, a Low-Cost AI Model D… · Tekedia | 14.1h | Y | Y | **Y** |
| ai-S2-07 | S2(30) | Meta releases Muse Ember, a new lightweight mod… · TechCrunch | Meta releases Muse Ember, a $0.10-per-million-t… · MLQ.ai | 1.5h | Y | Y | **Y** |
| ai-S3-01 | S3(31) | Meta Launches Muse Ember, Lightweight AI Model … · Analytics… | Meta Releases Muse Ember, a Low-Cost AI Model D… · Tekedia | 1.5h | Y | Y | **Y** |
| ai-S3-02 | S3(31) | Meta Releases Muse Ember, a 1M-Context Model fo… · MarkTechP… | Meta Launches Muse Ember, Lightweight AI Model … · Analytics… | 2.9h | Y | Y | **Y** |
| ai-S3-03 | S3(31) | Meta Launches Muse Ember, a Low-Cost AI Model P… · Technolog… | Meta Releases Muse Ember, a Low-Cost AI Model D… · Tekedia | 0.1h | Y | Y | **Y** |
| ai-S3-04 | S3(31) | Meta launches Muse Ember for cost-efficient AI … · TechGig | Meta Launches Muse Ember, a Low-Cost AI Model P… · Technolog… | 10.1h | Y | Y | **Y** |
| ai-S3-05 | S3(31) | Appendix to “AI for Scientific Discovery: How R… · Anthropic | How scientists use Claude · Anthropic | 7.2h | R | R | **R** |
| ai-S3-06 | S3(31) | Meta launches Muse Ember, its most efficient AI… · The Econo… | Meta Releases Muse Ember, a Low-Cost AI Model D… · Tekedia | 14.4h | Y | Y | **Y** |
| ai-S3-07 | S3(31) | Google will let schools skip AI tools, but they… · Ars Techn… | Google: Schools can keep search while skipping … · Ars Techn… | 51.8h | R | Y | **R** ⚠ |
| ai-S4-01 | S4(169) | 앤트로픽, 86조원 규모 기업공개 가속…기업 가치 1880조원 목표, 나스닥 상장 위… · 인공지능신문 | TSMC, 자체 칩 개발 나선 오픈AI·앤트로픽에 최대 1.3조원 투자 · AI타임스 | 17.3h | N | N | **N** |
| ai-S4-02 | S4(169) | Congress to call Jensen Huang in to answer for … · TechCrunch | Jensen Huang accused of having another affair —… · TechCrunch | 3.9h | R | R | **R** |
| ai-S4-03 | S4(169) | Meta releases Muse Ember, a new lightweight mod… · TechCrunch | Introducing Our Smallest, Most Efficient Model:… · Meta AI | 2.4h | Y | Y | **Y** |
| ai-S4-04 | S4(169) | Is Jensen Huang’s bad behavior more commonplace… · TechCrunch | The unfolding Jensen Huang scandal: a timeline · TechCrunch | 7.6h | R | R | **R** |
| ai-S4-05 | S4(169) | Anthropic launches roadshow for proposed initia… · Anthropic | Anthropic launches Claude Meetings to turn work… · TechCrunch | 5.8h | N | N | **N** |
| ai-S4-06 | S4(169) | After challenging Google’s Android with Cyanoge… · TechCrunch | Google broadens its AI hardware portfolio with … · TechCrunch | 1.9h | N | N | **N** |
| ai-S4-07 | S4(169) | Franchisee reconciles cash in 94% less time wit… · OpenAI | Uber brings ChatGPT Work to all employees with … · OpenAI | 38.0h | N | N | **N** |
| ai-S5-01 | S5(2827) | Jensen Huang reportedly engaged a PR firm with … · TechCrunch | Meta Releases Muse Ember, a 1M-Context Model fo… · MarkTechP… | 7.1h | N | N | **N** |
| ai-S5-02 | S5(2827) | Heimstaden is changing residential real estate … · OpenAI | Dharma Field Extractor: Any Document In, Struct… · Hugging F… | 33.8h | N | N | **N** |
| ai-S5-03 | S5(2827) | Anthropic sets IPO price range of $70 to $78 pe… · TechCrunch | Nvidia CEO Jensen Huang’s affair with alleged C… · TechCrunch | 3.0h | N | N | **N** |
| ai-S5-04 | S5(2827) | Meta launches Muse Ember AI for coding and docu… · NewsBytes | AlphaGenome 2: Deciphering how cells read DNA t… · Google De… | 42.0h | N | N | **N** |
| ai-S5-05 | S5(2827) | OpenAI models are coming to Google Cloud · OpenAI | What FDE means at OpenAI · OpenAI | 18.0h | N | N | **N** |
| ai-E-01 | E(993) | 구글, AI 검색에 광고 수익성 악화…기업 인수까지 검토 · AI타임스 | '제미나이'가 기억하는 내 정보 한눈에 보여준다…수정·삭제도 가능 · AI타임스 | 2.6h | N | N | **N** |
| ai-E-02 | E(993) | Meta launches Muse Ember, its most efficient AI… · The Econo… | 메타, 100만 토큰 처리하는 초경량 AI ‘뮤즈 엠버’ 공개…앱 넘나들며 코딩·업무… · 인공지능신문 | 30.4h | Y | Y | **Y** |
| ai-E-03 | E(993) | "말만 하면 지도 앱이 완성된다”…구글, 제미나이·구글맵 결합해 AI 앱 개발 자동화 · 인공지능신문 | Google broadens its AI hardware portfolio with … · TechCrunch | 4.5h | N | N | **N** |
| ai-E-04 | E(993) | 구글, AI 반도체 ‘TPU 8i 맥스·8tx’ 공개…연산 성능 2배·데이터 처리 중… · 인공지능신문 | 앤트로픽, 클로드 오피스 출시…IPO 앞두고 MS·구글과 경쟁 · AI타임스 | 29.6h | N | N | **N** |
| ai-R-01 | R(22935) | Otter AI can now follow conversations across 30… · TechCrunch | [AI리더의 서가] AI는 어떻게 기업의 무기가 되는가 · AI타임스 | 41.0h | N | N | **N** |
| ai-R-02 | R(22935) | 메타, AI로 청소년 실제 나이 추정해 보호 기능 자동 적용…전 세계 수백만명 추가 … · 인공지능신문 | Otter AI can now follow conversations across 30… · TechCrunch | 4.4h | N | N | **N** |

## 2. 기사 중요도 94건

기준(1~5): 5 반드시 볼 것(제도·회계·감독 변경, 대형 M&A, 주요 모델 출시) · 4 볼 만함(주요사 실적·전략, 중요 상품·규제 동향) · 3 참고(일반 상품·업계 동향) · 2 낮음(홍보·인사·행사·주가) · 1 무관. 보험 채널은 보험계리 실무자, AI 채널은 AI 실무자 관점. 현재 ★을 보지 않고 제목·출처만 보고 판정.

두 판정자 완전 일치 62/94(66%), ±1 이내 94/94. 표본: 채널·현재 ★ 층화(★4·5가 드물어 많이 뽑음).

| id | 채널 | 제목 | 출처 | A | B |
|---|---|---|---|---|---|
| ins-rel2-01 | insurance | [보험브리핑] 현대해상, 성남시의료원에 '마음도서관' 개관 외 | 서울파이낸스 | 2 | 2 |
| ins-rel2-02 | insurance | 기후위기가 부른 사과 '열과현상'...보험 사각지대에 포항 농가 '눈물' | 글로벌경제신문 | 3 | 3 |
| ins-rel2-03 | insurance | 현대해상, 병원 로비를 열린 독서쉼터로..성남시의료원에 '마음도서관' 개관 | 한국정경신문 | 2 | 2 |
| ins-rel2-04 | insurance | 한화손보, 3분기 순익 34% 증가…보험손익 급증 | 스페셜경제 | 4 | 4 |
| ins-rel2-05 | insurance | [해피라이프]황반변성, 조기 발견이 관건…치료비 부담 줄이는 보험 점검법 | 이데일리 | 2 | 2 |
| ins-rel2-06 | insurance | 삼성화재 "횡단보도 보행자 6명 중 1명 스마트폰 사용"…사고 위험 경고 | 팝콘뉴스 | 2 | 2 |
| ins-rel2-07 | insurance | [3일 보험주 마감시황] 인카 0.95%↑·에이플러스 2.83%↓·삼성생명 3.33%↓ | 보험저널 | 2 | 2 |
| ins-rel2-08 | insurance | 현대해상 3세 승계 시동…정경선, 1200억대 증여세 마련 어쩌나 | ESG경제 | 2 | 2 |
| ins-rel2-09 | insurance | [INSIGHT] 유재훈 보험개발원장 “보험산업의 공정한 중재자 역할 강화” | 한국보험신문 | 3 | 3 |
| ins-rel2-10 | insurance | 금감원, 보험사 '릴레이 현장점검'…장기민원 해결 주력 | KB Think | 3 | 3 |
| ins-rel2-11 | insurance | 현대해상, 최신 암 치료·어린이 보장 강화한 다이렉트 보험 2종 출시 | 뉴스1 | 3 | 2 |
| ins-rel2-12 | insurance | 2028년부터 26만 간병인 산재보험 안전망에 편입 | 매일경제 | 3 | 3 |
| ins-rel2-13 | insurance | 공짜 강연인 줄 알았는데…보험 영업, 혹했다간 낭패 | 한국경제 | 2 | 2 |
| ins-rel2-14 | insurance | [보험 Pick] 메트라이프생명, 고객 서비스 강화…대상웰라이프·토스인슈어런스, 시니어케어·지역 영업 확대 | 라이센스뉴스 | 2 | 2 |
| ins-rel2-15 | insurance | “美 중간선거가 환율 가른다” 달러 약세냐 유가발 강세냐 | 한국경제 | 2 | 1 |
| ins-rel2-16 | insurance | SG "미래대응기금, 채권시장에 중요한 수급…단기채·크레딧 지지" | 연합뉴스 | 2 | 1 |
| ins-rel2-17 | insurance | 연금저축보험 수익률 아쉽다면 연금저축펀드로 갈아타세요 | 한국경제 | 2 | 2 |
| ins-rel2-18 | insurance | DB손보, '교통·환경챌린지 8기' 성과 공유…우수기업 선정 | 데일리안 | 2 | 2 |
| ins-rel3-01 | insurance | [소비자 분쟁] 3대 생보사, 민원 일제히 증가…절반 이상 보험금 | FETV | 3 | 3 |
| ins-rel3-02 | insurance | KDB생명, 10년간 사망보험금 늘어나는 종신보험 출시 | 코리아리포트 | 3 | 2 |
| ins-rel3-03 | insurance | 한화생명, 설계사용 'AI 비서' 도입…생·손보사 전방위 확산 | SBS Biz | 3 | 3 |
| ins-rel3-04 | insurance | 생보사, 번 돈보다 나간 돈이 1.2조 더 많아…신한라이프는 ‘역전’ 해소 | CEO스코어데일리 | 4 | 4 |
| ins-rel3-05 | insurance | “아이 근시 억제한다며 검사용 안약 장기 처방”… 정식 치료제 등장에 실손 심사 ‘도마’ | 보험저널 | 3 | 3 |
| ins-rel3-06 | insurance | 보험사 GA 관리 평가, 내부통제·점검 활동 살핀다 | 보험매일 | 4 | 3 |
| ins-rel3-07 | insurance | 동양생명, '우리WON하는건강플러스종신보험' 출시 - 머니투데이 | 머니투데이 | 3 | 2 |
| ins-rel3-08 | insurance | 금감원, 베트남·인니 보험감독당국 초청…보험사 해외진출 지원 | 뉴시스 | 2 | 2 |
| ins-rel3-09 | insurance | ABL생명, '게임'으로 보험설계사 업무 알린다 | 포인트데일리 | 2 | 2 |
| ins-rel3-10 | insurance | "금감원이 나서니 드디어 바뀌네"... 첫 자동차보험료, 61만 원 할인 받는 조건은? | 오토트리뷴 | 2 | 3 |
| ins-rel3-11 | insurance | 보험업권의 과도한 판매수수료 경쟁을 방지하고, 수수료에 대한 소비자의 알권리를 제고하기 위한 보험 판매수수… | 금융위원회 | 5 | 4 |
| ins-rel3-12 | insurance | 삼성화재 전기차보험 가입과 보장 내용…어떤 구조로 나뉘나 | 스페셜타임스 | 2 | 2 |
| ins-rel3-13 | insurance | [소비자 분쟁] 3대 생보사, 분쟁조정 22% 증가…보험금 갈등 심화 | FETV | 3 | 3 |
| ins-rel3-14 | insurance | 실손의료비 변천사 1~5세대 비교표 ／ is보험 보험안내자료 | 이즈보험 | 1 | 2 |
| ins-rel4-01 | insurance | 교통사고 경상환자 8주룰 도입…“추가치료 검토해달라” 하루 570건 | 부산일보 | 4 | 4 |
| ins-rel4-02 | insurance | 자녀 태운 부모 운전자까지…카카오페이손보, '운전자보험' 4개 플랜 개편 | 보험저널 | 3 | 2 |
| ins-rel4-03 | insurance | [한화손보 펨테크 리포트 ③] '디시전 메이커' 잡았다…여성 팬덤이 끌어올릴 CSM의 선순환 | 굿모닝경제 | 3 | 2 |
| ins-rel4-04 | insurance | “보험사·GA, 계약체결비용 산정기준 공유 어디까지?”… 4년 분급 앞두고 투명성 과제 | 보험저널 | 4 | 4 |
| ins-rel4-05 | insurance | 보험사, 코스피 급락에 채권·주식 손실 '연타' | 뉴스투데이 | 4 | 3 |
| ins-rel4-06 | insurance | Aon(AON) 주가, 재보험 사업 진출에도 불구하고 공정가치보다 23% 낮을 수 있어 | Simply Wall… | 2 | 2 |
| ins-rel4-07 | insurance | 살짝 다쳐도 “8주 이상 치료받겠다”…車보험 ‘8주룰’ 도입후 매일 570건 신청 | 매일경제 | 4 | 4 |
| ins-rel4-08 | insurance | 실손서 확인한 절감 효과…손보사, 다음은 ‘8주룰’ 손익 개선 | 파이낸셜투데이 | 4 | 4 |
| ins-rel4-09 | insurance | 실적 발표: Kemper, 자동차보험 손해율 개선에 2026년 3분기 예상 이익 상회 | Investing.c… | 2 | 2 |
| ins-rel4-10 | insurance | “실손보험료 좀 부담 됐었는데”…할인과 전환 제도로 낮출 수 있다는데 | 매일경제 | 2 | 2 |
| ins-rel5-01 | insurance | 실손보험 다섯번 개편해도 손보사 1.9조 적자늪 여전 | 매일경제 | 4 | 4 |
| ins-rel5-02 | insurance | 보험사 계리가정 관리 강화…금융위, 보험업감독규정 개정안 의결 | 아시아투데이 | 5 | 5 |
| ins-rel5-03 | insurance | 금감원 '계리가정 옐로카드'에 보험사 비상⋯ 연말 CSM 촉각 | 이투데이 | 5 | 5 |
| ins-rel5-04 | insurance | 계리가정보고서 도입 등 ｢보험업감독규정｣ 개정안 금융위원회 의결 | 금융위원회 | 5 | 5 |
| ins-rel5-05 | insurance | 계리가정보고서 도입 등 보험업감독규정 개정안 금융위원회 의결 | 금융감독원 | 5 | 5 |
| ins-rel5-06 | insurance | 고령화에 치솟는 의료비…“비급여·실손보험, 건강보험 연계 관리해야” | 한겨레 | 4 | 4 |
| ins-irr-01 | insurance | '2연승' 신한은행 최윤아 감독 "수비 좋아졌다, 이해란 더 막기 힘들어졌어"...삼성생명 이주연 손목 골… | 마이데일리 | 1 | 1 |
| ins-irr-02 | insurance | 금감원, 대형GA 잇단 고강도 검사…강경 기조에 업계 '긴장' | 전자신문 | 4 | 3 |
| ins-irr-03 | insurance | 신한은행, 삼성생명에 아쉬운 패배…개막 3연승 도전 실패 | 경인일보 | 1 | 1 |
| ins-irr-04 | insurance | OK저축은행, 삼성화재에 3-2 역전승⋯ | 이투데이 | 1 | 1 |
| ins-irr-05 | insurance | 반도체 꺾이자 돈 몰렸다…수익률 상위 10개 중 7개가 '이것' [이수의 ETF줌인] | 한국경제 | 1 | 1 |
| ins-irr-06 | insurance | 이찬진 금융감독원장, 은행지주 이사회 의장 간담회 개최 | 금융감독원 | 2 | 2 |
| ins-irr-07 | insurance | 금융회사 지배구조의 공정성과 투명성을 제고합니다. | 금융감독원 | 3 | 2 |
| ins-irr-08 | insurance | 라이나전성기재단 운영 한국전통호텔 ‘바랑재’, 5성급 획득 | 한국보험신문 | 1 | 1 |
| ai-rel2-01 | ai | How Block is building AI-powered security with OpenAI techn… | OpenAI | 2 | 2 |
| ai-rel2-02 | ai | Anima helps clinics cut call waits by 75% with GPT-6 and GP… | OpenAI | 2 | 1 |
| ai-rel2-03 | ai | Case Study - Legora | Anthropic | 2 | 1 |
| ai-rel2-04 | ai | With $720M round, Britain’s Fractile gets a leg up in the r… | TechCrunch | 3 | 4 |
| ai-rel2-05 | ai | 문샷, 중국서 엔비디아 최신 AI 칩 임대 정황…금융 문서 확인 | AI타임스 | 3 | 3 |
| ai-rel2-06 | ai | Supersonic airliner in doubt as company shifts to powering … | Ars Technica | 2 | 2 |
| ai-rel2-07 | ai | 디즈니, 어도비와 전용 AI 모델 공동 개발…영화·테마파크로 확대 | AI타임스 | 3 | 3 |
| ai-rel2-08 | ai | KT·마이크로소프트, 네트워크 문제 감지하는 AI 에이전트 개발…장애 탐지 10분에서 2~3분으로 단축 | 인공지능신문 | 3 | 2 |
| ai-rel2-09 | ai | "클로드는 어떻게 컴퓨터 화면을 하나의 언어처럼 읽는가"...김용덕 변리사, 앤트로픽의 화면 이해 특허 분석 | 인공지능신문 | 2 | 2 |
| ai-rel2-10 | ai | 중기부, 2030년까지 ‘AI 유니콘 20곳·데카콘 1곳' 키운다 | AI타임스 | 3 | 2 |
| ai-rel3-01 | ai | Lawsuit: Man introduced his wife to ChatGPT. She used it to… | Ars Technica | 2 | 2 |
| ai-rel3-02 | ai | More Performance From Every Byte: How Full-Stack Codesign S… | NVIDIA | 2 | 3 |
| ai-rel3-03 | ai | AI Is Changing How Semiconductor Fabs Work — and Engineers … | NVIDIA | 2 | 2 |
| ai-rel3-04 | ai | Founders’ letter | Anthropic | 4 | 3 |
| ai-rel3-05 | ai | 구글, AI 검색에 광고 수익성 악화…기업 인수까지 검토 | AI타임스 | 3 | 3 |
| ai-rel3-06 | ai | BotPsy: On-Device Personal Assistant with a Sub-Billion-Par… | Hugging Face | 2 | 2 |
| ai-rel3-07 | ai | OpenAI and Poland’s NASK partner to advance AI safety and s… | OpenAI | 3 | 3 |
| ai-rel3-08 | ai | 삼성전자, AI 엑스레이로 소아 방사선량 최대 45% 줄인다…‘GC85A Fit’ 출시 | 인공지능신문 | 2 | 2 |
| ai-rel3-09 | ai | Your Experts Have Partners. There's HOPE for Keeping Them T… | Hugging Face | 3 | 2 |
| ai-rel3-10 | ai | Google DeepMind and Singapore Government collaborate to bui… | Google Deep… | 3 | 3 |
| ai-rel3-11 | ai | Flipsnack grows product signups with conversion optimization | OpenAI | 2 | 1 |
| ai-rel3-12 | ai | MPS in PyTorch 2.15 | Hugging Face | 3 | 2 |
| ai-rel4-01 | ai | Welcome Le Chonk: Mistral Large 4 on Hugging Face | Hugging Face | 4 | 4 |
| ai-rel4-02 | ai | '페이블 5.2' 프롬프트 가이드 공개…"코드 맡기면 정리 5배 증가" | AI타임스 | 3 | 2 |
| ai-rel4-03 | ai | 삼성전자, AI 스타트업 1천개 육성 달성…30개사 중 15곳과 기술검증 추진 | 인공지능신문 | 2 | 2 |
| ai-rel4-04 | ai | Gemini 4 Carbon is now available | Google Deep… | 5 | 5 |
| ai-rel4-05 | ai | Pay for Hugging Face Hub with your Google Cloud Account | Hugging Face | 2 | 2 |
| ai-rel4-06 | ai | 바이트댄스, 100회 수정해도 이미지 유지하는 '시드림 5.5' 공개 | AI타임스 | 4 | 3 |
| ai-rel4-07 | ai | 엔스케일, 350억달러 IPO 연기 검토…AI 데이터센터 투자 불안 여파 | AI타임스 | 3 | 4 |
| ai-rel4-08 | ai | 구글, '제미나이 로보틱스 2.5' 공개…공장 작업 성공률 96% | AI타임스 | 4 | 4 |
| ai-rel5-01 | ai | 구글, '제미나이 4 카본' 정식 출시…'페이블 5.2'의 4분의 1 가격 | AI타임스 | 5 | 4 |
| ai-rel5-02 | ai | Meta Launches Muse Ember, a Low-Cost AI Model Priced Like C… | Technology … | 4 | 4 |
| ai-rel5-03 | ai | Introducing GPT-6.1 Terra | OpenAI | 5 | 5 |
| ai-rel5-04 | ai | NVIDIA Announces New Planned Investments in Korean Startups… | NVIDIA | 3 | 3 |
| ai-irr-01 | ai | Jensen Huang accused of having another affair — with an Nvi… | TechCrunch | 2 | 1 |
| ai-irr-02 | ai | 디 인포메이션 "젠슨 황 인맥으로 엔비디아 칩 10조원 규모 중국 공급" | AI타임스 | 3 | 4 |
| ai-irr-03 | ai | 젠슨 황, 불륜 인정 1년 전부터 '성 스캔들 전문' PR 업체 고용 | AI타임스 | 2 | 1 |
| ai-irr-04 | ai | ETRI, 국가보안기술연구소 신임 소장에 임정석 책임연구원 선임 | 인공지능신문 | 2 | 1 |
