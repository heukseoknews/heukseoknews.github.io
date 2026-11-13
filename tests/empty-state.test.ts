import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPTY_TEXT, emptyKind } from '../lib/emptyState.ts';

const k = (o: Partial<Parameters<typeof emptyKind>[0]>) => emptyKind({ filtered: false, date: 'default', tab: 'all', channelArticles: 100, ...o });
// 필터·검색 있음 + 0건 → 한 줄 + 필터 초기화(탭·데이터와 무관)
for (const tab of ['new', 'all', 'press', 'bookmarks'] as const) assert.equal(k({ filtered: true, tab }), 'filtered');
assert.equal(k({ filtered: true, channelArticles: 0 }), 'filtered');
assert.equal(EMPTY_TEXT.filtered, '조건에 맞는 기사가 없습니다');
// 필터 없음 + 0건 → 원인별 한 줄
assert.equal(k({ channelArticles: 0 }), 'noData');                 // 새 채널(금융 첫 수집 전 등)
assert.equal(k({ tab: 'new', channelArticles: 0 }), 'noData');
assert.equal(k({ tab: 'new' }), 'noNew');
assert.equal(k({ tab: 'bookmarks', channelArticles: 0 }), 'noBookmarks');  // 북마크는 데이터와 무관
// '전체 뉴스' 기간: 기본은 제한 없음 → 숨은 날짜 조건이 없어 0건이면 데이터가 없는 것 / 직접 고른 기간 → 조건에 맞는 기사 없음 / '오늘'을 직접 고름 → 오늘 문구 + [어제 보기]
assert.equal(k({ tab: 'all' }), 'none');
assert.ok(!('noRecent' in EMPTY_TEXT), '최근 3일 기본 문구 없음');
assert.equal(k({ tab: 'all', date: 'changed' }), 'filtered');
assert.equal(k({ tab: 'all', date: 'today' }), 'noToday');
assert.equal(EMPTY_TEXT.noToday, '오늘 올라온 기사가 아직 없습니다');
assert.equal(k({ tab: 'all', date: 'today', filtered: true }), 'filtered', '오늘 + 다른 조건이면 필터 초기화');
assert.equal(k({ tab: 'new', date: 'today' }), 'filtered', '다른 탭에서 고른 날짜는 필터');
assert.equal(k({ tab: 'all', channelArticles: 0 }), 'noData');
assert.equal(k({ tab: 'press' }), 'noPress');
assert.equal(EMPTY_TEXT.noData, '아직 모은 기사가 없습니다');
assert.equal(EMPTY_TEXT.noNew, '새 기사가 없습니다');
assert.equal(EMPTY_TEXT.noBookmarks, '북마크한 기사가 없습니다');

// 화면: 조건별 진단('해제하면 N건'·'해제해도 0건'·'하나씩 해제')은 없고, 초기화 버튼은 필터가 있을 때만
const page = readFileSync('app/[channel]/page.tsx', 'utf8');
for (const t of ['해제해도', '`해제하면 $', '하나씩 해제', 'emptyFilters', 'countWithout', 'countBase']) assert.ok(!page.includes(t), `page: ${t} 없음`);
assert.ok(page.includes("{empty === 'filtered' && <button type=\"button\" className=\"confirm\" onClick={resetFilters}>필터 초기화</button>}"));
assert.ok(!page.includes('noRecent') && !page.includes('전체 기간 보기'));
assert.ok(page.includes("{empty === 'noToday' &&") && page.includes('어제 보기'));
// 필터 초기화는 카테고리·검색·언론사·보험사·기관·안 읽은 것만·관련도 낮음·날짜를 모두 되돌린다
const reset = /const resetFilters = \(\) => \{([\s\S]*?)\n  \};/.exec(page)![1];
for (const f of ["setCategory('전체')", "setSearch('')", 'setSources([])', 'setOrgs([])', 'setCompanies([])', 'setUnreadOnly(false)', 'setIncludeLow(false)', 'delete n[tab]'])
  assert.ok(reset.includes(f), `resetFilters: ${f}`);
console.log('empty-state tests passed');
