import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authModeOf } from '../lib/authConfig.ts';
import {
  type Account, type AccountRow, type AuthBackend, type KV, type PwFail, type SignInFail,
  CHANGE_PATH, LOGIN_ID_KEY, LOGIN_PATH, MSG, SESSION_KEY, accountKey, changeHref, changePassword, decideGate, enterChange,
  gateScript, isValidId, login, loginHref, logout, normalizeId, passwordProblem, readAccount, refreshAccount, safeNext, sessionUser, toEmail,
} from '../lib/auth.ts';

// ---------- 아이디 → 내부 이메일 ----------
assert.equal(normalizeId('  Kim.Lee '), 'kim.lee');
assert.equal(toEmail(' Kim_01 '), 'kim_01@users.heukseok.invalid');
for (const ok of ['abc', 'kim_01', 'a.b-c', 'a'.repeat(20)]) assert.ok(isValidId(ok), ok);
for (const bad of ['ab', '1abc', '_abc', 'a'.repeat(21), 'kim lee', 'kim@x', '김철수', '']) assert.ok(!isValidId(bad), bad);

// ---------- next: 같은 사이트 경로만 ----------
for (const ok of ['/', '/insurance/', '/ai/week/?x=1', '/me/data/?ch=ai#import=abc', '/#import=xyz']) assert.equal(safeNext(ok), ok, ok);
for (const bad of ['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', ' /insurance/', '/\t/evil.example',
  '/\n/evil', 'evil', '', '/login/', '/login', '/login/change-password/', '/login?next=/x', null, undefined, '/' + 'a'.repeat(2001)])
  assert.equal(safeNext(bad as string), '/', String(bad));
assert.equal(loginHref('/ai/?q=1'), '/login/?next=%2Fai%2F%3Fq%3D1');
assert.equal(changeHref('https://evil.example'), '/login/change-password/?next=%2F');

// ---------- 비밀번호 규칙(화면) ----------
const P = (next: string, o: Partial<Parameters<typeof passwordProblem>[0]> = {}) => passwordProblem({ next, confirm: next, current: 'oldpass1', loginId: 'kim01', ...o });
assert.equal(P('abcd123'), MSG.weak, '8자 미만');
assert.equal(P('abcdefgh'), MSG.weak, '숫자 없음');
assert.equal(P('1234-5678'), MSG.weak, '영문 없음');
assert.equal(P('a1' + 'b'.repeat(71)), MSG.tooLong);
assert.equal(P('xKIM01yz9'), MSG.hasId, '아이디 포함(대소문자 무관)');
assert.equal(P('oldpass1'), MSG.same, '현재와 같음');
assert.equal(P('newpass22', { confirm: 'newpass23' }), MSG.mismatch);
assert.equal(P('newpass22'), null);

// ---------- 스위치 ----------
const URL_OK = 'https://abcdefgh.supabase.co', KEY_OK = 'sb_publishable_TestKey_123';
assert.equal(authModeOf(undefined, undefined, '1'), 'off');
assert.equal(authModeOf(URL_OK, '', '1'), 'off', '키 없음');
assert.equal(authModeOf('', KEY_OK, '1'), 'off', 'URL 없음');
assert.equal(authModeOf(URL_OK, 'eyJhbGciOiJIUzI1NiJ9.e30.sig', '1'), 'off', '예전 JWT 키는 받지 않음');
assert.equal(authModeOf(URL_OK, 'sb_' + 'secret_' + 'x'.repeat(24), '1'), 'off', '비밀 키는 받지 않음');
assert.equal(authModeOf('abcdefgh.supabase.co', KEY_OK, '1'), 'off', 'URL 형식');
assert.equal(authModeOf(URL_OK, KEY_OK, undefined), 'optional');
assert.equal(authModeOf(URL_OK, KEY_OK, 'false'), 'optional');
for (const on of ['1', 'true', 'TRUE', 'on', 'yes', ' 1 ']) assert.equal(authModeOf(URL_OK, KEY_OK, on), 'required', on);
assert.equal(authModeOf('http://localhost:54321', KEY_OK, '1'), 'required', '로컬 시험 서버');

// ---------- 저장소·가짜 서버 ----------
const kvOf = (init: Record<string, string> = {}): KV & { m: Map<string, string> } => {
  const m = new Map(Object.entries(init));
  return { m, get: k => m.get(k) ?? null, set: (k, v) => { m.set(k, v); }, remove: k => { m.delete(k); } };
};
const SESSION = (id = 'u1') => JSON.stringify({ access_token: 'a', refresh_token: 'r', user: { id } });
const ACC = (mustChange: boolean, loginId = 'kim01'): Account => ({ loginId, displayName: '김일', mustChange, checkedAt: 'T' });

type Fake = AuthBackend & { calls: string[]; down: boolean; row: AccountRow; pw: string; signInFail?: SignInFail; pwFail?: PwFail; applyChange: boolean };
const fake = (kv: KV, o: Partial<Fake> = {}): Fake => {
  const f: Fake = {
    calls: [], down: false, row: { loginId: 'kim01', displayName: '김일', mustChange: true }, pw: 'oldpass1', applyChange: true, ...o,
    async signIn(email, password) {
      f.calls.push(`signIn:${email}`);
      if (f.down) return { error: 'network' };
      if (f.signInFail) return { error: f.signInFail };
      if (email !== 'kim01@users.heukseok.invalid' || password !== f.pw) return { error: 'credentials' };
      kv.set(SESSION_KEY, SESSION('u1'));   // supabase-js 가 세션을 저장하는 것처럼
      return { userId: 'u1' };
    },
    async fetchAccount(userId) {
      f.calls.push(`account:${userId}`);
      if (f.down) return { error: 'network' };
      if (!sessionUser(kv)) return { error: 'session' };
      return { ...f.row };
    },
    async updatePassword(current, next) {
      f.calls.push('update');
      if (f.down) return { error: 'network' };
      if (f.pwFail) return { error: f.pwFail };
      if (current !== f.pw) return { error: 'current' };
      if (next === f.pw) return { error: 'same' };
      f.pw = next;
      if (f.applyChange) f.row = { ...f.row, mustChange: false };   // DB 트리거가 '변경 필요'를 끈다
      return { ok: true };
    },
    async signOut() { f.calls.push('signOut'); if (f.down) throw new Error('down'); },
    onSignedOut() { return () => {}; },
  };
  return f;
};

// ---------- 로그인 ----------
{
  const kv = kvOf(); const b = fake(kv);
  assert.deepEqual(await login(b, kv, { id: '', password: 'x', next: '/', remember: false }), { message: MSG.needBoth });
  assert.deepEqual(await login(b, kv, { id: '1bad', password: 'x', next: '/', remember: false }), { message: MSG.credentials }, '형식 아님: 같은 문구');
  assert.equal(b.calls.length, 0, '형식이 아니면 서버에 묻지 않음');
  assert.deepEqual(await login(b, kv, { id: 'kim01', password: 'wrong123', next: '/', remember: true }), { message: MSG.credentials });
  assert.equal(kv.get(LOGIN_ID_KEY), null, '실패하면 아이디를 저장하지 않음');
  assert.deepEqual(await login(fake(kv, { signInFail: 'credentials' }), kv, { id: 'nobody', password: 'x1234567', next: '/', remember: false }), { message: MSG.credentials }, '없는 아이디·사용 중지도 같은 문구');
  assert.deepEqual(await login(fake(kv, { signInFail: 'rate' }), kv, { id: 'kim01', password: 'x', next: '/', remember: false }), { message: MSG.rate });
  assert.deepEqual(await login(fake(kv, { down: true }), kv, { id: 'kim01', password: 'x', next: '/', remember: false }), { message: MSG.network });
  assert.equal(MSG.credentials, '아이디 또는 비밀번호가 맞지 않습니다.');
  assert.equal(MSG.network, '로그인 서버에 연결할 수 없습니다.');
  assert.equal(MSG.rate, '잠시 후 다시 시도해 주세요.');
  // 성공 + 변경 필요 → 변경 화면(next 유지), 아이디 저장, 계정 사본
  const r = await login(b, kv, { id: ' KIM01 ', password: 'oldpass1', next: '/ai/?q=1', remember: true });
  assert.deepEqual(r, { go: changeHref('/ai/?q=1') });
  assert.equal(kv.get(LOGIN_ID_KEY), 'kim01');
  assert.equal(readAccount(kv, 'u1')!.mustChange, true);
  assert.ok(![...kv.m.values()].some(v => v.includes('oldpass1')), '비밀번호는 저장하지 않음');
}
{
  const kv = kvOf({ [LOGIN_ID_KEY]: 'kim01' }); const b = fake(kv, { row: { loginId: 'kim01', displayName: null, mustChange: false } });
  assert.deepEqual(await login(b, kv, { id: 'kim01', password: 'oldpass1', next: 'https://evil.example/', remember: false }), { go: '/' }, '외부 next 무시');
  assert.equal(kv.get(LOGIN_ID_KEY), null, '아이디 저장 끄면 지움');
  const kv2 = kvOf(); const b2 = fake(kv2, { row: { loginId: 'kim01', displayName: '김일', mustChange: false } });
  assert.deepEqual(await login(b2, kv2, { id: 'kim01', password: 'oldpass1', next: '/insurance/', remember: false }), { go: '/insurance/' });
  // 로그인은 됐는데 계정 상태를 못 읽음 → 변경 화면이 다시 확인
  const kv3 = kvOf(); const b3 = fake(kv3); b3.fetchAccount = async () => ({ error: 'network' });
  assert.deepEqual(await login(b3, kv3, { id: 'kim01', password: 'oldpass1', next: '/x/', remember: false }), { go: changeHref('/x/') });
}

// ---------- 장벽 판정 ----------
const G = (mode: 'off' | 'optional' | 'required', path: string, userId: string | null, account: Account | null) => decideGate({ mode, path, userId, account });
assert.equal(G('off', '/insurance/', null, null), 'open', '스위치 꺼짐: 언제나 열림');
assert.equal(G('required', '/insurance/', null, null), 'login');
assert.equal(G('optional', '/insurance/', null, null), 'open', 'optional: 장벽 없음');
assert.equal(G('required', '/login/', null, null), 'open', '로그인 화면은 장벽 밖');
assert.equal(G('required', CHANGE_PATH, 'u1', ACC(true)), 'open');
assert.equal(G('required', '/', 'u1', null), 'change', '사본 없음 → 변경 화면이 서버 확인');
assert.equal(G('required', '/', 'u1', ACC(true)), 'change');
assert.equal(G('optional', '/', 'u1', ACC(true)), 'change', 'optional 이라도 로그인했으면 변경 먼저');
assert.equal(G('required', '/', 'u1', ACC(false)), 'open');

// 인라인 스크립트(<head>)가 decideGate 와 같은 판정을 하는지
const runScript = (mode: 'off' | 'optional' | 'required', path: string, store: Record<string, string>) => {
  const src = gateScript(mode);
  if (!src) return { to: null, attr: null };
  let to: string | null = null, attr: string | null = null;
  const location = { pathname: path, search: '?q=1', hash: '#h', replace: (u: string) => { to = u; } };
  const localStorage = { getItem: (k: string) => store[k] ?? null };
  const document = { documentElement: { setAttribute: (_k: string, v: string) => { attr = v; } } };
  new Function('location', 'localStorage', 'document', src)(location, localStorage, document);
  return { to: to as string | null, attr: attr as string | null };
};
assert.equal(gateScript('off'), '', '꺼진 빌드에는 스크립트 없음');
for (const mode of ['optional', 'required'] as const)
  for (const path of ['/', '/insurance/', '/me/', '/login/', CHANGE_PATH])
    for (const sess of [null, 'u1', 'broken'] as const)
      for (const acc of [null, ACC(true), ACC(false), 'broken'] as const) {
        const store: Record<string, string> = {};
        if (sess === 'u1') store[SESSION_KEY] = SESSION('u1');
        if (sess === 'broken') store[SESSION_KEY] = '{oops';
        if (acc === 'broken') store[accountKey('u1')] = '{"mustChange":"no"}';
        else if (acc) store[accountKey('u1')] = JSON.stringify(acc);
        const kv = kvOf(store);
        const userId = sessionUser(kv);
        const want = decideGate({ mode, path, userId, account: userId ? readAccount(kv, userId) : null });
        const got = runScript(mode, path, store);
        const gotGate = got.to === null ? 'open' : got.to.startsWith(LOGIN_PATH + '?') ? 'login' : got.to.startsWith(CHANGE_PATH + '?') ? 'change' : 'other';
        assert.equal(gotGate, want, `${mode} ${path} ${sess} ${JSON.stringify(acc)}`);
        if (got.to) {
          assert.ok(got.to.endsWith('?next=' + encodeURIComponent(path + '?q=1#h')), '원래 주소를 next 로');
          assert.equal(got.attr, 'leaving', '옮기는 동안 본문 숨김');
        }
      }

// ---------- 비밀번호 변경 화면 ----------
{
  const kv = kvOf(); const b = fake(kv);
  assert.deepEqual(await enterChange(b, kv, { next: '/ai/' }), { go: loginHref('/ai/') }, '세션 없음 → 로그인');
  kv.set(SESSION_KEY, SESSION());
  const e1 = await enterChange(b, kv, { next: '/ai/' });
  assert.ok('form' in e1 && e1.form!.loginId === 'kim01', '변경 필요 → 폼');
  b.row = { ...b.row, mustChange: false };
  assert.deepEqual(await enterChange(b, kv, { next: '/ai/' }), { go: '/ai/' }, '이미 바꾼 계정 → next');
  // 서버가 안 될 때: 사본이 '바꿈'이면 next(마지막 상태), 사본이 없거나 '변경 필요'면 폼
  b.down = true;
  assert.deepEqual(await enterChange(b, kv, { next: '/ai/' }), { go: '/ai/' });
  kv.remove(accountKey('u1'));
  assert.deepEqual(await enterChange(b, kv, { next: '/ai/' }), { form: null });
}
{
  const kv = kvOf({ [SESSION_KEY]: SESSION() }); const b = fake(kv);
  const C = (o: Partial<Parameters<typeof changePassword>[2]>) => changePassword(b, kv, { current: 'oldpass1', next: 'newpass22', confirm: 'newpass22', loginId: 'kim01', nextPath: '/me/', ...o });
  assert.deepEqual(await C({ next: 'short1', confirm: 'short1' }), { message: MSG.weak });
  assert.deepEqual(await C({ next: 'kim01pass9', confirm: 'kim01pass9' }), { message: MSG.hasId });
  assert.deepEqual(await C({ next: 'oldpass1', confirm: 'oldpass1' }), { message: MSG.same });
  assert.deepEqual(await C({ confirm: 'newpass23' }), { message: MSG.mismatch });
  assert.equal(b.calls.filter(c => c === 'update').length, 0, '화면 규칙에 걸리면 서버에 보내지 않음');
  assert.deepEqual(await C({ current: 'wrongpw1' }), { message: MSG.current });
  b.down = true; assert.deepEqual(await C({}), { message: MSG.network }); b.down = false;
  b.pwFail = 'rate'; assert.deepEqual(await C({}), { message: MSG.rate });
  b.pwFail = 'session'; assert.deepEqual(await C({}), { go: loginHref('/me/') }); b.pwFail = undefined;
  // 서버가 바꿨다고 했지만 '변경 필요'가 꺼지지 않음 → 오류
  b.applyChange = false;
  assert.deepEqual(await C({}), { message: MSG.notApplied });
  b.applyChange = true; b.pw = 'oldpass1';
  assert.deepEqual(await C({ nextPath: '//evil.example' }), { go: '/' });
  assert.equal(readAccount(kv, 'u1')!.mustChange, false, '사본 갱신');
  assert.ok(![...kv.m.values()].some(v => /oldpass1|newpass22/.test(v)), '비밀번호는 저장하지 않음');
}

// ---------- 뒤에서 다시 읽기: 서버 오류면 마지막 상태 유지 ----------
{
  const kv = kvOf({ [SESSION_KEY]: SESSION(), [accountKey('u1')]: JSON.stringify(ACC(false)) });
  const b = fake(kv, { down: true });
  assert.equal(await refreshAccount(b, kv, { mode: 'required', path: '/insurance/' }), 'open', '서버 장애: 튕기지 않음');
  assert.equal(readAccount(kv, 'u1')!.mustChange, false);
  b.down = false; b.row = { loginId: 'kim01', displayName: '김일', mustChange: true };   // 관리자가 초기화함
  assert.equal(await refreshAccount(b, kv, { mode: 'required', path: '/insurance/' }), 'change');
}

// ---------- 로그아웃: 세션만(기기 안 북마크·읽음은 그대로) ----------
{
  const kv = kvOf({ [SESSION_KEY]: SESSION(), [accountKey('u1')]: JSON.stringify(ACC(false)), 'heukseok-v2:insurance': '{"bookmarks":{}}', [LOGIN_ID_KEY]: 'kim01' });
  const b = fake(kv, { down: true });
  await logout(b, kv);
  assert.equal(kv.get(SESSION_KEY), null, '서버가 안 돼도 이 기기 세션은 지움');
  assert.equal(kv.get(accountKey('u1')), null);
  assert.equal(kv.get('heukseok-v2:insurance'), '{"bookmarks":{}}', '북마크 유지');
  assert.equal(kv.get(LOGIN_ID_KEY), 'kim01', '저장한 아이디 유지');
}

// ---------- 화면 코드: 스위치 꺼짐이면 지금 그대로, publishable 키만, 비밀번호 출력 없음 ----------
const src = (f: string) => readFileSync(f, 'utf8');
assert.ok(src('app/layout.tsx').includes("{AUTH_MODE === 'off' ? children : <AuthGate>{children}</AuthGate>}"));
assert.ok(src('components/SiteHeader.tsx').includes("{AUTH_MODE === 'off' ? <li>{meLink}</li> : <AccountMenu"));
assert.ok(src('app/page.tsx').includes("{AUTH_MODE === 'off' ? meLink : <AccountMenu"));
const backend = src('lib/authBackend.ts');
assert.ok(backend.includes("storageKey: SESSION_KEY") && backend.includes('detectSessionInUrl: false') && backend.includes('autoRefreshToken: true'));
assert.ok(backend.includes("signOut({ scope: 'local' })"), '이 기기만 로그아웃');
assert.ok(backend.includes('current_password: current'), "서버 'Require current password'");
assert.ok(backend.includes("import('@supabase/supabase-js')"), '꺼진 빌드 첫 화면 번들에 넣지 않음(동적 import)');
for (const f of ['lib/auth.ts', 'lib/authBackend.ts', 'lib/authConfig.ts', 'components/LoginForm.tsx', 'components/ChangePasswordForm.tsx', 'components/AccountMenu.tsx', 'components/AuthGate.tsx']) {
  const s = src(f);
  assert.ok(!/service_role|SUPABASE_SECRET|sb_secret_[A-Za-z0-9]/.test(s), `${f}: 비밀 키 없음`);
  assert.ok(!/console\.(log|error|warn)\([^)]*(password|pw\b|cur\b|current\b|next\b)/i.test(s), `${f}: 비밀번호를 콘솔에 내지 않음`);
}
assert.ok(/name="username" autoComplete="username"/.test(src('components/LoginForm.tsx')) && src('components/LoginForm.tsx').includes('autoComplete="current-password"'));
assert.ok(src('components/ChangePasswordForm.tsx').includes('autoComplete="new-password"'));
assert.match(src('app/login/layout.tsx'), /robots: \{ index: false, follow: false \}/, '로그인 화면 noindex');
assert.match(src('.gitignore'), /^\.env\*$/m, '.env.local 제외');
console.log('auth tests passed');
