import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clearPanel, dateChip, dateChipLabel, onTabChange, panelChips, removeChip, type PanelFilters } from '../lib/filterState.ts';

// 필터 접기: 켜진 필터만 칩으로, 칩에서 바로 해제, 초기화, 탭 이동 시 보험사 선택 유지
const L = { sources: '언론사', companies: '보험사', orgs: '유관기관' };
const none: PanelFilters = { sources: [], companies: [], orgs: [], unreadOnly: false, includeLow: false };
assert.deepEqual(panelChips(none, L, 'new'), [], '아무것도 안 켜면 칩 없음');

const f: PanelFilters = { sources: ['연합뉴스', '이데일리'], companies: ['삼성화재'], orgs: ['금융감독원'], unreadOnly: true, includeLow: true };
const chips = panelChips(f, L, 'new');
assert.deepEqual(chips.map(c => c.key), ['companies:삼성화재', 'orgs:금융감독원', 'sources:연합뉴스', 'sources:이데일리', 'unread', 'low']);
assert.deepEqual(chips.map(c => [c.kindLabel ?? '', c.label]), [['보험사', '삼성화재'], ['유관기관', '금융감독원'], ['언론사', '연합뉴스'], ['언론사', '이데일리'], ['', '안 읽은 것만'], ['', '관련도 낮은 기사 포함']]);
assert.ok(!panelChips(f, L, 'bookmarks').some(c => c.kind === 'low'), '북마크 탭에는 관련도 칩 없음(그 탭에서 쓰지 않음)');

// 칩 하나 해제: 그 값만 빠지고 나머지는 그대로(배열 참조도 유지 → 보험사 저장은 바뀔 때만)
const r1 = removeChip(f, { kind: 'sources', value: '연합뉴스' });
assert.deepEqual(r1.sources, ['이데일리']); assert.equal(r1.companies, f.companies); assert.equal(r1.unreadOnly, true);
const r2 = removeChip(f, { kind: 'companies', value: '삼성화재' });
assert.deepEqual(r2.companies, []); assert.equal(r2.sources, f.sources);
assert.equal(removeChip(f, { kind: 'unread' }).unreadOnly, false);
assert.equal(removeChip(f, { kind: 'low' }).includeLow, false);
assert.deepEqual(removeChip(f, { kind: 'orgs', value: '없는 기관' }).orgs, ['금융감독원']);

// 초기화: 패널 필터 전부 해제
assert.deepEqual(clearPanel(f), none);

// 탭 이동: 언론사·유관기관만 풀고 보험사(저장되는 선택)와 체크는 유지 — 이전 동작과 같다
const t = onTabChange(f);
assert.deepEqual(t.sources, []); assert.deepEqual(t.orgs, []);
assert.equal(t.companies, f.companies, '보험사 선택 유지'); assert.equal(t.unreadOnly, true); assert.equal(t.includeLow, true);

// 화면 연결: 패널은 hidden 으로 접고, 버튼은 aria-expanded·aria-controls, Esc 로 닫고 버튼으로 포커스, 보험사는 사용자 상태(setCompanies)로 저장
const page = readFileSync('app/[channel]/page.tsx', 'utf8');
assert.match(page, /id="filterPanel"[^>]*hidden=\{!filterOpen\}/);
assert.match(page, /aria-expanded=\{filterOpen\} aria-controls="filterPanel"/);
// 패널을 열면 첫 항목(언론사 버튼)으로 포커스, 처음 화면(닫힘)에서는 옮기지 않는다
assert.match(page, /useEffect\(\(\) => \{ if \(filterOpen\) filterPanel\.current\?\.querySelector<HTMLElement>\('button, input'\)\?\.focus\(\); \}, \[filterOpen\]\)/);
assert.match(page, /<div ref=\{filterPanel\} id="filterPanel"/);
assert.ok(page.indexOf('<MultiFilter label={L.sources}') < page.indexOf('<MultiFilter label={L.companies}'), '패널 첫 항목은 언론사');
assert.match(page, /e\.key !== 'Escape'[\s\S]{0,120}setFilterOpen\(false\); filterBtn\.current\?\.focus\(\)/);
assert.ok(page.includes('setPanel(removeChip(panel, c))') && page.includes('setPanel(onTabChange(panel))') && page.includes('panelChips(panel, L, tab)'));
assert.match(page, /if \(n\.companies !== companies\) setCompanies\(n\.companies\)/);
assert.match(page, /const companies = saved\.companies;/, '보험사 선택은 사용자 상태(저장)에서 읽는다');
for (const k of ['MultiFilter label={L.sources}', 'MultiFilter label={L.companies}', 'MultiFilter label={L.orgs}', '안 읽은 것만', '관련도 낮은 기사 포함', 'className="filterReset"']) assert.ok(page.includes(k), `패널 안: ${k}`);

// 날짜 조건 칩: '전체 기간'이 아니면 칩(기본 '오늘' 포함), 문구는 짧게
const TODAY = '2026-11-12';  // 목요일, 이번 주 = 11-09(월)~11-15(일)
assert.equal(dateChip(null, TODAY), null, '전체 기간이면 칩 없음');
assert.deepEqual(dateChip({ from: TODAY, to: TODAY }, TODAY), { key: 'date', kind: 'date', kindLabel: '날짜', label: '오늘' });
assert.equal(dateChipLabel({ from: '2026-11-11', to: '2026-11-11' }, TODAY), '어제');
assert.equal(dateChipLabel({ from: '2026-11-02', to: '2026-11-02' }, TODAY), '11월 2일');
const [ws, we] = [(await import('../lib/dates.ts')).weekRange(TODAY)][0];
assert.equal(dateChipLabel({ from: ws, to: we }, TODAY), '이번 주');
assert.equal(dateChipLabel({ from: '2026-11-06', to: '2026-11-12' }, TODAY), '11월 6일~11월 12일');
assert.deepEqual(removeChip(f, { kind: 'date' }), f, '날짜 칩 해제는 화면이 날짜를 전체 기간으로');
// 화면: 날짜 칩은 칩 줄 맨 앞·필터 버튼 배지에 포함, 해제하면 전체 기간, 빈 화면 판단에서 기본 '오늘'만이면 필터 아님(38 그대로)
const pg = readFileSync('app/[channel]/page.tsx', 'utf8');
assert.ok(pg.includes("const chips = [...(dChip ? [dChip] : []), ...panelChips(panel, L, tab)];"));
assert.ok(pg.includes("필터{chips.length > 0 && <b aria-label={`켜진 필터 ${chips.length}개`}>{chips.length}</b>}"));
assert.ok(pg.includes("if (c.kind === 'date') { setDateFilter(null); setPage(1); }"));
assert.ok(pg.includes("dateFilter && { key: 'date',"), '필터 초기화 배지에도 날짜 포함');
assert.ok(pg.includes("filtered: active.some(f => f.key !== 'date' || dateChanged)"));
// 마이페이지 목록 버튼 이름 = 필터 초기화
const me = readFileSync('app/me/page.tsx', 'utf8');
assert.ok(me.includes('필터 초기화') && !me.includes('조건 모두 해제'));
console.log('filters tests passed');
