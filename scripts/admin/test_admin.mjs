// node scripts/admin/test_admin.mjs — 계정 관리 스크립트 단위 테스트(Supabase 에 요청하지 않음, 가짜 서버 사용).
// 실행: tests/test_admin_scripts.py 가 CI 에서 부른다. 가짜 키·학번은 실행 중에 만들어 저장소 비밀 검사에 걸리지 않게 한다.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError, REPO_ROOT, fmtKst, insideRepo, loadSecretKey, makeApi, makeOut, makeRedactor, parseCsv, parseEnvText, planCreate, resolveUrl, rowProblems, toEmail } from './lib.mjs';
import { cmdCheck, cmdCreate, cmdList, cmdResetPassword, cmdSetDisabled } from './commands.mjs';
import { main as usersMain } from './users.mjs';
import { main as verifyMain, runVerify, STEPS, TEST_IDS } from './verify.mjs';

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

// 7-1) 시각 표시: 서버 UTC → 한국 시간(실행 환경 시간대와 무관), 없으면 '—'
await t('kst', async () => {
  assert.equal(fmtKst('2026-11-13T04:23:00Z'), '2026-11-13 13:23');
  assert.equal(fmtKst('2026-11-13T04:23:45.123456+00:00'), '2026-11-13 13:23');   // Supabase 형식(마이크로초·+00:00)
  assert.equal(fmtKst('2026-11-13T15:30:00Z'), '2026-11-14 00:30');               // 날짜 넘어감
  assert.equal(fmtKst('2026-12-31T15:00:00Z'), '2027-01-01 00:00');               // 해 넘어감
  for (const v of [null, undefined, '']) assert.equal(fmtKst(v), '—');
  assert.equal(fmtKst('not-a-date'), '?');
  const S = fakeServer([['kim', '김철수']]);
  S.users[0].last_sign_in_at = '2026-11-13T04:23:00Z';
  const { out } = capture();
  await cmdList({ api: S.api, out });
  assert.ok(out.lines.some(l => l.endsWith('마지막 로그인(한국 시간)')), out.lines.join('\n'));
  assert.ok(out.lines.some(l => l.startsWith('kim | ') && l.endsWith('| 2026-11-13 13:23')), out.lines.join('\n'));
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

// ── verify --apply 흐름(가짜 서버). 실제 Auth 서버처럼 트리거가 볼 때 app_metadata 가 아직 비어 있다(표시 이름 null) ──
function fakeVerifyServer(opt = {}) {
  const users = [], profiles = [], sec = [], states = [], chats = [], rpcLog = [], secrets = [];
  let n = 0;
  const E = (s, c, m = '') => new ApiError(s, c, m);
  const own = (arr, id) => arr.find(r => r.user_id === id);
  const qv = (q, k) => (new RegExp(`${k}=eq\\.([^&]+)`).exec(q || '') || [])[1];
  const tableOf = t => ({ profiles, account_security: sec, user_state: states, chat_messages: chats }[t]);
  const onPassword = id => { const s = own(sec, id); s.must_change_password = s.reset_pending; s.reset_pending = false; };   // 0001 on_auth_password_changed
  const admin = {
    listUsers: async () => ({ users: users.map(u => ({ id: u.id, email: u.email })) }),
    deleteUser: async id => { for (const arr of [users, profiles, sec, states, ...(opt.noChatCascade ? [] : [chats])]) for (let i = arr.length - 1; i >= 0; i--) if ((arr[i].user_id ?? arr[i].id) === id) arr.splice(i, 1); return {}; },
    createUser: async b => {
      const id = `v${++n}`, lid = b.email.split('@')[0];
      secrets.push(b.password);
      users.push({ id, email: b.email, password: b.password });
      sec.push({ user_id: id, must_change_password: true, reset_pending: false });                       // 트리거(INSERT 직후)
      profiles.push({ user_id: id, login_id: lid, display_name: opt.triggerFillsName ? b.app_metadata.display_name : null, display_name_changed_at: null });
      return { id };                                                                                       // app_metadata 는 그 뒤에 기록
    },
    updateUser: async (id, b) => { users.find(u => u.id === id).password = b.password; secrets.push(b.password); onPassword(id); return {}; },
    select: async (t, q) => {
      const inIds = (/user_id=in\.\(([^)]*)\)/.exec(q || '') || [])[1];
      return tableOf(t).filter(r => (!qv(q, 'user_id') || r.user_id === qv(q, 'user_id')) && (!inIds || inIds.split(',').includes(r.user_id))).map(r => ({ ...r }));
    },
    patch: async (t, q, row) => {
      const id = qv(q, 'user_id');
      if (t === 'profiles' && 'display_name' in row && opt.dropNameFix && users.find(u => u.id === id)?.email.startsWith(opt.dropNameFix)) return [];
      const rs = tableOf(t).filter(r => r.user_id === id); rs.forEach(r => Object.assign(r, row)); return rs.map(r => ({ ...r }));
    },
  };
  const tooBig = r => (r.bookmarks && (Object.keys(r.bookmarks).length > 3000 || Object.values(r.bookmarks).some(b => b.memo.length > 1000 || b.tags.length > 50)))
    || (r.folders && Object.keys(r.folders).length > 100) || (r.tags && Object.keys(r.tags).length > 200);
  const anonFor = tok => {
    const id = tok ? tok.slice(4) : null;
    const me = () => { if (!id || !users.some(u => u.id === id)) throw E(401, '42501', 'permission denied'); return id; };
    const ready = () => own(sec, me()).must_change_password === false;
    const mine = q => states.filter(r => r.user_id === me() && (!qv(q, 'user_id') || r.user_id === qv(q, 'user_id')) && (!qv(q, 'channel') || r.channel === qv(q, 'channel')));
    // 0003 채팅 함수(같은 규칙의 간이판)
    const ART_KEYS = ['id', 'cluster_id', 'channel', 'title', 'source', 'url', 'published_at'];
    const artOk = a => a && typeof a === 'object' && Object.entries(a).every(([k, v]) => ART_KEYS.includes(k) && typeof v === 'string')
      && ['insurance', 'ai', 'finance'].includes(a.channel) && /^https?:\/\/\S+$/i.test(a.url) && a.url.length <= 2048 && [...a.title].length <= 200 && !!a.id;
    const chatRpc = async (fn, args) => {
      if (!id) throw E(401, '42501', `permission denied for function ${fn}`);
      if (!ready()) throw E(403, 'PT403', 'not_allowed');
      const p = own(profiles, id);
      if (fn === 'chat_list') {
        const lim = Math.min(Math.max(args.p_limit ?? 100, 1), 200);
        return chats.filter(r => args.p_before == null || r.id < args.p_before).sort((x, y) => y.id - x.id).slice(0, lim)
          .map(({ id: i, user_id, author_name, body, article, created_at, deleted_at }) => ({ id: i, user_id, author_name, body, article, created_at, deleted_at }));
      }
      if (fn === 'chat_delete') {
        const m = chats.find(r => r.id === args.p_id);
        if (!m) throw E(404, 'PT404', 'not_found');
        if (m.user_id !== id && !p.is_admin) throw E(403, 'PT403', 'not_allowed');
        if (!m.deleted_at && !(opt.deleteKeepsBody)) Object.assign(m, { body: null, article: null, deleted_at: new Date().toISOString(), deleted_by: id });
        return { id: m.id, deleted_at: m.deleted_at };
      }
      const b = String(args.p_body ?? '').trim();
      if (!b || [...b].length > 500) throw E(422, 'PT422', 'body_length');
      if (/[\u0001-\u0009\u000b-\u001f\u007f-\u009f]/.test(b)) throw E(422, 'PT422', 'body_format');
      if (args.p_article != null && !artOk(args.p_article)) throw E(422, 'PT422', 'article_format');
      if (!opt.noRateLimit && chats.filter(r => r.user_id === id).length >= 60) throw E(429, 'PT429', 'rate_limited');
      const m = { id: chats.length + 1, user_id: id, author_name: p.display_name || '이름 없음', body: b, article: args.p_article ?? null, created_at: new Date().toISOString(), deleted_at: null, deleted_by: null };
      chats.push(m);
      return { id: m.id, created_at: m.created_at, author_name: m.author_name };
    };
    return {
      signIn: async (email, password) => {
        const u = users.find(x => x.email === email);
        if (!u || u.password !== password || (opt.signInFails && email.startsWith(opt.signInFails))) throw E(400, 'invalid_credentials');
        return { access_token: `tok-${u.id}` };
      },
      changeOwnPassword: async (np, cur) => { const u = users.find(x => x.id === me()); if (u.password !== cur) throw E(400, 'reauth'); u.password = np; secrets.push(np); onPassword(u.id); return {}; },
      select: async (t, q) => {
        if (t === 'chat_messages') { if (!id) throw E(401, '42501', 'permission denied'); if (!ready()) return []; return chats.filter(r => !qv(q, 'id') || String(r.id) === qv(q, 'id')).map(r => ({ ...r })); }
        me();
        if (t === 'account_security') return sec.filter(r => r.user_id === id).map(r => ({ ...r }));
        if (t === 'profiles') return profiles.filter(r => r.user_id === id && (!qv(q, 'user_id') || qv(q, 'user_id') === id)).map(r => ({ ...r }));
        return ready() ? mine(q).map(r => ({ ...r })) : [];
      },
      insert: async (t, row) => {
        me();
        if (t !== 'user_state' || !ready() || (row.user_id && row.user_id !== id)) throw E(403, '42501', 'row-level security');
        if (states.filter(s => s.user_id === id).length >= 10) throw E(400, 'P0001', 'channel limit');
        const r = { user_id: id, ...row }; states.push(r); return [{ ...r }];
      },
      patch: async (t, q, row) => {
        me();
        if (t !== 'user_state' || 'user_id' in row) throw E(403, '42501', 'permission denied');
        if (!ready()) return [];
        if (tooBig(row)) throw E(400, '23514', 'limit');
        const rs = mine(q); rs.forEach(r => Object.assign(r, row)); return rs.map(r => ({ ...r }));
      },
      remove: async t => { me(); if (t === 'chat_messages') throw E(403, '42501', 'permission denied for table chat_messages'); return []; },
      rpc: async (fn, args = {}) => {
        if (fn.startsWith('chat_')) return chatRpc(fn, args);
        if (fn !== 'set_display_name') throw E(404, 'PGRST202', 'not found');
        if (!id) throw E(401, '42501', 'permission denied for function set_display_name');
        const nm0 = args.new_name ?? '';
        rpcLog.push(nm0);
        if (opt.networkOn === nm0) throw E(0, 'network', 'fetch failed');
        const p = own(profiles, me());
        if (!ready()) throw E(403, 'PT403', 'password_change_required');
        const nm = nm0.replace(/^ +| +$/g, '');
        if (opt.acceptEmpty && nm === '') { p.display_name = '빈칸 버그'; p.display_name_changed_at = Date.now(); return p.display_name; }
        if (!nm) throw E(422, 'PT422', 'name_empty');
        if ([...nm].length > 20) throw E(422, 'PT422', 'name_too_long');
        if (/[\u0000-\u001f\u007f-\u009f]/.test(nm)) throw E(422, 'PT422', 'name_invalid_char');
        if (p.display_name === nm) return nm;
        const norm = s => s.replace(/\s/g, '').toLowerCase();
        if (profiles.some(o => o.user_id !== id && o.display_name && norm(o.display_name) === norm(nm))) throw E(409, 'PT409', 'name_taken');
        if (p.display_name_changed_at && Date.now() - p.display_name_changed_at < 600000) throw E(429, 'PT429', 'too_soon');
        p.display_name = nm; p.display_name_changed_at = Date.now(); return nm;
      },
    };
  };
  return { admin, anonFor, rpcLog, secrets, users };
}
const runFakeVerify = async (opt = {}) => {
  const S = fakeVerifyServer(opt);
  const lines = [], red = makeRedactor(), out = makeOut(red, s => lines.push(s));
  const results = await runVerify({ admin: S.admin, anonFor: S.anonFor, out, redactor: red });
  const text = lines.join('\n');
  for (const s of S.secrets) assert.ok(!text.includes(s), '출력에 비밀번호 없음');
  const R = name => { const r = results.filter(x => x.name === name); assert.equal(r.length, 1, `항목 하나: ${name}`); return r[0].ok; };
  const line = name => lines.find(l => l.slice(2).startsWith(name)) || '';
  return { S, results, R, line, text };
};
const NAME_REJECTS = ['5-1. 21자 거절', '5-1. 빈 값 거절', '5-1. 공백만 거절', '5-1. 제어 문자(줄바꿈) 거절', '5-1. B 의 이름 그대로 거절', '5-1. B 의 이름 공백만 다름 거절', '5-1. B 의 이름 대소문자만 다름 거절'];
const NAME_AFTER = ['5-1. A 표시 이름 변경 성공(앞뒤 공백 지움)', '5-1. profiles 에 반영(변경 시각 기록)', '5-1. 바로 다시 바꾸기 10분 제한 거절', '5-1. 거절 뒤 이름 그대로', '5-1. A profiles 표시 이름 직접 고치기 여전히 막힘', '5-1. A display_name_changed_at 직접 고치기 막힘'];

// 7) 정상 서버: 트리거는 login_id 만, 표시 이름은 스크립트가 채움 → 모든 항목 통과, 시험 계정 삭제
await t('verify-flow', async () => {
  const { S, results, R, line } = await runFakeVerify();
  assert.deepEqual(results.filter(r => !r.ok).map(r => r.name), [], '모두 통과');
  for (const lid of TEST_IDS) { assert.ok(R(`1. ${lid} 트리거가 login_id 로 프로필을 만듦`)); assert.match(line(`1. ${lid} 표시 이름 보정 뒤`), /트리거 결과 비어 있음 → 스크립트가 채움/); }
  // 순서: 4-1(변경 전) → 거절 검사 전부 → 정상 변경 → 바로 두 번째 변경
  assert.deepEqual(S.rpcLog, ['검증 새이름', '가'.repeat(21), '', '   ', '검증\n이름', '검증용 B', '검증용B', '검증용 b', '  검증 새이름  ', '검증 또다른이름']);
  const names = results.map(r => r.name);
  assert.ok(names.indexOf(NAME_REJECTS.at(-1)) < names.indexOf(NAME_AFTER[0]) && names.indexOf(NAME_AFTER[2]) < names.indexOf(NAME_AFTER[4]));
  assert.ok(R('10. 시험 계정 정리')); assert.equal(S.users.length, 0);
  // 트리거가 이미 채운 경우도 같은 결과(보정 없음)
  const r2 = await runFakeVerify({ triggerFillsName: true });
  assert.deepEqual(r2.results.filter(r => !r.ok).map(r => r.name), []);
  assert.match(r2.line('1. zz-verify-a 표시 이름 보정 뒤'), /트리거가 이미 채움/);
});

// 8) 한 항목이 실패해도 남은 항목은 계속, 앞 검사의 성공 변경이 뒤 검사를 10분 제한으로 오탐지하게 하지 않음
await t('verify-independent', async () => {
  // B 표시 이름 보정이 안 됨 → 겹침 3건은 '실행 안 함' 실패, 정상 변경·10분 제한은 그대로 통과
  const b = await runFakeVerify({ dropNameFix: 'zz-verify-b' });
  assert.equal(b.R("1. zz-verify-b 표시 이름 보정 뒤 '검증용 B'"), false);
  for (const n of NAME_REJECTS.slice(4)) { assert.equal(b.R(n), false); assert.match(b.line(n), /실행 안 함/); }
  for (const n of [...NAME_REJECTS.slice(0, 4), ...NAME_AFTER]) assert.ok(b.R(n), n);
  assert.ok(!b.S.rpcLog.includes('검증용 B'), 'B 이름이 없으면 겹침 요청을 보내지 않음');
  // 거절돼야 할 요청이 성공(서버 버그) → 실패로 적고 되돌림, 뒤 검사는 10분 제한에 걸리지 않음
  const e = await runFakeVerify({ acceptEmpty: true });
  for (const n of ['5-1. 빈 값 거절', '5-1. 공백만 거절']) { assert.equal(e.R(n), false); assert.match(e.line(n), /이름이 바뀜 → 되돌림/); }
  for (const n of [...NAME_REJECTS.slice(4), ...NAME_AFTER]) assert.ok(e.R(n), n);
  // 한 요청이 네트워크 오류 → 그 항목만 실패, 다음 항목 계속
  const w = await runFakeVerify({ networkOn: '가'.repeat(21) });
  assert.equal(w.R('5-1. 21자 거절'), false);
  assert.deepEqual(w.results.filter(r => !r.ok).map(r => r.name), ['5-1. 21자 거절']);
  // A 로그인 실패 → A 로 하는 '막힘' 검사가 익명 요청으로 바뀌어 통과로 착각되지 않음, B·정리 단계는 계속
  const s = await runFakeVerify({ signInFails: 'zz-verify-a' });
  assert.equal(s.R('3. A 로그인'), false);
  assert.equal(s.R('4. A profiles 표시 이름 고치기 막힘'), false); assert.match(s.line('4. A profiles 표시 이름 고치기 막힘'), /실행 못 함\(zz-verify-a 로그인 실패\)/);
  assert.ok(s.R('5. zz-verify-b 비밀번호 변경 → 변경 필요 = false(트리거)'));
  assert.ok(s.R('10. 시험 계정 정리'));
  assert.ok(!s.results.some(r => r.name.startsWith('준비 단계 오류')), '중간에 멈추지 않음');
});

// 9) 채팅(0003): 정상 서버는 모두 통과(위 verify-flow), 서버가 규칙을 어기면 해당 항목만 실패
await t('verify-chat', async () => {
  const { results, R, line } = await runFakeVerify();
  for (const n of ['2-2. anon chat_send 막힘', '4-2. A(변경 전) chat_send 막힘', '5-2. A chat_send 성공(응답 = id·created_at·author_name, 표시 이름)',
    '5-3. 기사 첨부 javascript: 주소 거절', '5-3. 직접 delete 막힘', '5-4. 관리자 B 가 A 의 글 삭제(본문·첨부 비움)', '5-5. B 61번째 전송 거절']) assert.ok(R(n), n);
  assert.match(line('10. 시험 계정의 채팅 글 함께 삭제'), /\d+건 → 0건/);
  assert.ok(results.length > 60);
  const c = await runFakeVerify({ noChatCascade: true });
  assert.deepEqual(c.results.filter(r => !r.ok).map(r => r.name), ['10. 시험 계정의 채팅 글 함께 삭제(on delete cascade)']);
  const r = await runFakeVerify({ noRateLimit: true });
  assert.deepEqual(r.results.filter(x => !x.ok).map(x => x.name), ['5-5. B 61번째 전송 거절']);
  const d = await runFakeVerify({ deleteKeepsBody: true });
  assert.deepEqual(d.results.filter(x => !x.ok).map(x => x.name), ['5-4. A 본인 글 삭제 → 본문 비움·삭제 시각', '5-4. 관리자 B 가 A 의 글 삭제(본문·첨부 비움)']);
});

console.log(`admin script tests passed (${passed})`);
