/** 전체 채팅방의 순수 로직(브라우저·Supabase 없이 테스트한다, tests/chat.test.ts).
 *  글·기사 첨부 검사는 서버 규칙(supabase/migrations/0003_chat.sql chat_send·private.chat_article_ok)의 사본이다 — 서버가 최종 판정한다.
 *  화면: components/ChatRoom.tsx, 서버 연결: lib/chatBackend.ts. */
import { kstDate, dayHeading } from './dates.ts';

export const BODY_MAX = 500;
/** 글자 수를 보여 주기 시작하는 길이 */
export const COUNT_FROM = 400;
/** 처음·이전 글 더 보기 한 번에 불러오는 수(서버는 200 에서 자른다) */
export const PAGE = 100;
/** 버튼 중복 클릭 방지 간격(ms). 전송 간격 제한이 아니다 */
export const SEND_GAP_MS = 500;
export const CHAT_CHANNELS = ['insurance', 'ai', 'finance'] as const;
export const DELETED_TEXT = '삭제된 글입니다';
export const NOT_READY = '채팅 준비 중입니다';

/** 기사 첨부: 북마크 스냅샷과 같은 모양(그 기사 한 건만 공개된다. 목록·메모·태그는 넣지 않는다) */
export type ChatArticle = { id: string; cluster_id?: string; channel: string; title: string; source?: string; url: string; published_at?: string };
export type ChatMessage = {
  id: number; user_id: string; author_name: string;
  body: string | null; article: ChatArticle | null;
  created_at: string; deleted_at: string | null;
};

// ───── 글 검사 ─────
/** 줄바꿈(\n)을 뺀 제어 문자, 글자 방향을 바꾸는 문자(서버 body_format 과 같은 범위 + NUL) */
const BAD_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
/** 보내기 전 정리: 줄바꿈 통일(\r\n·\r → \n), 탭은 공백 두 칸, 앞뒤 공백 제거 */
export const cleanBody = (raw: string) => raw.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').trim();
/** 코드 포인트로 센다(서버 char_length 와 같게) */
export const bodyLength = (s: string) => [...s].length;
export type BodyProblem = 'empty' | 'tooLong' | 'invalid';
export function bodyProblem(raw: string): BodyProblem | null {
  const b = cleanBody(raw);
  if (!b) return 'empty';
  if (bodyLength(b) > BODY_MAX) return 'tooLong';
  if (BAD_CHARS.test(b)) return 'invalid';
  return null;
}
/** 보내기 전 검사: 기사를 첨부했으면 본문이 비어 있어도 된다(기사만 있는 글, 0004). 아니면 bodyProblem 과 같다 */
export function sendProblem(raw: string, hasArticle: boolean): BodyProblem | null {
  const p = bodyProblem(raw);
  return p === 'empty' && hasArticle ? null : p;
}
/** [보내기] 버튼을 켤지: 글이 있거나 첨부한 기사가 있으면 */
export const canSend = (raw: string, hasArticle: boolean) => !!cleanBody(raw) || hasArticle;

// ───── 기사 첨부 ─────
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/;
const CTRL = /[\u0000-\u001f\u007f-\u009f]/;
const KEYS = new Set(['id', 'cluster_id', 'channel', 'title', 'source', 'url', 'published_at']);
export const isHttpUrl = (u: unknown): u is string => typeof u === 'string' && u.length <= 2048 && /^https?:\/\/[^\s\u0000-\u001f\u007f]+$/i.test(u);

/** 서버 private.chat_article_ok 와 같은 규칙. 문자열 값만, 허용한 키만, 필수 id·channel·title·url, 4KB 이하 */
export function checkArticle(v: unknown): v is ChatArticle {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  for (const [k, x] of Object.entries(o)) if (!KEYS.has(k) || typeof x !== 'string') return false;
  const s = o as Record<string, string>;
  if (!ID.test(s.id ?? '') || !(CHAT_CHANNELS as readonly string[]).includes(s.channel) || !isHttpUrl(s.url)) return false;
  if (typeof s.title !== 'string' || !s.title.trim() || [...s.title].length > 200 || CTRL.test(s.title)) return false;
  if ('cluster_id' in s && !ID.test(s.cluster_id)) return false;
  if ('source' in s && (!s.source.trim() || [...s.source].length > 60 || CTRL.test(s.source))) return false;
  if ('published_at' in s && !ISO.test(s.published_at)) return false;
  return new TextEncoder().encode(JSON.stringify(o)).length <= 3800;   // 서버 4096(jsonb 글자 표현, 띄어쓰기 포함)보다 여유 있게
}

const cut = (s: string, n: number) => [...s.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()].slice(0, n).join('');
/** 기사·북마크에서 첨부를 만든다(제목 200자·매체 60자로 자름, 빈 값은 뺌). 만들 수 없으면 null(링크 없는 기사 등) */
export function articleRefOf(a: { id: string; title: string; url: string; source?: string; published_at?: string; cluster_id?: string }, channel: string): ChatArticle | null {
  const r: ChatArticle = { id: a.id, channel, title: cut(a.title ?? '', 200), url: a.url };
  if (a.cluster_id && ID.test(a.cluster_id)) r.cluster_id = a.cluster_id;
  const src = cut(a.source ?? '', 60);
  if (src) r.source = src;
  if (a.published_at && ISO.test(a.published_at)) r.published_at = a.published_at;
  return checkArticle(r) ? r : null;
}

// ───── 첨부 대기(기사 카드 [채팅에 올리기] → /chat/) ─────
export const PENDING_KEY = 'heukseok-chat-pending';
/** 대기 상태는 30분 뒤 버린다(오래전에 누른 기사가 뜻밖에 붙지 않게) */
export const PENDING_TTL_MS = 30 * 60_000;
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
export function savePending(st: Store, a: ChatArticle, now = Date.now()): boolean {
  if (!checkArticle(a)) return false;
  try { st.setItem(PENDING_KEY, JSON.stringify({ a, at: now })); return true; } catch { return false; }
}
/** 꺼내면서 지운다(한 번만 붙는다) */
export function takePending(st: Store, now = Date.now()): ChatArticle | null {
  let raw: string | null = null;
  try { raw = st.getItem(PENDING_KEY); st.removeItem(PENDING_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (typeof j?.at !== 'number' || now - j.at > PENDING_TTL_MS || now < j.at - 60_000) return null;
    return checkArticle(j.a) ? j.a : null;
  } catch { return null; }
}

// ───── 서버 행 → 메시지 ─────
/** 서버(chat_list·Realtime) 행을 화면 모양으로. 모양이 아니면 null(버림) */
export function toMessage(r: unknown): ChatMessage | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const id = Number(o.id);
  if (!Number.isSafeInteger(id) || id <= 0 || typeof o.user_id !== 'string' || typeof o.created_at !== 'string') return null;
  const deleted = typeof o.deleted_at === 'string' && !!o.deleted_at;
  const body = !deleted && typeof o.body === 'string' ? o.body : null;
  return {
    id, user_id: o.user_id, author_name: typeof o.author_name === 'string' && o.author_name ? o.author_name : '이름 없음',
    body, article: body !== null && checkArticle(o.article) ? o.article : null,
    created_at: o.created_at, deleted_at: deleted ? o.deleted_at as string : (body === null ? o.created_at : null),
  };
}
export const isDeleted = (m: ChatMessage) => m.deleted_at !== null || m.body === null;
/** 관리자 판정: 서버에서 읽은 본인 profiles.is_admin 이 정확히 true 일 때만(못 읽음·null·그 밖의 값은 관리자 아님 → [삭제]를 숨기는 쪽) */
export const isAdminValue = (v: unknown): boolean => v === true;
/** [삭제] 버튼: 관리자에게만, 지우지 않은 글에(0005: 글 삭제는 관리자만 — 내 글이라도 관리자가 아니면 없음) */
export const canDelete = (m: ChatMessage, admin: boolean | null | undefined) => admin === true && !isDeleted(m);
/** 삭제 실패 안내: 서버가 권한 없음(PT403)을 돌려주면 '삭제 권한이 없습니다'(관리자 판정이 어긋났을 때) */
export const deleteFailNote = (fail: ChatFail) => fail === 'forbidden' ? '삭제 권한이 없습니다' : '지우지 못했습니다. 잠시 후 다시 시도해 주세요';

// ───── 목록 병합 ─────
/** id 로 중복을 걸러 합치고 id 오름차순으로. 같은 id 는 지운 쪽이 이긴다(지운 글이 다시 살아나지 않게), 아니면 새로 받은 쪽.
 *  바뀐 것이 없으면 cur 를 그대로 돌려준다(다시 그리지 않게). */
export function mergeMessages(cur: ChatMessage[], incoming: (ChatMessage | null)[]): ChatMessage[] {
  const map = new Map(cur.map(m => [m.id, m]));
  let changed = false;
  for (const m of incoming) {
    if (!m) continue;
    const old = map.get(m.id);
    if (old && (isDeleted(old) || (old.body === m.body && old.deleted_at === m.deleted_at && JSON.stringify(old.article) === JSON.stringify(m.article)))) continue;
    map.set(m.id, old && isDeleted(m) ? { ...old, body: null, article: null, deleted_at: m.deleted_at ?? old.created_at } : m);
    changed = true;
  }
  return changed ? [...map.values()].sort((a, b) => a.id - b.id) : cur;
}
/** 행이 지워진 경우(계정 삭제 등 DELETE 이벤트): 목록에서 뺀다 */
export function dropMessages(cur: ChatMessage[], ids: number[]): ChatMessage[] {
  const s = new Set(ids);
  return cur.some(m => s.has(m.id)) ? cur.filter(m => !s.has(m.id)) : cur;
}
export const lastId = (list: ChatMessage[]) => list.length ? list[list.length - 1].id : 0;
export const firstId = (list: ChatMessage[]) => list.length ? list[0].id : 0;

/** 재연결·탭 복귀 뒤 보충: 최근 글부터 거꾸로 페이지를 받아 sinceId 에 닿을 때까지(최대 maxPages).
 *  complete=false 면 빈틈이 너무 커서 다 채우지 못한 것 — 화면은 목록을 최근 페이지로 새로 시작한다. */
export async function fetchSince(list: (before: number | null, limit: number) => Promise<ChatMessage[]>, sinceId: number, maxPages = 5): Promise<{ rows: ChatMessage[]; complete: boolean }> {
  const rows: ChatMessage[] = [];
  let before: number | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await list(before, 200);
    rows.push(...page);
    if (page.length < 200 || page.some(m => m.id <= sinceId)) return { rows, complete: true };
    before = Math.min(...page.map(m => m.id));
  }
  return { rows, complete: false };
}

// ───── 낙관적 표시(보내는 중·실패) ─────
export type Outgoing = { key: string; body: string; article: ChatArticle | null; state: 'sending' | 'failed'; fail?: ChatFail; at: number };
/** 내 새 글(실시간 이벤트·전송 응답)이 들어오면 같은 내용의 '보내는 중' 항목 하나를 지운다(잠깐 두 번 보이지 않게) */
export function settleOutgoing(out: Outgoing[], m: ChatMessage, me: string | null): Outgoing[] {
  if (!me || m.user_id !== me || isDeleted(m)) return out;
  const i = out.findIndex(o => o.state === 'sending' && o.body === m.body && (o.article?.id ?? null) === (m.article?.id ?? null));
  return i < 0 ? out : [...out.slice(0, i), ...out.slice(i + 1)];
}

// ───── 입력: Enter ─────
/** Enter 전송, Shift+Enter 줄바꿈, 한글 조합 중 Enter(isComposing·keyCode 229)는 아무것도 하지 않는다(조합 확정만) */
export function enterAction(e: { key: string; shiftKey: boolean; isComposing?: boolean; keyCode?: number; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): 'send' | 'newline' | 'none' {
  if (e.key !== 'Enter') return 'none';
  if (e.isComposing || e.keyCode === 229) return 'none';
  if (e.shiftKey || e.altKey) return 'newline';
  return 'send';
}

// ───── 스크롤 ─────
/** 맨 아래 근처(새 글이 오면 따라 내려갈지) */
export const nearBottom = (scrollTop: number, scrollHeight: number, clientHeight: number, slack = 80) => scrollHeight - scrollTop - clientHeight <= slack;

// ───── 시각(한국 시간) ─────
export const timeLabel = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(11, 16);
export const dayKey = (iso: string) => kstDate(iso);
export const dayLabel = (iso: string) => { const d = kstDate(iso); return `${d.slice(0, 4)}년 ${dayHeading(d)}`; };
/** 첨부 카드의 날짜(YYYY.MM.DD, 한국 시간) */
export const articleDate = (iso?: string) => iso && !isNaN(Date.parse(iso)) ? kstDate(iso).replace(/-/g, '.') : '';

// ───── 서버 오류 ─────
export type ChatFail = 'unavailable' | 'network' | 'auth' | 'forbidden' | 'length' | 'format' | 'article' | 'rate' | 'notFound' | 'other';
/** PostgREST 오류 → 종류. 함수·표가 없음(SQL 미적용)은 unavailable */
export function chatFailOf(e: { status?: number; code?: string; message?: string }): ChatFail {
  const code = e.code ?? '', msg = e.message ?? '', st = e.status ?? 0;
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42883' || code === '42P01') return 'unavailable';
  if (/body_length/.test(msg)) return 'length';
  if (/body_format/.test(msg)) return 'format';
  if (/article_format/.test(msg)) return 'article';
  if (/rate_limited/.test(msg) || st === 429) return 'rate';
  if (/not_found/.test(msg)) return 'notFound';
  if (/not_signed_in/.test(msg) || st === 401 || code.startsWith('PGRST3')) return 'auth';
  if (/not_allowed/.test(msg) || st === 403 || code === '42501') return 'forbidden';
  if (st === 0 || st >= 500 || /fetch|network|abort|timeout/i.test(msg)) return 'network';
  if (st === 404) return 'unavailable';
  return 'other';
}
/** 전송 실패 줄의 짧은 이유(없으면 '전송 실패'만) */
export const FAIL_NOTE: Partial<Record<ChatFail, string>> = {
  length: '500자 이하로 써 주세요', format: '쓸 수 없는 문자가 있습니다', article: '첨부한 기사를 올릴 수 없습니다',
  rate: '잠시 후 다시 보내 주세요', auth: '다시 로그인해 주세요', forbidden: '보낼 수 없습니다',
};
/** 실패한 글의 안내. 기사만 보냈는데 서버가 본문 길이로 거절하면(0004 적용 전) 글을 함께 쓰라고 안내한다 */
export function failNote(o: Pick<Outgoing, 'body' | 'article' | 'fail'>): string {
  if (o.fail === 'length' && !o.body && o.article) return '글을 함께 적어 주세요';
  return (o.fail && FAIL_NOTE[o.fail]) || '';
}
export const BODY_NOTE: Record<BodyProblem, string> = { empty: '', tooLong: '500자 이하로 써 주세요', invalid: '쓸 수 없는 문자가 있습니다' };

// ───── 읽음 수(0004) ─────
// 사용자마다 '어디까지 읽었는지' 한 줄(서버 chat_reads). 화면은 내가 보낸 글에만 '읽음 N'(0이면 숨김). 누가 읽었는지는 받지 않는다.
/** 읽은 위치 알리기 간격(모아서 한 번) */
export const MARK_GAP_MS = 3000;
/** 읽음 수 다시 가져오기 간격(방이 보이는 동안) */
export const COUNTS_EVERY_MS = 20_000;
/** 읽음 기능 상태: unknown(아직 모름) · on · off(서버에 0004 없음 → 읽음 표시를 숨기고 더 부르지 않는다) */
export type ReadsState = 'unknown' | 'on' | 'off';
/** 읽음 호출이 실패했을 때: 함수가 없으면(0004 미적용) off, 그 밖(일시 오류)은 그대로 */
export const readsAfterFail = (cur: ReadsState, fail: ChatFail): ReadsState => fail === 'unavailable' ? 'off' : cur;

/** 읽은 위치를 지금 알릴지(send), 아니면 몇 ms 뒤에 다시 볼지(wait > 0). 탭이 보이고 최신 글 쪽이 화면에 있을 때만,
 *  새로 읽은 것이 있을 때만, 마지막 호출에서 3초가 지났을 때만 보낸다(그 전이면 남은 시간만큼 모았다가 한 번). */
export function markPlan(s: { want: number; sent: number; lastAt: number; now: number; visible: boolean; seeingLatest: boolean; reads: ReadsState }): { send: boolean; wait: number } {
  if (s.reads === 'off' || !s.visible || !s.seeingLatest || s.want <= s.sent) return { send: false, wait: 0 };
  const left = MARK_GAP_MS - (s.now - s.lastAt);
  return left > 0 ? { send: false, wait: left } : { send: true, wait: 0 };
}
/** 읽음 수를 가져올지: 방이 열려 있고(ready), 탭이 보이고, 0004 가 없지 않고, 물어볼 글이 있을 때만 */
export const canFetchCounts = (s: { ready: boolean; visible: boolean; reads: ReadsState; ids: number[] }) => s.ready && s.visible && s.reads !== 'off' && s.ids.length > 0;
/** 읽음 수를 물어볼 글: 내가 보낸 지우지 않은 글 중 최근 200개 */
export const readCountIds = (list: ChatMessage[], me: string | null) => list.filter(m => m.user_id === me && !isDeleted(m)).slice(-200).map(m => m.id);
/** 받은 읽음 수를 합친다. 물어본 id 중 답에 없는 것(지운 글)은 뺀다 */
export function applyCounts(prev: Map<number, number>, asked: number[], rows: { id: number; read_count: number }[]): Map<number, number> {
  const next = new Map(prev);
  for (const id of asked) next.delete(id);
  for (const r of rows) if (Number.isSafeInteger(r.id) && Number.isInteger(r.read_count) && r.read_count >= 0) next.set(r.id, r.read_count);
  return next;
}
/** 글 옆 표시: 읽음 기능이 켜져 있고 1 이상일 때만 '읽음 N' */
export const readLabel = (n: number | undefined, reads: ReadsState) => reads === 'on' && n && n > 0 ? `읽음 ${n}` : '';

// ───── 서버 연결(구현: lib/chatBackend.ts, 테스트·브라우저 확인은 가짜) ─────
export type ChatEvent = { type: 'upsert'; row: ChatMessage } | { type: 'drop'; id: number };
export type LinkState = 'connecting' | 'live' | 'offline';
export interface ChatBackend {
  /** 최근 글부터(id 내림차순) */
  list(before: number | null, limit: number): Promise<ChatMessage[]>;
  send(body: string, article: ChatArticle | null): Promise<{ id: number; created_at: string; author_name: string }>;
  remove(id: number): Promise<void>;
  isAdmin(userId: string): Promise<boolean>;
  /** 내 읽은 위치를 올린다(0004). 돌려주는 값 = 서버에 저장된 위치 */
  markRead(lastId: number): Promise<number>;
  /** 글별 읽음 수(0004). 삭제된 글은 빠진다 */
  readCounts(ids: number[]): Promise<{ id: number; read_count: number }[]>;
  /** 실시간 연결. 끊기면 스스로 다시 붙고 onState('live') 를 다시 부른다. 돌려준 함수로 닫는다 */
  subscribe(onEvent: (e: ChatEvent) => void, onState: (s: LinkState) => void): () => void;
}
export class ChatError extends Error {
  kind: ChatFail;
  constructor(kind: ChatFail) { super(kind); this.kind = kind; }
}
