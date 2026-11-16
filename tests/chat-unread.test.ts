import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAT_READ_EVENT, POLL_MS, badgeLabel, badgeText, countUnread, createUnreadPoller, unreadEnabled } from '../lib/chatUnread.ts';

// ───── 개수 계산: 마지막 읽은 위치 이후, 내 글 제외, 지운 글 제외 ─────
const msgs = [
  { id: 1, user_id: 'b' }, { id: 5, user_id: 'b' },                 // 읽은 위치(5) 이하
  { id: 6, user_id: 'me' },                                         // 내 글
  { id: 7, user_id: 'b' }, { id: 8, user_id: 'c', deleted_at: '2026-11-16T00:00:00Z' }, // 지운 글
  { id: 9, user_id: 'c', deleted_at: null },
];
assert.equal(countUnread(msgs, 5, 'me'), 2);
assert.equal(countUnread(msgs, 0, 'me'), 4);
assert.equal(countUnread(msgs, 9, 'me'), 0);

// ───── 표시: 0 은 '0', 99 초과는 '99+', 접근성 이름 ─────
assert.equal(badgeText(0), '0');
assert.equal(badgeText(7), '7');
assert.equal(badgeText(99), '99');
assert.equal(badgeText(100), '99+');
assert.equal(badgeText(-3), '0');
assert.equal(badgeLabel(4), '채팅, 안 읽은 채팅 4개');
assert.equal(badgeLabel(150), '채팅, 안 읽은 채팅 150개', '99+ 여도 이름은 실제 수');

// ───── 로그아웃·로그인 꺼진 빌드: 숨김 ─────
assert.equal(unreadEnabled('off', 'u1'), false);
assert.equal(unreadEnabled('required', null), false);
assert.equal(unreadEnabled('optional', 'u1'), true);

// ───── 갱신: 처음 한 번, 60초마다, 가려지면 멈춤·보이면 즉시, 실패 시 숨김, 읽음 처리 뒤 0 ─────
function harness(results: (number | Error)[], visible = true) {
  const seen: (number | null)[] = [];
  let vis = visible, fetches = 0, tick: (() => void) | null = null, ms = 0;
  const p = createUnreadPoller({
    fetch: async () => { const r = results[Math.min(fetches++, results.length - 1)]; if (r instanceof Error) throw r; return r; },
    onChange: v => seen.push(v), visible: () => vis,
    setInterval: (fn, m) => { tick = fn; ms = m; return 1; }, clearInterval: () => { tick = null; },
  });
  return { p, seen, fetches: () => fetches, fire: () => tick?.(), timerOn: () => tick !== null, ms: () => ms, setVis: (v: boolean) => { vis = v; } };
}
const flush = () => new Promise(r => setTimeout(r, 0));
{
  const h = harness([3, 120, 0]);
  h.p.start(); await flush();
  assert.deepEqual(h.seen, [3]); assert.equal(h.ms(), POLL_MS); assert.equal(POLL_MS, 60_000);
  h.fire(); await flush(); assert.deepEqual(h.seen, [3, 120]);
  // 탭 가려짐 → 멈춤(주기 없음), 다시 보이면 즉시 한 번
  h.setVis(false); h.p.onVisibility(); assert.equal(h.timerOn(), false);
  const before = h.fetches(); h.fire(); await flush(); assert.equal(h.fetches(), before, '가려진 동안 조회 없음');
  h.setVis(true); h.p.onVisibility(); await flush(); assert.equal(h.fetches(), before + 1); assert.equal(h.timerOn(), true);
  assert.deepEqual(h.seen.at(-1), 0);
}
{
  // 실패하면 숨김(null), 다음 성공에서 다시 보임
  const h = harness([new Error('42P01 chat_reads 없음'), 2]);
  h.p.start(); await flush(); assert.deepEqual(h.seen, [null]);
  h.fire(); await flush(); assert.deepEqual(h.seen, [null, 2]);
}
{
  // 채팅 화면에서 읽음 처리 → 바로 0, 그 전에 시작한 느린 조회 결과는 버림
  let release: (v: number) => void = () => {};
  const seen: (number | null)[] = [];
  const p = createUnreadPoller({ fetch: () => new Promise<number>(r => { release = r; }), onChange: v => seen.push(v), visible: () => true, setInterval: () => 1, clearInterval: () => {} });
  p.start(); p.markedRead(); release(9); await flush();
  assert.deepEqual(seen, [0], '읽음 처리 뒤 0, 늦게 온 9 는 무시');
}
{
  // 처음부터 가려진 탭이면 보일 때까지 조회하지 않음, stop 뒤에는 아무것도 바꾸지 않음
  const h = harness([5], false);
  h.p.start(); await flush(); assert.equal(h.fetches(), 0);
  h.p.stop(); h.setVis(true); h.p.onVisibility(); h.p.markedRead(); await flush();
  assert.deepEqual(h.seen, []);
}

// ───── 화면 연결(소스): 로그인 상태에서만 조회, 숨김일 때도 자리 유지, 채팅 화면이 읽음 알림 ─────
const link = readFileSync('components/ChatLink.tsx', 'utf8');
assert.ok(link.includes('unreadEnabled(AUTH_MODE, uid)') && link.includes("import('../lib/chatUnreadBackend')"));
assert.ok(link.includes("'visibilitychange'") && link.includes('CHAT_READ_EVENT'));
assert.ok(link.includes("(n === null ? ' hidden'"), '실패·모름이면 숨김(자리는 유지)');
const room = readFileSync('components/ChatRoom.tsx', 'utf8');
assert.ok(room.includes('notifyChatRead()'), '읽음 처리 성공 → 배지 0');
const be = readFileSync('lib/chatUnreadBackend.ts', 'utf8');
assert.ok(be.includes("count: 'exact', head: true") && be.includes(".neq('user_id', uid)") && be.includes(".is('deleted_at', null)"), '개수만, 내 글·지운 글 제외');
assert.equal(CHAT_READ_EVENT, 'heukseok-chat-read');
const css = readFileSync('app/globals.css', 'utf8');
assert.match(css, /\.chatBadge\{display:inline-block;width:34px;padding:0;/, "배지 자리는 '99+' 가 들어가는 고정 폭");
console.log('chat unread tests passed');
