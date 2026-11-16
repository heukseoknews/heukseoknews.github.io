/** 기사 피드백 서버 연결(FeedbackBackend 의 Supabase 구현). components/FeedbackProvider.tsx 가 로그인했을 때만 동적 import 한다.
 *  표 article_feedback(0006)에 RLS 로 본인 행만 읽고 쓴다. 읽기는 채널 단위로 한 번에(1,000행씩 페이지), 쓰기는 한 행씩.
 *  콘솔에는 상태·코드만 남긴다(토큰·기사 목록은 넣지 않는다). 서버가 무응답이면 15초 뒤 실패로 본다. */
import { client } from './authBackend';
import { type FbSignal, type FeedbackBackend, isSignal } from './feedback';

const TIMEOUT_MS = 15_000;
const PAGE = 1000;
type PgErr = { code?: string; message?: string } | null;

const fail = (where: string, status: number, e: PgErr): never => {
  console.error(`[feedback] ${where}`, status, e?.code ?? '');
  throw new Error(`feedback ${where} failed`);
};
async function withTimeout<T>(run: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try { return await run(ac.signal); } finally { clearTimeout(t); }
}

export function supabaseFeedback(uid: string): FeedbackBackend {
  return {
    load(channel) {
      return withTimeout(async signal => {
        const sb = await client();
        const out: Record<string, FbSignal> = {};
        for (let off = 0; off < 20_000; off += PAGE) {
          const { data, error, status } = await sb.from('article_feedback').select('article_id,signal')
            .eq('channel', channel).order('article_id').range(off, off + PAGE - 1).abortSignal(signal);
          if (error) fail('load', status, error);
          const rows = (data ?? []) as { article_id?: unknown; signal?: unknown }[];
          for (const r of rows) if (typeof r.article_id === 'string' && isSignal(r.signal)) out[r.article_id] = r.signal;
          if (rows.length < PAGE) break;
        }
        return out;
      });
    },
    set(channel, id, sig) {
      return withTimeout(async signal => {
        const { error, status } = await (await client()).from('article_feedback')
          .upsert({ user_id: uid, channel, article_id: id, signal: sig }, { onConflict: 'user_id,channel,article_id' }).abortSignal(signal);
        if (error) fail('set', status, error);
      });
    },
    clear(channel, id) {
      return withTimeout(async signal => {
        const { error, status } = await (await client()).from('article_feedback').delete()
          .eq('user_id', uid).eq('channel', channel).eq('article_id', id).abortSignal(signal);
        if (error) fail('clear', status, error);
      });
    },
  };
}
