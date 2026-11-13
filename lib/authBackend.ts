/** 실제 Supabase 연결(AuthBackend 구현). supabase-js 는 로그인을 켠 빌드에서 처음 쓸 때만 불러온다
 *  (스위치가 꺼진 빌드의 첫 화면 번들에는 들어가지 않음). publishable 키만 쓴다 — 비밀 키는 사이트 어디에도 없다. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AUTH_KEY, AUTH_MODE, AUTH_URL } from './authConfig';
import { SESSION_KEY, type AuthBackend, type PwFail, type SignInFail } from './auth';
import { nameFailOf, type NameBackend } from './displayName';

let clientP: Promise<SupabaseClient> | null = null;
function client(): Promise<SupabaseClient> {
  if (AUTH_MODE === 'off') return Promise.reject(new Error('auth off'));
  return clientP ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(AUTH_URL, AUTH_KEY, {
    auth: { storageKey: SESSION_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  }));
}

type Err = { name?: string; status?: number; code?: string; message?: string } | null | undefined;
const isNetwork = (e: Err) => !!e && (e.name === 'AuthRetryableFetchError' || e.status === 0 || (e.status ?? 0) >= 500 || /fetch|network/i.test(e.message ?? ''));
const isRate = (e: Err) => !!e && (e.status === 429 || e.code === 'over_request_rate_limit');
/** 오류 원문은 개발자 콘솔에만(코드·상태만, 비밀번호·토큰은 넣지 않는다) */
const note = (where: string, e: Err) => { if (e) console.error(`[auth] ${where}`, e.status ?? '', e.code ?? e.name ?? ''); };

export const supabaseBackend: AuthBackend & NameBackend = {
  async signIn(email, password) {
    try {
      const { data, error } = await (await client()).auth.signInWithPassword({ email, password });
      if (error || !data.user) {
        note('signIn', error);
        const kind: SignInFail = isRate(error) ? 'rate' : isNetwork(error) ? 'network'
          : (error?.status === 400 || error?.status === 401 || error?.status === 403 || error?.status === 422) ? 'credentials' : 'other';  // 사용 중지 계정(user_banned)도 같은 문구
        return { error: kind };
      }
      return { userId: data.user.id };
    } catch (e) { note('signIn', e as Err); return { error: 'network' }; }
  },

  async fetchAccount(userId) {
    try {
      const sb = await client();
      const { data: s, error: se } = await sb.auth.getSession();
      if (se) { note('session', se); return { error: isNetwork(se) ? 'network' : 'session' }; }
      if (!s.session) return { error: 'session' };
      const [p, a] = await Promise.all([
        sb.from('profiles').select('login_id,display_name').eq('user_id', userId).maybeSingle(),
        sb.from('account_security').select('must_change_password').eq('user_id', userId).maybeSingle(),
      ]);
      const err = p.error ?? a.error;
      if (err) {
        const e = { status: p.error ? p.status : a.status, code: err.code, message: err.message };
        note('account', e);
        return { error: isNetwork(e) ? 'network' : 'other' };
      }
      return {
        loginId: (p.data?.login_id as string | undefined) ?? null,
        displayName: (p.data?.display_name as string | null | undefined) ?? null,
        mustChange: a.data ? a.data.must_change_password !== false : true,   // 행이 없으면 막히는 쪽
      };
    } catch (e) { note('account', e as Err); return { error: 'network' }; }
  },

  async updatePassword(current, next) {
    try {
      const sb = await client();
      const { data: s, error: se } = await sb.auth.getSession();
      if (se) return { error: isNetwork(se) ? 'network' : 'session' };
      if (!s.session) return { error: 'session' };
      // 서버 설정 'Require current password' 켬 → 현재 비밀번호를 함께 보낸다
      const { error } = await sb.auth.updateUser({ password: next, current_password: current });
      if (!error) return { ok: true };
      note('updatePassword', error);
      const code = error.code ?? '';
      const kind: PwFail = isRate(error) ? 'rate' : isNetwork(error) ? 'network'
        : code === 'same_password' ? 'same'
        : code === 'weak_password' ? 'weak'
        : /current_password|invalid_credentials/.test(code) || /current password/i.test(error.message) ? 'current'
        : /session|jwt|authorization/.test(code) || error.name === 'AuthSessionMissingError' ? 'session'
        : 'other';
      return { error: kind };
    } catch (e) { note('updatePassword', e as Err); return { error: 'network' }; }
  },

  async setDisplayName(name) {
    try {
      const sb = await client();
      const { data: s, error: se } = await sb.auth.getSession();
      if (se) return { error: isNetwork(se) ? 'network' : 'signIn' };
      if (!s.session) return { error: 'signIn' };
      // 표시 이름은 이 서버 함수로만 바꾼다(supabase/migrations/0002_display_name.sql). profiles 직접 고치기는 서버가 막는다
      const { data, error, status } = await sb.rpc('set_display_name', { new_name: name });
      if (error) { note('setDisplayName', { status, code: error.code, message: error.message }); return { error: nameFailOf({ status, code: error.code, message: error.message }) }; }
      return { name: typeof data === 'string' ? data : name };
    } catch (e) { note('setDisplayName', e as Err); return { error: 'network' }; }
  },

  async signOut() {
    try { await (await client()).auth.signOut({ scope: 'local' }); } catch (e) { note('signOut', e as Err); }
  },

  onSignedOut(cb) {
    let off = () => {};
    let gone = false;
    client().then(sb => {
      if (gone) return;
      const { data } = sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') cb(); });
      off = () => data.subscription.unsubscribe();
    }).catch(() => {});
    return () => { gone = true; off(); };
  },
};
