#!/usr/bin/env node
// 보안 자동 검증(관리자 맥에서만). docs/auth-runbook.md 4단계. 기본은 모의 실행(할 일 목록만), --apply 로 실제 검증.
//   node scripts/admin/verify.mjs [--apply] [--url <프로젝트 URL>]
// 하는 일: 임시 시험 계정 2개(zz-verify-a, zz-verify-b, 무작위 비밀번호 — 화면에 보이지 않음)를 만들고
//   anon 차단, 비밀번호 변경 전 user_state 차단·변경 후 허용, 다른 사용자 행 접근 불가, 프로필·변경 필요 값 위조 불가,
//   상한(북마크 1,000·폴더 20·태그 50·메모 200자), private 함수 비노출, 관리자 초기화 후 다시 차단을 확인한 뒤
//   시험 계정을 지운다(중간에 실패해도 지운다). 필요: SUPABASE_URL, 비밀 키 파일, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ApiError, accounts, loadSecretKey, makeApi, makeOut, makeRedactor, resolveUrl, toEmail } from './lib.mjs';

export const TEST_IDS = ['zz-verify-a', 'zz-verify-b'];
export const CHANNEL = 'zz-verify';
export const STEPS = [
  '1. 시험 계정 2개 만들기(무작위 비밀번호, 출력 안 함) — 변경 필요 = 켬 확인',
  '2. 로그인 안 한 요청(publishable 키): profiles·account_security·user_state 읽기·쓰기 모두 막힘',
  '3. A(비밀번호 변경 전): 자기 변경 필요 = true, user_state 읽기 0행·쓰기 막힘',
  '4. A: profiles(표시 이름·is_admin)·account_security(변경 필요) 고치기 막힘, profiles 만들기 막힘',
  '5. A·B 비밀번호 변경(현재 비밀번호 필요) → 변경 필요 = false(트리거) → A user_state 쓰기·읽기 성공',
  '6. B: A 의 행 읽기 0행, 고치기·지우기 0행, A 의 user_id 로 만들기 막힘, 자기 행 user_id 를 A 로 바꾸기 막힘',
  '7. A: 상한 초과(북마크 1,001·폴더 21·태그 51·메모 201자·북마크당 태그 11) 거절, 한도 안 저장 성공',
  '7-1. A: 사용자당 채널 행 10개 상한(11번째 거절)',
  '8. A: private 함수(password_ready) 직접 호출 불가',
  '9. 관리자 초기화(reset_pending → 비밀번호 변경 → 변경 필요 켬) 뒤 A 의 user_state 다시 막힘, 새 비밀번호로 로그인해도 변경 필요 유지',
  '10. 시험 계정 삭제(행은 함께 삭제) — 실패해도 실행',
];

const pw = () => 'Vf' + randomBytes(18).toString('base64url') + '9';   // 영문+숫자, 24자 이상

export async function runVerify({ admin, anonFor, out, redactor }) {
  const results = [];
  const ok = (name, cond, note = '') => { results.push({ name, ok: !!cond }); out(`${cond ? '✓' : '✗'} ${name}${note ? ' — ' + note : ''}`); };
  const denied = async (name, fn) => {   // 4xx 로 막히면 통과(성공하거나 5xx 면 실패)
    try { const d = await fn(); ok(name, false, `막히지 않음(${Array.isArray(d) ? d.length + '행' : '성공'})`); }
    catch (e) { ok(name, e instanceof ApiError && e.status >= 400 && e.status < 500, e instanceof ApiError ? `HTTP ${e.status} ${e.code}` : '오류'); }
  };
  const rows0 = async (name, fn) => {
    try { const d = await fn(); ok(name, Array.isArray(d) && d.length === 0, `${Array.isArray(d) ? d.length : '?'}행`); }
    catch (e) { ok(name, e instanceof ApiError && e.status >= 400 && e.status < 500, e instanceof ApiError ? `막힘 HTTP ${e.status}` : '오류'); }
  };
  const ids = {}, pass = {};
  try {
    // 1. 시험 계정(이전 실행이 남긴 것은 먼저 지움)
    for (const a of (await accounts(admin)).filter(x => TEST_IDS.includes(x.login_id))) await admin.deleteUser(a.user_id);
    for (const [i, lid] of TEST_IDS.entries()) {
      pass[lid] = pw(); redactor.add(pass[lid]);
      const u = await admin.createUser({ email: toEmail(lid), password: pass[lid], email_confirm: true, app_metadata: { login_id: lid, display_name: `검증용 ${'AB'[i]}` } });
      ids[lid] = u.id;
    }
    const [A, B] = TEST_IDS;
    const sec = async id => ((await admin.select('account_security', `select=must_change_password&user_id=eq.${id}`)) || [])[0];
    ok('1. 시험 계정 생성, 변경 필요 = 켬', (await sec(ids[A]))?.must_change_password === true && (await sec(ids[B]))?.must_change_password === true);
    const prof = ((await admin.select('profiles', `select=login_id,display_name&user_id=eq.${ids[A]}`)) || [])[0];
    ok('1. 트리거가 프로필(login_id·표시 이름)을 만듦', prof?.login_id === A && prof?.display_name === '검증용 A');

    // 2. anon
    const anon = anonFor(null);
    for (const t of ['profiles', 'account_security', 'user_state']) {
      await denied(`2. anon ${t} 읽기 막힘`, () => anon.select(t, 'select=*&limit=1'));
      await denied(`2. anon ${t} 쓰기 막힘`, () => anon.insert(t, t === 'user_state' ? { channel: CHANNEL } : { user_id: ids[A] }));
    }

    // 3·4. A 변경 전
    const tokA = (await anonFor(null).signIn(toEmail(A), pass[A])).access_token; redactor.add(tokA);
    const asA = anonFor(tokA);
    ok('3. A 자기 account_security 읽기: 변경 필요 = true', ((await asA.select('account_security', 'select=must_change_password')) || [])[0]?.must_change_password === true);
    await rows0('3. A(변경 전) user_state 읽기 0행', () => asA.select('user_state', 'select=*'));
    await denied('3. A(변경 전) user_state 만들기 막힘', () => asA.insert('user_state', { channel: CHANNEL }));
    await denied('4. A profiles 표시 이름 고치기 막힘', () => asA.patch('profiles', `user_id=eq.${ids[A]}`, { display_name: '바꿈' }));
    await denied('4. A profiles is_admin 고치기 막힘', () => asA.patch('profiles', `user_id=eq.${ids[A]}`, { is_admin: true }));
    await denied('4. A profiles 만들기 막힘', () => asA.insert('profiles', { user_id: ids[A], login_id: 'zz-forged' }));
    await denied('4. A account_security 변경 필요 = false 위조 막힘', () => asA.patch('account_security', `user_id=eq.${ids[A]}`, { must_change_password: false }));
    ok('4. 위조 시도 뒤에도 변경 필요 = true', (await sec(ids[A]))?.must_change_password === true);

    // 5. 비밀번호 변경
    const tokens = { [A]: tokA };
    for (const lid of [A, B]) {
      const tok = tokens[lid] || (await anonFor(null).signIn(toEmail(lid), pass[lid])).access_token; redactor.add(tok); tokens[lid] = tok;
      const np = pw(); redactor.add(np);
      await anonFor(tok).changeOwnPassword(np, pass[lid]); pass[lid] = np;
      ok(`5. ${lid} 비밀번호 변경 → 변경 필요 = false(트리거)`, (await sec(ids[lid]))?.must_change_password === false);
    }
    const asB = anonFor(tokens[B]);
    const insA = await asA.insert('user_state', { channel: CHANNEL, bookmarks: {}, folders: {}, tags: {} });
    ok('5. A(변경 후) user_state 만들기 성공', Array.isArray(insA) && insA.length === 1);
    ok('5. A user_state 읽기 1행', ((await asA.select('user_state', `select=channel&channel=eq.${CHANNEL}`)) || []).length === 1);

    // 6. 다른 사용자
    await rows0('6. B 가 A 의 행 읽기 0행', () => asB.select('user_state', `select=*&user_id=eq.${ids[A]}`));
    await rows0('6. B 가 A 의 행 고치기 0행', () => asB.patch('user_state', `user_id=eq.${ids[A]}&channel=eq.${CHANNEL}`, { companies: ['위조'] }));
    await rows0('6. B 가 A 의 행 지우기 0행', () => asB.remove('user_state', `user_id=eq.${ids[A]}&channel=eq.${CHANNEL}`));
    await denied('6. B 가 A 의 user_id 로 만들기 막힘', () => asB.insert('user_state', { user_id: ids[A], channel: 'zz-verify-b' }));
    await asB.insert('user_state', { channel: CHANNEL });
    await denied('6. B 가 자기 행 user_id 를 A 로 바꾸기 막힘', () => asB.patch('user_state', `user_id=eq.${ids[B]}&channel=eq.${CHANNEL}`, { user_id: ids[A] }));
    await rows0('6. B profiles 에서 A 행 읽기 0행', () => asB.select('profiles', `select=*&user_id=eq.${ids[A]}`));

    // 7. 상한
    const many = (n, f) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`x${i}`, f(i)]));
    const bm = i => ({ id: `x${i}`, channel: CHANNEL, title: 't', url: 'https://example.invalid/', savedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', tags: [], memo: '' });
    const grp = i => ({ id: `x${i}`, name: `n${i}`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    const q = `user_id=eq.${ids[A]}&channel=eq.${CHANNEL}`;
    await denied('7. 북마크 1,001건 거절', () => asA.patch('user_state', q, { bookmarks: many(1001, bm) }));
    await denied('7. 폴더 21개 거절', () => asA.patch('user_state', q, { folders: many(21, grp) }));
    await denied('7. 태그 51개 거절', () => asA.patch('user_state', q, { tags: many(51, grp) }));
    await denied('7. 메모 201자 거절', () => asA.patch('user_state', q, { bookmarks: { x0: { ...bm(0), memo: '가'.repeat(201) } } }));
    await denied('7. 북마크당 태그 11개 거절', () => asA.patch('user_state', q, { bookmarks: { x0: { ...bm(0), tags: Array.from({ length: 11 }, (_, i) => `t${i}`) } } }));
    const fine = await asA.patch('user_state', q, { bookmarks: many(1000, bm), folders: many(20, grp), tags: many(50, grp) });
    ok('7. 한도 안(북마크 1,000·폴더 20·태그 50) 저장 성공', Array.isArray(fine) && fine.length === 1);
    for (let i = 1; i < 10; i++) await asA.insert('user_state', { channel: `${CHANNEL}-${i}` });
    await denied('7-1. 채널 행 11번째 거절', () => asA.insert('user_state', { channel: `${CHANNEL}-10` }));

    // 8. private 함수
    await denied('8. private.password_ready 직접 호출 불가', () => asA.rpc('password_ready'));

    // 9. 관리자 초기화(scripts/admin/users.mjs reset-password 와 같은 순서)
    await admin.patch('account_security', `user_id=eq.${ids[A]}`, { reset_pending: true });
    const tmp = pw(); redactor.add(tmp);
    await admin.updateUser(ids[A], { password: tmp });
    ok('9. 비밀번호 변경 직후에도 변경 필요 = true(reset_pending 트리거)', (await sec(ids[A]))?.must_change_password === true);
    await admin.patch('account_security', `user_id=eq.${ids[A]}`, { must_change_password: true, reset_pending: false });
    await rows0('9. 초기화 뒤 A 의 user_state 읽기 0행(막힘)', () => asA.select('user_state', 'select=*'));
    const tokA2 = (await anonFor(null).signIn(toEmail(A), tmp)).access_token; redactor.add(tokA2);
    ok('9. 초기화한 비밀번호로 로그인한 뒤에도 변경 필요 = true(로그인이 해시를 다시 쓰지 않음)', (await sec(ids[A]))?.must_change_password === true);
    await rows0('9. 새로 로그인한 A 의 user_state 읽기 0행(막힘)', () => anonFor(tokA2).select('user_state', 'select=*'));
  } catch (e) {
    ok('검증 도중 오류(남은 단계 중단)', false, e instanceof ApiError ? e.message : '오류');
  } finally {
    // 10. 정리
    for (const lid of TEST_IDS) {
      try {
        const id = ids[lid] || (await accounts(admin)).find(x => x.login_id === lid)?.user_id;
        if (id) await admin.deleteUser(id);
      } catch (e) { ok(`10. ${lid} 삭제`, false, e instanceof ApiError ? e.message : '오류'); }
    }
    try {
      const left = (await accounts(admin)).filter(x => TEST_IDS.includes(x.login_id)).length;
      ok('10. 시험 계정 정리', left === 0, left ? `${left}개 남음 — 대시보드에서 지우세요` : '');
    } catch { ok('10. 시험 계정 정리 확인', false, '확인 못 함'); }
  }
  const bad = results.filter(r => !r.ok).length;
  out(bad ? `검증 실패 ${bad}건 / 전체 ${results.length}건` : `모두 통과(${results.length}건)`);
  return results;
}

async function main(argv) {
  const redactor = makeRedactor();
  const out = makeOut(redactor);
  try {
    const apply = argv.includes('--apply');
    const ui = argv.indexOf('--url');
    const url = resolveUrl(ui >= 0 ? argv[ui + 1] : null);
    if (!apply) {
      out('[모의 실행 — 아무것도 하지 않음, 실제 검증은 --apply] 할 일:');
      for (const s of STEPS) out('  ' + s);
      return 0;
    }
    const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
    if (!pub.startsWith('sb_publishable_')) throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY(sb_publishable_…)를 환경 변수로 주세요.');
    const { key, warnings } = loadSecretKey();
    redactor.add(key);
    for (const w of warnings) out('경고: ' + w);
    const admin = makeApi({ url, key, redactor, adminBearer: process.env.HEUKSEOK_ADMIN_BEARER === '1' });
    const anonFor = token => makeApi({ url, key: pub, redactor, userToken: token || undefined });
    const r = await runVerify({ admin, anonFor, out, redactor });
    return r.every(x => x.ok) ? 0 : 1;
  } catch (e) {
    out('오류: ' + (e && e.message ? e.message : '알 수 없는 오류'));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; });
}
export { main };
