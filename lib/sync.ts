/** 서버 동기화 한 번(채널 하나). 저장소·서버는 주입받아 브라우저·Supabase 없이 테스트한다(tests/sync.test.ts).
 *  순서(docs/auth-plan.md 3.4): rev 확인 → (달라졌으면) 행 받기 → 3-방향 병합 → 기기 사본 저장 → 서버와 다르면 올리기(rev 가 같을 때만).
 *  올리다 rev 가 어긋나면(다른 기기가 먼저 올림) 처음부터 다시(최대 4번). 실패해도 기기 사본은 이미 저장돼 있어 사라지지 않는다. */
import { type KV } from './auth.ts';
import { type Base, type Row, baseOf, contentHash, fromRow, mergeStates3, sameContent, toRow } from './syncMerge.ts';
import { EMPTY_STATE, type UserState, fromStored, storageKey, toStored } from './userState.ts';

/** 동기화로 기기 사본이 바뀌었음을 화면(useSaved)에 알리는 이벤트. detail: { userId, channel } */
export const SYNC_EVENT = 'heukseok:sync';
export type SyncFail = 'network' | 'auth' | 'limit' | 'other';
export class SyncError extends Error {
  kind: SyncFail;
  constructor(kind: SyncFail, msg: string = kind) { super(msg); this.kind = kind; }
}

/** 서버(user_state, 본인 행만 — RLS). 실패는 SyncError 로 던진다 */
export interface RowBackend {
  getRev(channel: string): Promise<number | null>;                                  // 행이 없으면 null
  getRow(channel: string): Promise<{ rev: number; row: Partial<Row> } | null>;
  update(channel: string, row: Row, expectRev: number): Promise<number | null>;     // 새 rev, rev 가 어긋나면 null
  insert(channel: string, row: Row): Promise<number | null>;                        // 새 rev, 이미 있으면(동시 insert) null
}

/** 마지막으로 서버와 맞춘 기록: rev, 그때 내용의 해시, 3-방향 병합 기준본, 보낼 것 있음, 맞춘 시각 */
export type SyncMeta = { rev: number | null; hash: string | null; base: Base | null; dirty: boolean; at: string | null };
const EMPTY_META: SyncMeta = { rev: null, hash: null, base: null, dirty: false, at: null };
export const syncKey = (channel: string, userId: string) => `heukseok-sync-v1:${channel}@${userId}`;
export const accountKeyOf = (channel: string, userId: string) => `${storageKey(channel)}@${userId}`;

export function readMeta(kv: KV, channel: string, userId: string): SyncMeta {
  try { const j = JSON.parse(kv.get(syncKey(channel, userId)) ?? 'null'); return j && typeof j === 'object' ? { ...EMPTY_META, ...j } : EMPTY_META; } catch { return EMPTY_META; }
}
export const writeMeta = (kv: KV, channel: string, userId: string, m: SyncMeta) => kv.set(syncKey(channel, userId), JSON.stringify(m));
/** 화면에서 바꿨음(다음 동기화 때 보낸다) */
export const markDirty = (kv: KV, channel: string, userId: string) => { const m = readMeta(kv, channel, userId); if (!m.dirty) writeMeta(kv, channel, userId, { ...m, dirty: true }); };

const loadRaw = (kv: KV, channel: string, userId: string) => kv.get(accountKeyOf(channel, userId));
const parseState = (raw: string | null, channel: string, now: string): UserState => {
  if (raw === null) return EMPTY_STATE;
  try { return fromStored(JSON.parse(raw), channel, undefined, now); } catch { return EMPTY_STATE; }
};

/** 한 채널을 맞춘다. changed: 서버 내용이 들어와 기기 사본이 바뀜(화면을 다시 읽어야 함) */
export async function syncChannel(be: RowBackend, kv: KV, userId: string, channel: string, now: () => string = () => new Date().toISOString()): Promise<{ changed: boolean; pushed: boolean }> {
  let changed = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const meta = readMeta(kv, channel, userId);
    const raw = loadRaw(kv, channel, userId);
    const local = parseState(raw, channel, now());
    const rev = await be.getRev(channel);
    let merged = local, server: UserState | null = null, serverRev = rev;
    if (rev !== null && !(rev === meta.rev && meta.hash)) {   // 다른 기기가 올렸거나 처음 맞춤 → 받아서 합친다
      const got = await be.getRow(channel);
      if (!got) continue;
      serverRev = got.rev;
      server = fromRow(got.row, channel);
      merged = mergeStates3(meta.rev === null ? null : meta.base, local, server);
    }
    // 서버를 기다리는 동안 화면에서 바뀌었으면 처음부터(화면의 변경을 덮어쓰지 않게)
    if (loadRaw(kv, channel, userId) !== raw) continue;
    if (!sameContent(merged, local)) { kv.set(accountKeyOf(channel, userId), JSON.stringify(toStored(channel, merged))); changed = true; }
    const hash = contentHash(merged);
    const needPush = server ? !sameContent(merged, server) : rev === null || hash !== meta.hash;
    let newRev = serverRev;
    if (needPush) {
      newRev = rev === null ? await be.insert(channel, toRow(merged)) : await be.update(channel, toRow(merged), serverRev!);
      if (newRev === null) continue;   // 다른 기기가 먼저 → 받아서 다시
    }
    const stillDirty = contentHash(parseState(loadRaw(kv, channel, userId), channel, now())) !== hash;   // 올리는 사이 화면에서 또 바꿨으면 다음에 보냄
    writeMeta(kv, channel, userId, { rev: newRev, hash, base: baseOf(merged), dirty: stillDirty, at: now() });
    return { changed, pushed: needPush };
  }
  throw new SyncError('other', 'conflict');
}
