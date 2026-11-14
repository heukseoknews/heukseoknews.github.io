/** 기사 라벨링(/label/): 기사별 '필요 정도' 0~3 을 이 브라우저(localStorage)에만 모은다.
 *  나중에 제거 규칙·점수 모델의 정답 데이터로 쓴다. 눈가림 라벨링이라 화면에는 ★·분류·묶음 같은 내부 판단값을 보여 주지 않는다.
 *  표본 순서: 채널별 고정 시드 + 기사 id 의 해시 순. 기사가 새로 수집돼도 기존 기사끼리의 순서는 그대로다. */

export const LABEL_KEY = 'heukseok-label-v1';
export const BATCH = 150;
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

// ───────── 저장 형식 ─────────
export type Label = { score: Score; labeled_at: string };
export type ChannelSession = { month: string; size: number; cursor: number };
export type LabelStore = {
  version: 1;
  labels: Record<string, Record<string, Label>>;   // 채널 → 기사 id → 라벨
  sessions: Record<string, ChannelSession>;        // 채널 → 기간·표본 크기·현재 위치
  channel?: string;                                // 마지막으로 고른 채널
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
  const { labels, sessions, channel } = j as Partial<LabelStore>;
  if (typeof channel === 'string' && (LABEL_CHANNELS as readonly string[]).includes(channel)) out.channel = channel;
  if (labels && typeof labels === 'object') for (const [ch, rows] of Object.entries(labels)) {
    if (!rows || typeof rows !== 'object') continue;
    for (const [id, l] of Object.entries(rows as Record<string, Partial<Label>>)) {
      if (isId(id) && l && isScore(l.score) && isIso(l.labeled_at)) (out.labels[ch] ??= {})[id] = { score: l.score, labeled_at: l.labeled_at };
    }
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

// ───────── 내보내기·가져오기 ─────────
export type LabelRow = { channel: string; id: string; score: Score; labeled_at: string };

/** 내보내기: [{ channel, id, score, labeled_at }] (채널·라벨 시각·id 순) */
export function toExport(store: LabelStore): LabelRow[] {
  const rows: LabelRow[] = [];
  for (const ch of Object.keys(store.labels).sort())
    for (const [id, l] of Object.entries(store.labels[ch])) rows.push({ channel: ch, id, score: l.score, labeled_at: l.labeled_at });
  return rows.sort((a, b) => (a.channel < b.channel ? -1 : a.channel > b.channel ? 1 : 0) || a.labeled_at.localeCompare(b.labeled_at) || a.id.localeCompare(b.id));
}

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
    if (x && typeof x === 'object' && typeof x.channel === 'string' && /^[a-z0-9-]{1,40}$/.test(x.channel) && isId(x.id) && isScore(x.score) && isIso(x.labeled_at))
      rows.push({ channel: x.channel, id: x.id, score: x.score, labeled_at: x.labeled_at });
    else skipped++;
  }
  return { rows, skipped };
}

/** 병합: 같은 (채널, id) 면 나중 라벨(labeled_at 이 늦은 쪽)이 이긴다. 같은 시각이면 기존 값 유지. */
export function mergeRows(store: LabelStore, rows: LabelRow[]): { store: LabelStore; added: number; updated: number } {
  const labels: LabelStore['labels'] = Object.fromEntries(Object.entries(store.labels).map(([k, v]) => [k, { ...v }]));
  let added = 0, updated = 0;
  for (const r of rows) {
    const ch = (labels[r.channel] ??= {});
    const cur = ch[r.id];
    if (!cur) { ch[r.id] = { score: r.score, labeled_at: r.labeled_at }; added++; }
    else if (Date.parse(r.labeled_at) > Date.parse(cur.labeled_at)) { ch[r.id] = { score: r.score, labeled_at: r.labeled_at }; updated++; }
  }
  return { store: { ...store, labels }, added, updated };
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
