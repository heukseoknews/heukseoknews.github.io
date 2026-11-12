// node scripts/admin/test_admin.mjs — 계정 관리 스크립트 단위 테스트(Supabase 에 요청하지 않음, 가짜 서버 사용).
// 실행: tests/test_admin_scripts.py 가 CI 에서 부른다. 가짜 키·학번은 실행 중에 만들어 저장소 비밀 검사에 걸리지 않게 한다.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError, REPO_ROOT, insideRepo, loadSecretKey, makeApi, makeOut, makeRedactor, parseCsv, parseEnvText, planCreate, resolveUrl, rowProblems, toEmail } from './lib.mjs';
import { cmdCheck, cmdCreate, cmdList, cmdResetPassword, cmdSetDisabled } from './commands.mjs';
import { main as usersMain } from './users.mjs';
import { main as verifyMain, STEPS } from './verify.mjs';

const FAKE_KEY = ['sb', 'secret', 'x'.repeat(10) + 'TESTONLY' + 'y'.repeat(10)].join('_');   // 가짜(실제 키 아님)
const SN = n => String(20990000 + n);                                                         // 가짜 학번(8자리)
const URL0 = 'https://abcdefghijklmnopqrst.supabase.co';
let passed = 0;
const t = async (name, fn) => { await fn(); passed++; };

// ── 가짜 Supabase: Auth 사용자 + 세 표, SQL 트리거 동작을 흉내 낸다 ──
function fakeServer(seed = []) {
  const calls = [];
  const users = [], profiles = [], sec = [];
  let n = 0;
  const addUser = (login, display) => {
    const id = `u${++n}`;
    users.push({ id, email: toEmail(login), banned_until: null, last_sign_in_at: null, created_at: '2026-11-12T00:00:00Z' });
    profiles.push({ user_id: id, login_id: login, display_name: display, is_admin: false, created_at: '2026-11-12T00:00:00Z' });
    sec.push({ user_id: id, must_change_password: true, password_changed_at: null, reset_pending: false });
    return id;
  };
  for (const [l, d] of seed) addUser(l, d);
  const table = name => ({ profiles, account_security: sec }[name]);
  const where = q => { const m = /user_id=eq\.([^&]+)/.exec(q); return m ? r => r.user_id === m[1] : () => true; };
  const api = {
    calls,
    listUsers: async () => { calls.push(['listUsers']); return { users: users.map(u => ({ ...u })) }; },
    createUser: async b => {
      calls.push(['createUser', { email: b.email, hasPassword: !!b.password, email_confirm: b.email_confirm, app_metadata: b.app_metadata }]);
      const login = b.email.split('@')[0];
      if (profiles.some(p => p.display_name === b.app_metadata.display_name)) throw new ApiError(500, 'unexpected_failure', 'Database error creating new user');
      return { id: addUser(login, b.app_metadata.display_name) };
    },
    updateUser: async (id, b) => {
      calls.push(['updateUser', id, Object.keys(b).sort().join(','), b.ban_duration]);
      if (b.password) { const s = sec.find(x => x.user_id === id); s.must_change_password = s.reset_pending; s.reset_pending = false; }   // on_password_change
      if (b.ban_duration) users.find(u => u.id === id).banned_until = b.ban_duration === 'none' ? null : '2999-01-01T00:00:00Z';
      return {};
    },
    deleteUser: async id => { calls.push(['deleteUser', id]); return {}; },
    select: async (name, q) => { calls.push(['select', name]); const T = table(name); if (!T) return []; return T.filter(where(q)).map(r => ({ ...r })); },
    patch: async (name, q, row) => { calls.push(['patch', name, JSON.stringify(row)]); const T = table(name); const hit = T.filter(where(q)); hit.forEach(r => Object.assign(r, row)); return hit; },
  };
  return { api, users, profiles, sec };
}
const capture = () => { const red = makeRedactor(); const out = makeOut(red, () => {}); return { red, out }; };

// 1) CSV
await t('csv', () => {
  const { rows, errors } = parseCsv(`﻿login_id,display_name,student_no\r\nKim ,"김, 철수",${SN(1)}\r\n\r\nlee,이영희,${SN(2)}\n`);
  assert.deepEqual(errors, []);
  assert.deepEqual(rows.map(r => [r.line, r.login_id, r.display_name, r.student_no]), [[2, 'kim', '김, 철수', SN(1)], [4, 'lee', '이영희', SN(2)]]);
  assert.equal(parseCsv('a,b\n1,2').errors[0].reason.includes('머리줄'), true);
  assert.equal(parseCsv('').errors.length, 1);
  assert.equal(parseCsv('student_no,login_id,display_name\n' + SN(3) + ',park,박').rows[0].login_id, 'park');   // 열 순서 무관
  assert.equal(parseCsv('login_id,display_name,student_no\nkim,김').errors[0].reason, '열 수가 부족합니다');
});

// 2) 검증·계획
await t('validate', () => {
  const r = (line, login_id, display_name, student_no) => ({ line, login_id, display_name, student_no });
  assert.deepEqual(rowProblems(r(1, 'kim', '김', SN(1))), []);
  assert.ok(rowProblems(r(1, '1kim', '김', SN(1)))[0].startsWith('아이디 형식'));
  assert.ok(rowProblems(r(1, 'ab', '김', SN(1)))[0].startsWith('아이디 형식'));
  assert.ok(rowProblems(r(1, 'kim', '김', '1234567')).some(x => x.includes('8자 미만')));
  assert.ok(rowProblems(r(1, 'kim', '', SN(1))).some(x => x.includes('표시 이름')));
  assert.ok(rowProblems(r(1, 'kim', '가'.repeat(21), SN(1))).some(x => x.includes('20자')));
  for (const p of rowProblems(r(1, 'kim', '김', '1234 567'))) assert.ok(!p.includes('1234'), '이유 문구에 학번 값이 없어야 한다');
  const plan = planCreate([r(2, 'kim', '김', SN(1)), r(3, 'lee', '이', SN(2)), r(4, 'lee', '이2', SN(3)), r(5, 'park', '최', SN(4)), r(6, 'choi', '김', SN(5)), r(7, 'old', '옛', SN(6))],
    [{ login_id: 'old', display_name: '옛' }, { login_id: 'x', display_name: '최' }]);
  assert.deepEqual(plan.create.map(x => x.login_id), []);
  assert.deepEqual(plan.skip.map(x => x.login_id), ['old']);
  assert.deepEqual(plan.invalid.map(x => x.login_id).sort(), ['choi', 'kim', 'lee', 'lee', 'park']);   // 표시 이름 '김' 겹침 2, 아이디 lee 겹침 2, '최' 기존과 겹침
  assert.ok(plan.invalid.find(x => x.login_id === 'park').reasons[0].includes('기존 계정(x)'));
});

// 3) 키·URL·가림
await t('key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-admin-'));
  try {
    const p = join(dir, 'supabase.env');
    writeFileSync(p, `# 주석\nexport SUPABASE_SECRET_KEY="${FAKE_KEY}"\n`); chmodSync(p, 0o600);
    const { key, warnings } = loadSecretKey({ path: p });
    assert.equal(key, FAKE_KEY); assert.deepEqual(warnings, []);
    chmodSync(p, 0o644);
    assert.ok(loadSecretKey({ path: p }).warnings[0].includes('chmod 600'));
    writeFileSync(p, 'SUPABASE_SECRET_KEY=eyJhbGciOiJIUzI1NiJ9.e30.abc\n');
    assert.throws(() => loadSecretKey({ path: p }), e => e.message.includes('새 방식 비밀 키') && !e.message.includes('eyJ'));
    assert.throws(() => loadSecretKey({ path: join(dir, 'none.env') }), /읽을 수 없습니다/);
    assert.throws(() => loadSecretKey({ path: join(REPO_ROOT, 'supabase.env') }), /저장소 폴더 안/);
    assert.equal(parseEnvText("A=1\nB='2'\n#C=3").B, '2');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.equal(insideRepo(join(REPO_ROOT, 'x', 'y.csv')), true);
  assert.equal(resolveUrl(null, { SUPABASE_URL: URL0 + '/' }), URL0);
  assert.throws(() => resolveUrl('http://abc.supabase.co', {}), /https/);
  assert.throws(() => resolveUrl(URL0 + '/rest/v1', {}), /경로/);
  assert.throws(() => resolveUrl(null, {}), /URL 이 없습니다/);
  const red = makeRedactor(); red.add(FAKE_KEY); red.add(SN(9));
  const s = red.redact(`k=${FAKE_KEY} sn=${SN(9)} other=sb_secret_${'z'.repeat(20)} jwt=eyJabcdefghij.eyJabcdefghij.sig`);
  assert.ok(!s.includes(FAKE_KEY) && !s.includes(SN(9)) && !s.includes('zzzz') && !s.includes('eyJabcdefghij'), s);
});

// 4) API 헤더: apikey 만, 사용자 토큰이 있을 때만 Authorization
await t('api', async () => {
  const seen = [];
  const f = async (u, o) => { seen.push({ u, o }); return { ok: u.includes('/fail') ? false : true, status: u.includes('/fail') ? 401 : 200, text: async () => (u.includes('/fail') ? JSON.stringify({ msg: `bad ${FAKE_KEY}`, error_code: 'no_authorization' }) : '[]') }; };
  const red = makeRedactor(); red.add(FAKE_KEY);
  const api = makeApi({ url: URL0, key: FAKE_KEY, fetch: f, redactor: red });
  await api.select('profiles', 'select=user_id');
  assert.equal(seen[0].o.headers.apikey, FAKE_KEY);
  assert.equal('Authorization' in seen[0].o.headers, false);
  await makeApi({ url: URL0, key: 'sb_publishable_test', fetch: f, userToken: 'tok' }).select('user_state', 'select=*');
  assert.equal(seen[1].o.headers.Authorization, 'Bearer tok');
  await api.patch('profiles', 'user_id=eq.u1', { display_name: 'x' });
  assert.equal(seen[2].o.method, 'PATCH'); assert.equal(seen[2].o.headers.Prefer, 'return=representation'); assert.equal(seen[2].o.body, '{"display_name":"x"}');
  // adminBearer: Auth 관리 경로에만 Authorization 추가
  const ab = makeApi({ url: URL0, key: FAKE_KEY, fetch: f, adminBearer: true });
  await ab.listUsers(1, 1); await ab.select('profiles', 'select=user_id');
  assert.equal(seen[3].o.headers.Authorization, `Bearer ${FAKE_KEY}`); assert.equal('Authorization' in seen[4].o.headers, false);
  await assert.rejects(() => api.call('GET', '/fail'), e => e instanceof ApiError && e.status === 401 && e.code === 'no_authorization' && !e.message.includes(FAKE_KEY));
});

// 5) create: 모의 실행은 아무것도 바꾸지 않고, 반영은 멱등. 출력에 학번 없음
await t('create', async () => {
  const S = fakeServer([['old', '옛사람']]);
  const { red, out } = capture();
  const rows = parseCsv(`login_id,display_name,student_no\nkim,김철수,${SN(1)}\nold,옛사람,${SN(2)}\nbad!,나쁨,${SN(3)}\nlee,이영희,1234\n`).rows;
  rows.forEach(r => red.add(r.student_no));
  const dry = await cmdCreate({ api: S.api, out, rows });
  assert.deepEqual(dry.plan.create.map(r => r.login_id), ['kim']);
  assert.equal(S.api.calls.some(c => ['createUser', 'updateUser', 'patch'].includes(c[0])), false, '모의 실행은 바꾸지 않는다');
  const r1 = await cmdCreate({ api: S.api, out, rows, apply: true });
  assert.deepEqual(r1.created, ['kim']);
  const cu = S.api.calls.find(c => c[0] === 'createUser')[1];
  assert.deepEqual(cu, { email: 'kim@users.heukseok.invalid', hasPassword: true, email_confirm: true, app_metadata: { login_id: 'kim', display_name: '김철수' } });
  assert.equal(S.sec.find(s => s.user_id === S.profiles.find(p => p.login_id === 'kim').user_id).must_change_password, true);
  const r2 = await cmdCreate({ api: S.api, out, rows, apply: true });   // 다시 실행: 만들 것 없음
  assert.deepEqual(r2.created, []); assert.ok(r2.plan.skip.some(s => s.login_id === 'kim'));
  const text = out.lines.join('\n');
  for (const r of rows) assert.ok(!text.includes(r.student_no), '출력에 학번이 없어야 한다');
  assert.ok(text.includes('검증 실패') && text.includes('8자 미만') && text.includes('아이디 형식'));
});

// 6) reset-password: 순서 ① reset_pending → ② 비밀번호 → ③ must_change true → ④ 확인
await t('reset', async () => {
  const S = fakeServer([['kim', '김철수']]);
  S.sec[0].must_change_password = false;   // 이미 바꾼 계정
  const { red, out } = capture();
  const rows = [{ line: 2, login_id: 'kim', display_name: '김철수', student_no: SN(1) }]; red.add(SN(1));
  assert.equal((await cmdResetPassword({ api: S.api, out, loginId: 'kim', rows })).dryRun, true);
  assert.equal(S.api.calls.some(c => c[0] === 'updateUser' || c[0] === 'patch'), false);
  const r = await cmdResetPassword({ api: S.api, out, loginId: 'kim', rows, apply: true });
  assert.equal(r.ok, true);
  const seq = S.api.calls.filter(c => c[0] === 'patch' || c[0] === 'updateUser').map(c => c[0] === 'patch' ? c[2] : 'PASSWORD');
  assert.deepEqual(seq, ['{"reset_pending":true}', 'PASSWORD', '{"must_change_password":true,"reset_pending":false}']);
  assert.equal(S.sec[0].must_change_password, true);
  assert.ok(!out.lines.join('\n').includes(SN(1)));
  // 비밀번호 변경이 실패하면 reset_pending 을 되돌린다
  const S2 = fakeServer([['kim', '김철수']]);
  S2.api.updateUser = async () => { throw new ApiError(422, 'weak_password', 'x'); };
  assert.equal((await cmdResetPassword({ api: S2.api, out, loginId: 'kim', rows, apply: true })).ok, false);
  assert.equal(S2.sec[0].reset_pending, false);
  assert.equal((await cmdResetPassword({ api: S.api, out, loginId: 'nobody', rows, apply: true })).ok, false);
  assert.equal((await cmdResetPassword({ api: S.api, out, loginId: 'kim', rows: [{ ...rows[0], student_no: '1234' }], apply: true })).ok, false);
});

// 7) list·disable·enable·check
await t('list-disable-check', async () => {
  const S = fakeServer([['kim', '김철수'], ['lee', '이영희']]);
  const { out } = capture();
  const list = await cmdList({ api: S.api, out });
  assert.equal(list.length, 2);
  const text = out.lines.join('\n');
  assert.ok(text.includes('kim | 김철수') && text.includes('변경 필요') && !text.includes('@users.heukseok.invalid'));
  assert.equal((await cmdSetDisabled({ api: S.api, out, loginId: 'kim', disable: true })).dryRun, true);
  assert.equal(S.api.calls.some(c => c[0] === 'updateUser'), false);
  assert.equal((await cmdSetDisabled({ api: S.api, out, loginId: 'kim', disable: true, apply: true })).ok, true);
  assert.equal(S.api.calls.find(c => c[0] === 'updateUser')[3], '876000h');
  assert.equal((await cmdSetDisabled({ api: S.api, out, loginId: 'kim', disable: true, apply: true })).unchanged, true);
  assert.equal((await cmdSetDisabled({ api: S.api, out, loginId: 'kim', disable: false, apply: true })).ok, true);
  assert.equal(S.users[0].banned_until, null);
  const anon = { select: async () => { throw new ApiError(401, '42501', 'permission denied'); } };
  const res = await cmdCheck({ api: S.api, anonApi: anon, out });
  assert.ok(res.every(r => r.ok), JSON.stringify(res));
  // apikey 만으로 401 이고 Bearer 로는 통과 → needs_bearer 로 안내(바꾸는 요청 없음)
  const deny = { ...S.api, listUsers: async () => { throw new ApiError(401, 'no_authorization', 'x'); } };
  const cap2 = capture();
  const r2 = await cmdCheck({ api: deny, anonApi: anon, bearerApi: S.api, out: cap2.out });
  assert.equal(r2[0].ok, false); assert.ok(cap2.out.lines[0].includes('HEUKSEOK_ADMIN_BEARER=1'));
  const leaky = { select: async () => [] };
  assert.equal((await cmdCheck({ api: S.api, anonApi: leaky, out })).filter(r => !r.ok).length, 3, 'anon 이 읽히면 실패로 보고');
});

// 8) users.mjs main: 저장소 안 CSV 거절, 오류 출력에 키 없음(네트워크 호출 전에 끝남)
await t('main', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-admin-'));
  const env = { ...process.env };
  const writes = [];
  const origErr = process.stderr.write.bind(process.stderr);
  try {
    const p = join(dir, 'supabase.env'); writeFileSync(p, `SUPABASE_SECRET_KEY=${FAKE_KEY}\n`); chmodSync(p, 0o600);
    process.env.HEUKSEOK_SECRET_ENV = p; process.env.SUPABASE_URL = URL0;
    process.stderr.write = s => { writes.push(String(s)); return true; };
    const code = await usersMain(['create', '--csv', join(REPO_ROOT, 'accounts.csv')]);
    assert.equal(code, 1);
    assert.ok(writes.join('').includes('저장소 폴더 안'));
    assert.ok(!writes.join('').includes(FAKE_KEY));
    assert.equal(await usersMain(['nope']), 2);
  } finally {
    process.stderr.write = origErr;
    for (const k of ['HEUKSEOK_SECRET_ENV', 'SUPABASE_URL']) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
    rmSync(dir, { recursive: true, force: true });
  }
  // verify.mjs 모의 실행: 할 일 목록만, 네트워크 없음
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('네트워크 호출 금지'); };
  const origOut = process.stdout.write.bind(process.stdout);
  const outs = [];
  process.stdout.write = s => { outs.push(String(s)); return true; };
  try { assert.equal(await verifyMain(['--url', URL0]), 0); } finally { process.stdout.write = origOut; globalThis.fetch = origFetch; }
  assert.equal(outs.filter(l => /^\s+\d+(-\d+)?\./.test(l)).length, STEPS.length);
});

console.log(`admin script tests passed (${passed})`);
