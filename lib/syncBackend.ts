/** 서버(user_state) 연결: RowBackend 의 Supabase 구현. 본인 행만 읽고 쓴다(RLS + user_id 조건). publishable 키와 로그인 세션만 쓴다.
 *  서버가 일시 중지·무응답이면 15초 뒤 'network' 로 실패시킨다(화면은 기기 사본으로 계속 동작). 콘솔에는 상태·코드만 남긴다. */
import { client } from './authBackend';
import { type RowBackend, SyncError, type SyncFail } from './sync';
import type { Row } from './syncMerge';

const COLS = 'rev,schema_version,bookmarks,folders,tags,read_at,last_confirmed,companies';
const TIMEOUT_MS = 15_000;
type PgErr = { code?: string; message?: string } | null;

function kindOf(status: number, e: PgErr): SyncFail {
  const code = e?.code ?? '';
  if (status === 0 || status >= 500 || /fetch|network|abort/i.test(e?.message ?? '')) return 'network';
  if (status === 401 || status === 403 || code === '42501' || code.startsWith('PGRST3')) return 'auth';
  if (code === '23514') return 'limit';   // 서버 상한(supabase/migrations/0001_init.sql check_user_state_limits)
  return 'other';
}
const fail = (where: string, status: number, e: PgErr): never => {
  const k = kindOf(status, e);
  console.error(`[sync] ${where}`, status, e?.code ?? '');
  throw new SyncError(k);
};
async function withTimeout<T>(run: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try { return await run(ac.signal); }
  catch (e) { if (e instanceof SyncError) throw e; console.error('[sync] request', (e as Error)?.name ?? ''); throw new SyncError('network'); }
  finally { clearTimeout(t); }
}

export function supabaseRows(userId: string): RowBackend {
  const table = async () => (await client()).from('user_state');
  return {
    async getRev(channel) {
      return withTimeout(async signal => {
        const { data, error, status } = await (await table()).select('rev').eq('user_id', userId).eq('channel', channel).abortSignal(signal).maybeSingle();
        if (error) fail('getRev', status, error);
        return data ? Number((data as { rev: number }).rev) : null;
      });
    },
    async getRow(channel) {
      return withTimeout(async signal => {
        const { data, error, status } = await (await table()).select(COLS).eq('user_id', userId).eq('channel', channel).abortSignal(signal).maybeSingle();
        if (error) fail('getRow', status, error);
        if (!data) return null;
        const r = data as unknown as Row & { rev: number };
        return { rev: Number(r.rev), row: r };
      });
    },
    async update(channel, row, expectRev) {
      return withTimeout(async signal => {
        const { data, error, status } = await (await table()).update({ ...row, rev: expectRev + 1 }).eq('user_id', userId).eq('channel', channel).eq('rev', expectRev).abortSignal(signal).select('rev');
        if (error) fail('update', status, error);
        const rows = (data ?? []) as { rev: number }[];
        return rows.length ? Number(rows[0].rev) : null;   // 0행 = 다른 기기가 먼저 올림
      });
    },
    async insert(channel, row) {
      return withTimeout(async signal => {
        const { data, error, status } = await (await table()).insert({ user_id: userId, channel, ...row, rev: 1 }).abortSignal(signal).select('rev');
        if (error) { if (error.code === '23505') return null; fail('insert', status, error); }
        const rows = (data ?? []) as { rev: number }[];
        return rows.length ? Number(rows[0].rev) : null;
      });
    },
  };
}
