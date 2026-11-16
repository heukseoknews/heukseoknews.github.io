/** 기사 라벨링(/label/): 기사별 '필요 정도' 0~3 을 이 브라우저(localStorage)에만 모은다.
 *  나중에 제거 규칙·점수 모델의 정답 데이터로 쓴다. 눈가림 라벨링이라 화면에는 ★·분류·묶음 같은 내부 판단값을 보여 주지 않는다.
 *  표본 순서: 채널별 고정 시드 + 기사 id 의 해시 순. 기사가 새로 수집돼도 기존 기사끼리의 순서는 그대로다.
 *  닉네임(영문·숫자 15자)을 정하면 처음 COMMON(30)건은 모든 사람이 같은 기사(사람 사이 일치도 확인용), 그 뒤는 닉네임 시드로 사람마다 다르다(sampleFor).
 *  내보내기 각 행에 annotator(닉네임)를 넣고, 가져오기는 annotator 가 다른 라벨을 서로 덮어쓰지 않게 따로 둔다(mergeRows). */

export const LABEL_KEY = 'heukseok-label-v1';
export const BATCH = 150;
/** 모든 사람이 같은 기사를 보는 처음 건수 */
export const COMMON = 30;
/** 닉네임: 영문·숫자 1~15자 */
export const NICK_RE = /^[A-Za-z0-9]{1,15}$/;
export const isNick = (v: unknown): v is string => typeof v === 'string' && NICK_RE.test(v);
/** 채널 선택 안내(한 줄) */
export const CHANNEL_GUIDE = '본인 공부·취업 목적에 맞는 채널을 골라 매겨 주세요. 금융: 은행권 취업 공부 · 보험: 계리사·리스크관리 공부와 보험업 취업 · AI: AI 연구 동향';
export const SCORES = [0, 1, 2, 3] as const;
export type Score = (typeof SCORES)[number];
export const SCALE: Record<Score, string> = { 0: '불필요(제거 대상)', 1: '거의 불필요(배경 수준)', 2: '볼만함', 3: '꼭 봐야 함' };
export const PURPOSE: Record<string, string> = {
  insurance: '계리사 2차·리스크관리 2차 공부와 보험업 취업 동향',
  ai: 'AI 대학원 연구자 지망생이 새 모델·breakthrough 를 보려는 용도',
  finance: '은행권 취업 동향 공부',
};
export const LABEL_CHANNELS = ['insurance', 'ai', 'finance'] as const;
export const seedFor = (channel: string) => `heukseok-label-v1:${channel}`;

/** 32비트 FNV-1a 두 갈래(53비트 정수). 브라우저·Node 어디서나 같은 값. */
export function hash53(s: string): number {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  h2 = Math.imul(h2 ^ (h1 >>> 15), 0x85ebca6b);
  return (h2 >>> 0) * 0x200000 + ((h1 >>> 0) & 0x1fffff);
}

type HasId = { id: string; published_at: string };
/** 기간 필터: 'all' 이거나 발행월(UTC, 월 파일과 같은 기준) 'YYYY-MM' */
export const inMonth = (a: HasId, month: string) => month === 'all' || a.published_at.slice(0, 7) === month;

/** 표본 순서: 기간에 맞는 기사를 (시드:id) 해시 순으로. 입력 순서·중복과 무관하게 같은 결과. 앞에서 size 건. */
export function sampleOrder<T extends HasId>(articles: T[], seed: string, month = 'all', size = BATCH): T[] {
  const seen = new Set<string>(), pool: { a: T; k: number }[] = [];
  for (const a of articles) {
    if (seen.has(a.id) || !inMonth(a, month)) continue;
    seen.add(a.id);
    pool.push({ a, k: hash53(`${seed}:${a.id}`) });
  }
  pool.sort((x, y) => x.k - y.k || (x.a.id < y.a.id ? -1 : x.a.id > y.a.id ? 1 : 0));
  return pool.slice(0, Math.max(0, size)).map(x => x.a);
}

/** 닉네임별 시드(31번째부터의 순서) */
export const nickSeed = (channel: string, nick: string) => `${seedFor(channel)}:${nick}`;
/** 사람별 표본: 닉네임이 없으면 예전 그대로(공통 시드). 있으면 공통 시드 앞 COMMON 건 → keep(닉네임을 정하기 전에 매긴 기사, 공통 순서)
 *  → 닉네임 시드 순. 중복은 한 번만. keep 은 닉네임을 정할 때 고정되므로 라벨을 매겨도 순서가 바뀌지 않는다. */
export function sampleFor<T extends HasId>(articles: T[], channel: string, nick: string | undefined, month = 'all', size = BATCH, keep: readonly string[] = []): T[] {
  const common = sampleOrder(articles, seedFor(channel), month, Infinity);
  if (!nick) return common.slice(0, Math.max(0, size));
  const out: T[] = [], used = new Set<string>();
  const push = (a: T) => { if (out.length < size && !used.has(a.id)) { used.add(a.id); out.push(a); } };
  common.slice(0, COMMON).forEach(push);
  const kept = new Set(keep);
  common.forEach(a => { if (kept.has(a.id)) push(a); });
  for (const a of sampleOrder(articles, nickSeed(channel, nick), month, Infinity)) { if (out.length >= size) break; push(a); }
  return out;
}

// ───────── 저장 형식 ─────────
export type Label = { score: Score; labeled_at: string };
export type ChannelSession = { month: string; size: number; cursor: number };
export type LabelStore = {
  version: 1;
  labels: Record<string, Record<string, Label>>;   // 채널 → 기사 id → 라벨
  sessions: Record<string, ChannelSession>;        // 채널 → 기간·표본 크기·현재 위치
  channel?: string;                                // 마지막으로 고른 채널
  annotator?: string;                              // 닉네임(내 라벨 = labels 의 annotator)
  keep?: Record<string, string[]>;                 // 채널 → 닉네임을 정하기(바꾸기) 전에 매긴 기사 id(표본 앞쪽에 유지)
  others?: Record<string, Record<string, Record<string, Label>>>;  // 가져온 다른 사람 라벨: 닉네임 → 채널 → id → 라벨
};
export const emptyStore = (): LabelStore => ({ version: 1, labels: {}, sessions: {} });
export const defaultSession = (): ChannelSession => ({ month: 'all', size: BATCH, cursor: 0 });

const isScore = (v: unknown): v is Score => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3;
const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;

/** 저장값 읽기(깨진 항목은 버린다) */
export function parseStore(raw: string | null): LabelStore {
  const out = emptyStore();
  if (!raw) return out;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return out; }
  if (!j || typeof j !== 'object') return out;
  const { labels, sessions, channel, annotator, keep, others } = j as Partial<LabelStore>;
  if (typeof channel === 'string' && (LABEL_CHANNELS as readonly string[]).includes(channel)) out.channel = channel;
  if (isNick(annotator)) out.annotator = annotator;
  const labelsOf = (src: unknown): Record<string, Record<string, Label>> => {
    const res: Record<string, Record<string, Label>> = {};
    if (src && typeof src === 'object') for (const [ch, rows] of Object.entries(src)) {
      if (!rows || typeof rows !== 'object') continue;
      for (const [id, l] of Object.entries(rows as Record<string, Partial<Label>>)) {
        if (isId(id) && l && isScore(l.score) && isIso(l.labeled_at)) (res[ch] ??= {})[id] = { score: l.score, labeled_at: l.labeled_at };
      }
    }
    return res;
  };
  out.labels = labelsOf(labels);
  if (keep && typeof keep === 'object') for (const [ch, list] of Object.entries(keep)) {
    if (Array.isArray(list)) (out.keep ??= {})[ch] = list.filter(isId);
  }
  if (others && typeof others === 'object') for (const [nick, chs] of Object.entries(others)) {
    if (!isNick(nick)) continue;
    const l = labelsOf(chs);
    if (Object.keys(l).length) (out.others ??= {})[nick] = l;
  }
  if (sessions && typeof sessions === 'object') for (const [ch, s] of Object.entries(sessions)) {
    if (!s || typeof s !== 'object') continue;
    const { month, size, cursor } = s as Partial<ChannelSession>;
    out.sessions[ch] = {
      month: typeof month === 'string' && (month === 'all' || /^\d{4}-\d{2}$/.test(month)) ? month : 'all',
      size: typeof size === 'number' && Number.isInteger(size) && size >= BATCH ? size : BATCH,
      cursor: typeof cursor === 'number' && Number.isInteger(cursor) && cursor >= 0 ? cursor : 0,
    };
  }
  return out;
}

/** 닉네임 정하기·바꾸기: 지금까지 매긴 내 라벨 id 를 keep 에 더해(표본 앞쪽에 남김) 닉네임을 바꾼다. 형식이 아니거나 같으면 그대로. */
export function setAnnotator(store: LabelStore, nick: string): LabelStore {
  if (!isNick(nick) || store.annotator === nick) return store;
  const keep: Record<string, string[]> = { ...(store.keep ?? {}) };
  for (const [ch, rows] of Object.entries(store.labels)) {
    const ids = Object.keys(rows);
    if (ids.length) keep[ch] = [...new Set([...(keep[ch] ?? []), ...ids])];
  }
  return { ...store, annotator: nick, keep };
}

// ───────── 내보내기·가져오기 ─────────
export type LabelRow = { channel: string; id: string; score: Score; labeled_at: string; annotator?: string };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** 내보내기: [{ channel, id, score, labeled_at, annotator }]. 내 라벨에는 지금 닉네임(없으면 annotator 없이 예전 네 필드),
 *  가져온 다른 사람 라벨은 그 닉네임으로 함께 내보낸다. 순서: 채널 → 닉네임 → 라벨 시각 → id. */
export function toExport(store: LabelStore): LabelRow[] {
  const rows: LabelRow[] = [];
  const add = (labels: Record<string, Record<string, Label>>, annotator?: string) => {
    for (const ch of Object.keys(labels)) for (const [id, l] of Object.entries(labels[ch]))
      rows.push({ channel: ch, id, score: l.score, labeled_at: l.labeled_at, ...(annotator ? { annotator } : {}) });
  };
  add(store.labels, store.annotator);
  for (const [nick, labels] of Object.entries(store.others ?? {})) if (nick !== store.annotator) add(labels, nick);
  return rows.sort((a, b) => cmp(a.channel, b.channel) || cmp(a.annotator ?? '', b.annotator ?? '') || a.labeled_at.localeCompare(b.labeled_at) || cmp(a.id, b.id));
}
/** 내보내기 파일 이름: heukseok-labels-<닉네임>-YYYY-MM-DD.json(닉네임이 없으면 예전 이름) */
export const exportName = (nick: string | undefined, date: string) => `heukseok-labels-${nick ? `${nick}-` : ''}${date}.json`;

/** 가져오기 파일 읽기: 배열(또는 { labels: [...] }). 형식이 아닌 행은 건너뛰고 수를 센다. */
export function parseImport(text: string): { rows: LabelRow[]; skipped: number } {
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new Error('JSON 파일이 아닙니다.'); }
  const list = Array.isArray(j) ? j : j && typeof j === 'object' && Array.isArray((j as { labels?: unknown }).labels) ? (j as { labels: unknown[] }).labels : null;
  if (!list) throw new Error('라벨 목록을 찾지 못했습니다.');
  const rows: LabelRow[] = [];
  let skipped = 0;
  for (const r of list) {
    const x = r as Partial<LabelRow> | null;
    if (x && typeof x === 'object' && typeof x.channel === 'string' && /^[a-z0-9-]{1,40}$/.test(x.channel) && isId(x.id) && isScore(x.score) && isIso(x.labeled_at)
      && (x.annotator === undefined || isNick(x.annotator)))
      rows.push({ channel: x.channel, id: x.id, score: x.score, labeled_at: x.labeled_at, ...(x.annotator !== undefined ? { annotator: x.annotator } : {}) });
    else skipped++;
  }
  return { rows, skipped };
}

/** 병합: 닉네임이 없거나 내 닉네임인 행은 내 라벨로, 다른 닉네임은 그 사람 라벨(others)로 따로 합친다(서로 덮어쓰지 않음).
 *  같은 사람의 같은 (채널, id) 면 나중 라벨(labeled_at 이 늦은 쪽)이 이긴다. 같은 시각이면 기존 값 유지. others: 다른 사람 라벨 건수(새로 + 바뀜). */
export function mergeRows(store: LabelStore, rows: LabelRow[]): { store: LabelStore; added: number; updated: number; others: number } {
  const copy = (l: Record<string, Record<string, Label>>) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, { ...v }]));
  const labels: LabelStore['labels'] = copy(store.labels);
  const others: NonNullable<LabelStore['others']> = Object.fromEntries(Object.entries(store.others ?? {}).map(([n, l]) => [n, copy(l)]));
  let added = 0, updated = 0, other = 0;
  for (const r of rows) {
    const mine = !r.annotator || r.annotator === store.annotator;
    const ch = mine ? (labels[r.channel] ??= {}) : ((others[r.annotator!] ??= {})[r.channel] ??= {});
    const cur = ch[r.id];
    const take = !cur || Date.parse(r.labeled_at) > Date.parse(cur.labeled_at);
    if (take) ch[r.id] = { score: r.score, labeled_at: r.labeled_at };
    if (!take) continue;
    if (!mine) other++;
    else if (cur) updated++;
    else added++;
  }
  return { store: { ...store, labels, ...(Object.keys(others).length ? { others } : {}) }, added, updated, others: other };
}

// ───────── 키보드·버튼 조작 ─────────
export type LabelAction = { type: 'score'; score: Score } | { type: 'prev' } | { type: 'skip' };

/** 키 → 동작. 0~3(숫자열·숫자패드), ←, S. 그 밖은 null. */
export function keyAction(key: string): LabelAction | null {
  if (/^[0-3]$/.test(key)) return { type: 'score', score: Number(key) as Score };
  if (key === 'ArrowLeft') return { type: 'prev' };
  if (key === 's' || key === 'S' || key === 'ㄴ') return { type: 'skip' };   // 한글 자판 상태의 S
  return null;
}

/** 한 동작 적용: 점수 → 저장하고 다음 기사, ← → 이전 기사, S → 저장 없이 다음. cursor 는 0..ids.length(끝 = 다 봄). */
export function applyAction(store: LabelStore, channel: string, ids: string[], action: LabelAction, now: string): LabelStore {
  const s = store.sessions[channel] ?? defaultSession();
  const cur = Math.min(s.cursor, ids.length);
  let labels = store.labels, cursor = cur;
  if (action.type === 'prev') cursor = Math.max(0, cur - 1);
  else if (cur < ids.length) {
    if (action.type === 'score') labels = { ...labels, [channel]: { ...(labels[channel] ?? {}), [ids[cur]]: { score: action.score, labeled_at: now } } };
    cursor = cur + 1;
  }
  return { ...store, labels, sessions: { ...store.sessions, [channel]: { ...s, cursor } } };
}

/** 첫 미라벨 위치(없으면 끝) */
export const firstUnlabeled = (ids: string[], labels: Record<string, Label> = {}) => { const i = ids.findIndex(id => !labels[id]); return i < 0 ? ids.length : i; };

/** 진행률·분포: 표본 안에서 라벨 수, 점수별 건수 */
export function summary(ids: string[], labels: Record<string, Label> = {}) {
  const dist: Record<Score, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let done = 0;
  for (const id of ids) { const l = labels[id]; if (l) { done++; dist[l.score]++; } }
  return { done, total: ids.length, dist };
}
