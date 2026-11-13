import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isNewArticle, isPendingNew, visibleInNewTab } from '../lib/newsFilter.ts';
import { DISMISS_HARD, KEEP_DAYS, addDismissed, cleanDismissed, fromReads, mergeDismissed, pruneDismissed, removeDismissed, type Dismissed } from '../lib/dismissed.ts';
import { addRead } from '../lib/readState.ts';
import { EMPTY_STATE, fromStored, mergeStates, toStored, type UserState } from '../lib/userState.ts';
import { localStorageStore } from '../lib/storage.ts';
import { addBookmark, isLive, removeBookmark } from '../lib/bookmarks.ts';
import { clearPanel, onTabChange, panelChips, removeChip, badgeCount, type PanelFilters } from '../lib/filterState.ts';
import { emptyKind } from '../lib/emptyState.ts';

// 시나리오: 어제 10:00에 확인 완료. 오늘 09:00에 수집됐지만 발행은 어제 08:00 (구글 검색에 늦게 잡힘)
const baseline = '2026-11-03T10:00:00+00:00';
const late = { published_at: '2026-11-03T08:00:00+00:00', collected_at: '2026-11-04T09:00:00+00:00' };
assert.equal(isNewArticle(late, baseline), true, '늦게 수집된 과거 발행 기사가 새 뉴스에서 빠짐');
assert.equal(late.published_at > baseline, false, '(참고) 발행시각 기준이면 누락되는 케이스');

// 확인 이전에 수집된 기사는 새 뉴스가 아님
assert.equal(isNewArticle({ published_at: '2026-11-03T05:00:00+00:00', collected_at: '2026-11-03T09:00:00+00:00' }, baseline), false);
// 첫 방문은 전체
assert.equal(isNewArticle(late, null), true);
// 확인 완료 직후 새로고침해도 기준 유지 → 같은 기사들은 계속 새 뉴스 아님
assert.equal(isNewArticle(late, '2026-11-04T10:00:00+00:00'), false);

// --- 읽음(링크를 연 것)과 치우기(목록에서 빼기)는 별개 ---
const A = { id: 'a', ...late };                       // 확인 이후 수집(새 뉴스 대상)
const B = { id: 'b', published_at: '2026-11-04T01:00:00+00:00', collected_at: '2026-11-04T09:30:00+00:00' };
const OLD = { id: 'old', published_at: '2026-11-03T05:00:00+00:00', collected_at: '2026-11-03T09:00:00+00:00' }; // 확인 이전 수집
const none = new Set<string>();
const ids = (d: Dismissed) => new Set(d.map(e => e.id));
const vis = (x: typeof A, d: Dismissed, includeDismissed = false, leaving?: Set<string>) => visibleInNewTab(x, { baseline, dismissed: ids(d), includeDismissed, leaving });
const count = (d: Dismissed) => [A, B, OLD].filter(x => isPendingNew(x, baseline, ids(d))).length;

// 1) 링크를 열면 읽음만 기록되고 새 뉴스 목록·건수에는 그대로 남는다(읽은 뒤 북마크할 수 있게)
{
  const st0: UserState = { ...EMPTY_STATE, lastConfirmed: baseline };
  const read: UserState = { ...st0, readAt: addRead(st0.readAt, 'a', '2026-11-05T01:00:00.000Z') };
  assert.deepEqual(read.dismissed, [], '읽음은 치운 기록을 건드리지 않음');
  assert.equal(vis(A, read.dismissed), true, '링크 클릭 후에도 목록에 남음');
  assert.equal(count(read.dismissed), 2, '읽었지만 치우지 않은 기사는 건수에 남음');
  // 화면 연결: 링크 클릭 처리(handleRead)는 읽음 기록(markRead)뿐, 치우기는 [치우기] 버튼에서만
  const page = readFileSync('app/[channel]/page.tsx', 'utf8');
  assert.match(page, /const handleRead = markRead;/);
  assert.ok(!/showRead|justRead|hiddenReadCount|isUnreadNew/.test(page), '옛 읽음=숨김 경로 없음');
  assert.match(page, /onDismiss: handleDismiss, onRestore: handleRestore/);
  assert.match(page, /dismiss=\{tab === 'new' \?/, '[치우기]는 새 뉴스 탭에만');
  assert.match(page, /<span>치웠습니다<\/span><button type="button" onClick=\{handleUndo\}>되돌리기<\/button>/);
  const card = readFileSync('components/ArticleCard.tsx', 'utf8');
  assert.match(card, /className=\{'article' \+ \(read \? ' isRead' : ''\)/, '읽음 표시는 모든 탭에서 같게(dim 조건 없음)');
  assert.match(card, /aria-label="치우기\(새 뉴스에서 빼기\)"[^>]*className="readBtn dismissBtn"/, '버튼 칸은 예전 읽음 버튼과 같은 크기·자리');
  assert.match(card, /onClick=\{\(\) => onRead\(a\.id\)\}/);
  assert.ok(card.indexOf('dismiss.onDismiss(a.id)') > card.indexOf('className="cardActions"'), '치우기는 버튼 칸에만(링크에는 없음)');
}

// 2) 치우면 사라지고(짧게 흐려지는 동안은 유지) 되돌리면 돌아온다, 건수도 함께
{
  const t = '2026-11-05T02:00:00.000Z';
  const d1 = addDismissed([], ['a'], t);
  assert.deepEqual(d1, [{ id: 'a', at: t }], 'id·치운 시각의 단순 목록');
  assert.equal(addDismissed(d1, ['a'], '2026-11-06T00:00:00.000Z'), d1, '이미 치운 기사는 그대로');
  assert.equal(vis(A, d1), false, '치우면 사라짐');
  assert.equal(vis(A, d1, false, new Set(['a'])), true, '사라지는 중(0.25초)에는 잠깐 유지');
  assert.equal(count(d1), 1, '치우면 건수 1 감소');
  const back = removeDismissed(d1, ['a']);
  assert.equal(vis(A, back), true, '되돌리면 복귀'); assert.equal(count(back), 2);
  assert.equal(removeDismissed(back, ['zz']), back);
  // 같은 사건 여러 기사를 한 번에
  assert.deepEqual(addDismissed([], ['a', 'b'], t).map(e => e.id), ['a', 'b']);
  // 치워도 새 뉴스 범위 밖 기사는 원래 안 나옴
  assert.equal(vis(OLD, [], true), false);
  assert.equal(isPendingNew(OLD, baseline, none), false);
  // 첫 방문(기준 없음)은 치우지 않은 전체
  assert.equal(visibleInNewTab(A, { baseline: null, dismissed: none, includeDismissed: false }), true);
}

// 3) '치운 기사 포함' 칩: 기본 꺼짐(숨김), 켜면 흐리게 보이고, 기본과 다르면 칩 + 배지, 새 뉴스 탭에만
{
  const d = addDismissed([], ['a'], '2026-11-05T02:00:00.000Z');
  assert.equal(vis(A, d, true), true, '켜면 치운 기사도 보임');
  const L = { sources: '언론사', companies: '보험사', orgs: '유관기관' };
  const off: PanelFilters = { sources: [], companies: [], orgs: [], unreadOnly: false, includeLow: false, includeDismissed: false };
  assert.deepEqual(panelChips(off, L, 'new'), [], '기본은 칩 없음');
  const on = { ...off, includeDismissed: true };
  const chips = panelChips(on, L, 'new');
  assert.deepEqual(chips.map(c => [c.key, c.label]), [['dismissed', '치운 기사 포함']]);
  assert.equal(badgeCount(chips, 'default'), 1, '배지 1');
  assert.deepEqual(panelChips(on, L, 'all'), [], '다른 탭에는 칩 없음');
  assert.equal(removeChip(on, { kind: 'dismissed' }).includeDismissed, false, '칩 ×로 끔');
  assert.equal(clearPanel(on).includeDismissed, false, '필터 초기화로 끔');
  assert.equal(onTabChange(on).includeDismissed, false, '탭을 옮기면 끔');
  // 빈 결과: 칩이 켜져 있으면 '조건에 맞는 기사가 없습니다' + [필터 초기화]
  assert.equal(emptyKind({ filtered: true, date: 'default', tab: 'new', channelArticles: 10 }), 'filtered');
  const page = readFileSync('app/[channel]/page.tsx', 'utf8');
  assert.match(page, /includeDismissed && tab === 'new' && \{ key: 'dismissed', label: '치운 기사 포함'/);
  assert.match(page, /tab === 'new' && <label className="check"><input type="checkbox" checked=\{includeDismissed\}/);
  assert.match(page, /dismissed: dismissedSet\.has\(a\.id\) && !leaving\.has\(a\.id\)/, '켠 상태에서 치운 카드는 흐리게 + [되돌리기]');
  const css = readFileSync('app/globals.css', 'utf8');
  assert.match(css, /\.article\.isDismissed \.articleMain\{opacity:\.55\}/);
  assert.ok(!/\.article\.isRead \.cardTitle\{font-weight/.test(css), '읽음은 색만 바꿈(굵기 변화로 카드 높이가 바뀌지 않게)');
}

// 4) 북마크와 독립: 북마크해도 치워지지 않고, 치워도 북마크는 그대로
{
  const art = { id: 'a', title: 't', url: 'https://example.invalid/a', source: 's', source_type: 'news', category: '정책', tags: [], published_at: A.published_at, collected_at: A.collected_at } as never;
  let st: UserState = { ...EMPTY_STATE, lastConfirmed: baseline };
  st = addBookmark(st, art, 'insurance', '2026-11-05T00:00:00.000Z');
  assert.deepEqual(st.dismissed, [], '북마크해도 치워지지 않음');
  assert.equal(vis(A, st.dismissed), true);
  st = { ...st, dismissed: addDismissed(st.dismissed, ['a'], '2026-11-05T01:00:00.000Z') };
  assert.ok(isLive(st.bookmarks.a), '치워도 북마크 그대로');
  st = removeBookmark(st, 'a', '2026-11-05T02:00:00.000Z');
  assert.deepEqual(st.dismissed.map(e => e.id), ['a'], '북마크 해제해도 치운 기록 그대로');
}

// 5) 기존 읽음 데이터 이전: 그때 숨겨져 있던 것(확인 이후 읽음)만 치운 기사로, 한 번만
{
  const readAt = { a: '2026-11-04T12:00:00.000Z', old: '2026-11-03T08:00:00.000Z' };   // a: 확인 이후 읽음(숨겨져 있었음), old: 확인 이전
  assert.deepEqual(fromReads(readAt, baseline), [{ id: 'a', at: readAt.a }]);
  assert.deepEqual(fromReads(readAt, null).map(e => e.id), ['a', 'old'], '확인 전이면 읽은 것 전부가 숨겨져 있었음');
  const oldSaved = { schemaVersion: 2, channel: 'insurance', bookmarks: {}, folders: {}, tags: {}, lastConfirmed: baseline, readAt, companies: [] };
  const m = fromStored(oldSaved, 'insurance');
  assert.deepEqual(m.dismissed, [{ id: 'a', at: readAt.a }], '읽어서 숨겨졌던 기사는 계속 숨김(목록이 갑자기 늘지 않게)');
  assert.deepEqual(m.readAt, readAt, '읽음 기록은 그대로(제목 흐림 표시에 계속 씀)');
  // dismissed 키가 있으면 다시 옮기지 않는다: 이전 뒤 새로 읽은 기사는 숨겨지지 않음, 되돌린 기사도 되살아나지 않음
  const after = fromStored({ ...toStored('insurance', m), readAt: { ...readAt, b: '2026-11-05T00:00:00.000Z' }, dismissed: [] }, 'insurance');
  assert.deepEqual(after.dismissed, [], '이전은 한 번만');
  // 저장소: 옛 저장값을 읽으면 이전 결과를 바로 저장(다음 읽기부터는 dismissed 키 그대로)
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
  mem.set('heukseok-v2:insurance', JSON.stringify(oldSaved));
  const loaded = localStorageStore.load('insurance');
  assert.deepEqual(loaded.dismissed.map(e => e.id), ['a']);
  const raw = JSON.parse(mem.get('heukseok-v2:insurance')!);
  assert.deepEqual(raw.dismissed, [{ id: 'a', at: readAt.a }], '이전 결과를 저장');
  assert.deepEqual(raw.readAt, readAt);
  localStorageStore.save('insurance', { ...loaded, dismissed: [], readAt: { ...readAt, c: '2026-11-06T00:00:00.000Z' } });
  assert.deepEqual(localStorageStore.load('insurance').dismissed, [], '되돌린 뒤 다시 읽어도 옛 읽음에서 다시 옮기지 않음');
  // 형식이 깨진 항목은 버리고, 같은 id 는 늦은 시각 하나
  assert.deepEqual(cleanDismissed([{ id: 'a', at: 'x' }, { id: 'b', at: '2026-11-01T00:00:00.000Z' }, { id: 'b', at: '2026-11-02T00:00:00.000Z' }, 'c', { at: '2026-11-01T00:00:00.000Z' }]), [{ id: 'b', at: '2026-11-02T00:00:00.000Z' }]);
  assert.deepEqual(cleanDismissed('nope'), []);
  // 병합(백업 가져오기): 합집합
  const merged = mergeStates({ ...EMPTY_STATE, dismissed: [{ id: 'a', at: '2026-11-01T00:00:00.000Z' }] }, { ...EMPTY_STATE, dismissed: [{ id: 'a', at: '2026-11-02T00:00:00.000Z' }, { id: 'b', at: '2026-11-01T00:00:00.000Z' }] });
  assert.deepEqual(merged.dismissed, [{ id: 'a', at: '2026-11-02T00:00:00.000Z' }, { id: 'b', at: '2026-11-01T00:00:00.000Z' }]);
  assert.deepEqual(mergeDismissed([], []), []);
}

// 6) 오래된 항목 정리: 60일 지났고 마지막 확인 이전에 치운 것만 지움(확인 이후 치운 것은 지우면 되살아나므로 남김), 상한 초과는 오래된 것부터
{
  assert.equal(KEEP_DAYS, 60);
  const now = '2026-11-13T00:00:00.000Z';
  const list: Dismissed = [
    { id: 'old', at: '2026-09-01T00:00:00.000Z' },      // 60일 넘음 + 확인 이전 → 지움
    { id: 'recent', at: '2026-10-20T00:00:00.000Z' },   // 60일 안 → 남김
  ];
  assert.deepEqual(pruneDismissed(list, now, '2026-10-01T00:00:00.000Z').map(e => e.id), ['recent']);
  assert.deepEqual(pruneDismissed(list, now, '2026-08-01T00:00:00.000Z').map(e => e.id), ['old', 'recent'], '확인 이후에 치운 것은 남김');
  assert.deepEqual(pruneDismissed(list, now, null).map(e => e.id), ['old', 'recent'], '확인한 적 없으면 남김');
  const kept = pruneDismissed(list, now, '2026-08-01T00:00:00.000Z');
  assert.equal(kept, list, '바뀔 것이 없으면 같은 배열');
  const many: Dismissed = Array.from({ length: DISMISS_HARD + 5 }, (_, i) => ({ id: 'x' + i, at: new Date(Date.parse(now) - (DISMISS_HARD + 5 - i) * 1000).toISOString() }));
  const capped = pruneDismissed(many, now, null);
  assert.equal(capped.length, DISMISS_HARD); assert.equal(capped[0].id, 'x5', '상한 초과는 오래된 것부터');
  // 읽을 때 정리(now 를 주면)
  const st = fromStored({ schemaVersion: 2, channel: 'insurance', lastConfirmed: '2026-10-01T00:00:00.000Z', readAt: {}, dismissed: list }, 'insurance', undefined, now);
  assert.deepEqual(st.dismissed.map(e => e.id), ['recent']);
}

// 7) 건수: 사건 단위로 '치우지 않은 새 기사'가 있는 사건 수(화면 newCount 와 같은 식)
{
  const arts = [{ ...A, cluster_id: 'c1' }, { ...B, cluster_id: 'c1' }, { id: 'n', published_at: B.published_at, collected_at: B.collected_at, cluster_id: undefined }, { ...OLD, cluster_id: undefined }];
  const newCount = (d: Dismissed) => { const seen = new Set<string>(); for (const x of arts) if (isPendingNew(x, baseline, ids(d))) seen.add(x.cluster_id ?? x.id); return seen.size; };
  assert.equal(newCount([]), 2, '같은 사건 2건은 1건 + 단독 1건');
  assert.equal(isPendingNew(A, baseline, none), true, '읽음은 판정에 쓰지 않음(인자에 없음) → 읽기만 하면 건수 그대로');
  assert.equal(newCount(addDismissed([], ['a'], 'T')), 2, '사건의 일부만 치우면 사건은 남음');
  assert.equal(newCount(addDismissed([], ['a', 'b'], 'T')), 1, '사건을 통째로 치우면 1 감소');
  assert.equal(newCount(addDismissed([], ['a', 'b', 'n'], 'T')), 0);
  const page = readFileSync('app/[channel]/page.tsx', 'utf8');
  assert.match(page, /if \(isPendingNew\(a, baseline, dismissedSet\)\) seen\.add\(a\.cluster_id \?\? a\.id\)/);
}
console.log('new-news / dismiss tests passed');
