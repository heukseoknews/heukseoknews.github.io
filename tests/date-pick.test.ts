import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QUICK, dataBounds, lastDays, monthsBetween, moveDay, nextOlder, overlaps, pickDay, quickRange, sameRange, selectable } from '../lib/datePick.ts';
import { visibleInNewTab } from '../lib/newsFilter.ts';
import { defaultDate } from '../lib/filterState.ts';

// 기간 고르기(전체 뉴스 달력). 기본 '기간 제한 없음'은 filters.test.ts, 빈 화면은 empty-state.test.ts
const TODAY = '2026-11-13';

// ---------- 하루·기간 선택: 첫 번째 = 그 하루(바로 적용)이자 시작, 두 번째 = 기간(순서 무관), 세 번째는 새로 시작 ----------
let s = pickDay(null, '2026-11-03');
assert.deepEqual(s, { range: { from: '2026-11-03', to: '2026-11-03' }, anchor: '2026-11-03' }, '하나만 누르면 그 하루');
s = pickDay(s.anchor, '2026-11-10');
assert.deepEqual(s, { range: { from: '2026-11-03', to: '2026-11-10' }, anchor: null }, '두 번째로 누르면 기간');
assert.deepEqual(pickDay('2026-11-10', '2026-11-03').range, { from: '2026-11-03', to: '2026-11-10' }, '거꾸로 눌러도 기간');
assert.deepEqual(pickDay('2026-11-05', '2026-11-05'), { range: { from: '2026-11-05', to: '2026-11-05' }, anchor: null }, '같은 날 두 번이면 그 하루로 끝');
assert.equal(pickDay(null, '2026-11-01').anchor, '2026-11-01', '끝낸 뒤 다시 누르면 새 시작');

// ---------- 빠른 선택: 오늘·3일·7일·30일·이번 달 ----------
assert.deepEqual(QUICK.map(q => q.label), ['오늘', '3일', '7일', '30일', '이번 달']);
assert.deepEqual(quickRange('today', TODAY), { from: TODAY, to: TODAY });
assert.deepEqual(quickRange('d3', TODAY), { from: '2026-11-11', to: TODAY });
assert.deepEqual(quickRange('d7', TODAY), { from: '2026-11-07', to: TODAY });
assert.deepEqual(quickRange('d30', TODAY), { from: '2026-10-15', to: TODAY });
assert.deepEqual(quickRange('month', TODAY), { from: '2026-11-01', to: TODAY });
assert.deepEqual(lastDays('2026-12-01', 3), { from: '2026-11-29', to: '2026-12-01' }, '월 경계');
assert.ok(sameRange(quickRange('d7', TODAY), { from: '2026-11-07', to: TODAY }) && !sameRange(null, quickRange('today', TODAY)));

// ---------- 데이터 범위(첫 기사~마지막 기사) 밖 날짜 거절 ----------
const art = (iso: string) => ({ published_at: iso });
const arts = [art('2026-10-20T03:00:00Z'), art('2026-11-12T23:30:00Z' /* KST 11-13 08:30 */), art('2026-11-01T00:00:00Z')];
const b = dataBounds(arts, ['2026-11', '2026-10'], ['2026-11', '2026-10'], TODAY)!;
assert.deepEqual(b, { min: '2026-10-20', max: '2026-11-13' }, 'KST 날짜 기준 첫 기사~마지막 기사');
assert.equal(selectable('2026-10-19', b), false, '첫 기사 전날은 누를 수 없음');
assert.equal(selectable('2026-10-20', b), true);
assert.equal(selectable('2026-11-14', b), false, '마지막 기사 뒤는 누를 수 없음');
assert.equal(selectable('2026-11-01', null), false, '데이터가 없으면 아무 날도 못 누름');
assert.deepEqual(dataBounds(arts, ['2026-11', '2026-10', '2026-03'], ['2026-11', '2026-10'], TODAY)!.min, '2026-03-01', '가장 오래된 달을 아직 안 불러왔으면 그 달 1일부터');
assert.deepEqual(dataBounds([art('2026-11-20T00:00:00Z')], ['2026-11'], ['2026-11'], TODAY), null, '미래 기사만 있으면 범위 없음');
assert.equal(dataBounds([], ['2026-11'], [], TODAY), null);
// 빠른 선택은 범위와 겹칠 때만(오늘 기사가 아직 없으면 '오늘'은 누를 수 없음)
const noToday = { min: '2026-10-20', max: '2026-11-12' };
assert.equal(overlaps(quickRange('today', TODAY), noToday), false);
assert.equal(overlaps(quickRange('d3', TODAY), noToday), true);
assert.equal(overlaps(quickRange('today', TODAY), null), false);

// ---------- 키보드: 방향키 하루·한 주, PageUp/Down 한 달, 범위 끝에서 멈춤 ----------
assert.equal(moveDay('2026-11-10', 'ArrowRight', b), '2026-11-11');
assert.equal(moveDay('2026-11-10', 'ArrowLeft', b), '2026-11-09');
assert.equal(moveDay('2026-11-10', 'ArrowUp', b), '2026-11-03');
assert.equal(moveDay('2026-11-10', 'ArrowDown', b), '2026-11-13', '범위 끝(마지막 기사 날)에서 멈춤');
assert.equal(moveDay('2026-10-21', 'ArrowUp', b), '2026-10-20', '범위 시작에서 멈춤');
assert.equal(moveDay('2026-11-10', 'PageUp', b), '2026-10-20', '한 달 앞(범위로 보정)');
assert.equal(moveDay('2026-03-31', 'PageUp', { min: '2026-01-01', max: '2026-12-31' }), '2026-02-28', '말일 보정');
assert.equal(moveDay('2026-11-10', 'Enter', b), null, '다른 키는 무시');

// ---------- 불러올 월: 기간에 걸친 달(KST 1일 새벽 대비 앞날 포함), 제한 없음은 최근 달부터 순서대로 ----------
assert.deepEqual(monthsBetween({ from: '2026-11-03', to: '2026-11-10' }), ['2026-11']);
assert.deepEqual(monthsBetween({ from: '2026-11-01', to: '2026-11-10' }), ['2026-10', '2026-11']);
assert.deepEqual(monthsBetween({ from: '2026-06-15', to: '2026-09-02' }), ['2026-06', '2026-07', '2026-08', '2026-09'], '기간 중간 달도 빠짐없이');
const months = [{ month: '2026-11', bytes: 2_000_000 }, { month: '2026-10', bytes: 70_000 }, { month: '2026-09', bytes: 2_000 }, { month: '2026-08', bytes: 1_000 }];
assert.equal(nextOlder(months, 0, false), 1, '합계 3MB 안이면 다음 과거 달을 자동으로');
assert.equal(nextOlder(months, 2, false), 2, '더 없으면 그대로');
const big = [{ month: '2027-05', bytes: 5_000_000 }, { month: '2027-04', bytes: 5_000_000 }, { month: '2027-03', bytes: 5_000_000 }];
assert.equal(nextOlder(big, 0, false), 0, '큰 달(5MB)은 자동으로 더 불러오지 않음');
assert.equal(nextOlder(big, 0, true), 1, '목록 끝 페이지에 닿으면 한 달 더');

// ---------- 화면 연결 ----------
const bar = readFileSync('components/DateBar.tsx', 'utf8');
assert.match(bar, /disabled=\{!ok\}/, '범위 밖 날짜 버튼은 비활성');
assert.match(bar, /if \(!selectable\(d, bounds\)\) return;/, '눌러도 무시(이중 확인)');
assert.match(bar, /e\.key === 'Escape'[\s\S]{0,60}close\(true\)/, 'Esc 로 닫고 달력 버튼으로 포커스');
assert.match(bar, /tabIndex=\{roving \? 0 : -1\}/, '날짜는 한 칸만 Tab 으로(방향키로 이동)');
assert.match(bar, /onChange\(null\); close\(false\); \}\}>기간 해제<\/button>/);
assert.ok(!/어제|이번 주|RECENT_DAYS/.test(bar), '옛 빠른 버튼 없음');
const page = readFileSync('app/[channel]/page.tsx', 'utf8');
assert.match(page, /nextOlder\(indexMonths, older, curPage >= lastPage\)/);
assert.match(page, /if \(tab !== 'all' \|\| dateFilter \|\| search\.trim\(\)/, '과거 달 이어 받기는 전체 뉴스·제한 없음일 때만');
assert.match(page, /\.\.\.\(dateFilter \? monthsBetween\(dateFilter\) : \[\]\)/);
const css = readFileSync('app/globals.css', 'utf8');
assert.match(css, /\.calHint\{[^}]*min-height:19px/, '안내 줄 자리를 잡아 달력 높이 고정');

// ---------- 새 뉴스 탭 불변: 날짜 기본 없음, 범위는 '마지막 확인' 기준 그대로 ----------
assert.equal(defaultDate('new', TODAY), null);
const baseline = '2026-11-10T00:00:00Z';
const A = { id: 'a', published_at: '2026-11-09T00:00:00Z', collected_at: '2026-11-11T00:00:00Z' };
assert.equal(visibleInNewTab(A, { baseline, dismissed: new Set(), includeDismissed: false }), true);
assert.equal(visibleInNewTab({ ...A, collected_at: '2026-11-09T12:00:00Z' }, { baseline, dismissed: new Set(), includeDismissed: false }), false);
console.log('date-pick tests passed');
