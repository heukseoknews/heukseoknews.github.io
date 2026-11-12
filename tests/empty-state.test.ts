import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPTY_TEXT, emptyKind } from '../lib/emptyState.ts';

const k = (o: Partial<Parameters<typeof emptyKind>[0]>) => emptyKind({ filtered: false, tab: 'all', channelArticles: 100, todayDefault: false, ...o });
// 필터·검색 있음 + 0건 → 한 줄 + 필터 초기화(탭·데이터와 무관)
for (const tab of ['new', 'all', 'press', 'bookmarks'] as const) assert.equal(k({ filtered: true, tab }), 'filtered');
assert.equal(k({ filtered: true, channelArticles: 0 }), 'filtered');
assert.equal(EMPTY_TEXT.filtered, '조건에 맞는 기사가 없습니다');
// 필터 없음 + 0건 → 원인별 한 줄
assert.equal(k({ channelArticles: 0 }), 'noData');                 // 새 채널(금융 첫 수집 전 등)
assert.equal(k({ tab: 'new', channelArticles: 0 }), 'noData');
assert.equal(k({ tab: 'new' }), 'noNew');
assert.equal(k({ tab: 'bookmarks', channelArticles: 0 }), 'noBookmarks');  // 북마크는 데이터와 무관
assert.equal(k({ tab: 'all', todayDefault: true }), 'noToday');
assert.equal(k({ tab: 'press' }), 'noPress');
assert.equal(EMPTY_TEXT.noData, '아직 모은 기사가 없습니다');
assert.equal(EMPTY_TEXT.noNew, '새 기사가 없습니다');
assert.equal(EMPTY_TEXT.noBookmarks, '북마크한 기사가 없습니다');

// 화면: 조건별 진단('해제하면 N건'·'해제해도 0건'·'하나씩 해제')은 없고, 초기화 버튼은 필터가 있을 때만
const page = readFileSync('app/[channel]/page.tsx', 'utf8');
for (const t of ['해제해도', '`해제하면 $', '하나씩 해제', 'emptyFilters', 'countWithout', 'countBase']) assert.ok(!page.includes(t), `page: ${t} 없음`);
assert.ok(page.includes("{empty === 'filtered' && <button type=\"button\" className=\"confirm\" onClick={resetFilters}>필터 초기화</button>}"));
// 필터 초기화는 카테고리·검색·언론사·보험사·기관·안 읽은 것만·관련도 낮음·날짜를 모두 되돌린다
const reset = /const resetFilters = \(\) => \{([\s\S]*?)\n  \};/.exec(page)![1];
for (const f of ["setCategory('전체')", "setSearch('')", 'setSources([])', 'setOrgs([])', 'setCompanies([])', 'setUnreadOnly(false)', 'setIncludeLow(false)', 'delete n[tab]'])
  assert.ok(reset.includes(f), `resetFilters: ${f}`);
console.log('empty-state tests passed');
