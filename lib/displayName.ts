/** 표시 이름 직접 변경(마이페이지 → 계정). 서버 함수 public.set_display_name(supabase/migrations/0002_display_name.sql)과 같은 규칙을
 *  저장 전에 화면에서 먼저 검사하고, 서버 오류를 짧은 한 줄로 바꾼다. 브라우저·Supabase 없이 테스트한다(tests/display-name.test.ts). */
import { accountKey, readAccount, sessionUser, writeAccount, type KV } from './auth.ts';

export const NAME_MAX = 20;
/** 서버와 같은 정리: 앞뒤 공백 제거(PostgreSQL btrim 은 공백 문자만 지운다) */
export const cleanName = (raw: string) => raw.replace(/^ +| +$/g, '');
/** 글자 수(서버 char_length 와 같게 코드 포인트로 센다) */
export const nameLength = (s: string) => [...s].length;

export type NameFail = 'empty' | 'tooLong' | 'invalid' | 'taken' | 'tooSoon' | 'signIn' | 'passwordFirst' | 'notReady' | 'network' | 'other';
export const NAME_MSG: Record<NameFail, string> = {
  empty: '이름을 입력해 주세요.',
  tooLong: `${NAME_MAX}자 이하로 정해 주세요.`,
  invalid: '줄바꿈 없이 한 줄로 써 주세요.',
  taken: '이미 쓰는 이름입니다.',
  tooSoon: '잠시 뒤에 다시 바꿀 수 있습니다.',
  signIn: '로그인이 필요합니다.',
  passwordFirst: '비밀번호를 바꾼 뒤에 바꿀 수 있습니다.',
  notReady: '표시 이름 바꾸기는 아직 준비 중입니다.',
  network: '서버에 연결할 수 없습니다.',
  other: '저장하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.',
};

/** 저장 전 검사(서버와 같은 기준). 문제가 없으면 null */
export function nameProblem(raw: string): NameFail | null {
  const n = cleanName(raw);
  if (!n) return 'empty';
  if (nameLength(n) > NAME_MAX) return 'tooLong';
  if (/[\u0000-\u001f\u007f-\u009f]/.test(n)) return 'invalid';
  return null;
}

/** 서버 응답(PostgREST 오류: HTTP 상태·code·message) → 화면 구분. 0002 의 message 키를 먼저 보고, 없으면 상태로 */
export function nameFailOf(e: { status?: number; code?: string; message?: string } | null | undefined): NameFail {
  const status = e?.status ?? 0, code = e?.code ?? '', msg = e?.message ?? '';
  const KEYS: [string, NameFail][] = [['name_taken', 'taken'], ['name_too_long', 'tooLong'], ['name_empty', 'empty'], ['name_invalid_char', 'invalid'],
    ['too_soon', 'tooSoon'], ['not_signed_in', 'signIn'], ['no_profile', 'signIn'], ['password_change_required', 'passwordFirst']];
  for (const [k, v] of KEYS) if (msg.includes(k)) return v;
  // 함수가 아직 없음(0002 적용 전): PostgREST PGRST202 / PostgreSQL 42883
  if (code === 'PGRST202' || code === '42883' || /could not find the function/i.test(msg)) return 'notReady';
  if (status === 0 || status >= 500 || /fetch|network/i.test(msg)) return 'network';
  if (status === 401 || code === 'PGRST301' || code === '42501') return 'signIn';
  if (status === 409 || code === '23505') return 'taken';
  if (status === 429) return 'tooSoon';
  return 'other';
}

/** 서버에 표시 이름 저장을 맡기는 쪽(실제: lib/authBackend.ts, 테스트: 가짜) */
export type NameBackend = { setDisplayName(name: string): Promise<{ name: string } | { error: NameFail }> };

/** 저장: 화면 검사 → 서버 함수 → 계정 사본의 표시 이름 갱신(헤더가 새로고침 없이 바뀜). 결과 문구는 NAME_MSG */
export async function saveDisplayName(b: NameBackend, kv: KV, raw: string, now = new Date().toISOString()): Promise<{ name: string } | { error: NameFail }> {
  const bad = nameProblem(raw);
  if (bad) return { error: bad };
  const userId = sessionUser(kv);
  if (!userId) return { error: 'signIn' };
  const r = await b.setDisplayName(cleanName(raw));
  if ('error' in r) return r;
  const a = readAccount(kv, userId);
  if (a) writeAccount(kv, userId, { ...a, displayName: r.name, checkedAt: now });
  else kv.remove(accountKey(userId));   // 사본이 없으면 다음 확인 때 서버에서 다시 읽는다
  return { name: r.name };
}
