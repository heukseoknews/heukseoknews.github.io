#!/usr/bin/env node
// 보안 자동 검증(관리자 맥에서만). docs/auth-runbook.md 4단계. 기본은 모의 실행(할 일 목록만), --apply 로 실제 검증.
//   node scripts/admin/verify.mjs [--apply] [--url <프로젝트 URL>]
// 하는 일: 임시 시험 계정 2개(zz-verify-a, zz-verify-b, 무작위 비밀번호 — 화면에 보이지 않음)를 만들고
//   anon 차단, 비밀번호 변경 전 user_state 차단·변경 후 허용, 다른 사용자 행 접근 불가, 프로필·변경 필요 값 위조 불가,
//   서버 상한(악용 방지: 북마크 3,000·폴더 100·태그 200·메모 1,000자)과 화면 한도를 넘는 합친 결과 허용, private 함수 비노출, 관리자 초기화 후 다시 차단,
//   표시 이름 변경 함수(set_display_name, 0002)의 권한·검사, 채팅(chat_messages·chat_send·chat_list·chat_delete, 0003)의 권한·검사를 확인한 뒤
//   시험 계정을 지운다(채팅 시험 글은 on delete cascade 로 함께 지워지는지 확인)(중간에 실패해도 지운다). 한 항목이 실패해도 남은 항목은 계속 돌린다(계정 만들기 실패만 중단). 필요: SUPABASE_URL, 비밀 키 파일, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ApiError, accounts, fixNewProfile, loadSecretKey, makeApi, makeOut, makeRedactor, resolveUrl, toEmail } from './lib.mjs';

export const TEST_IDS = ['zz-verify-a', 'zz-verify-b'];
export const TEST_NAMES = ['검증용 A', '검증용 B'];
export const CHANNEL = 'zz-verify';
export const STEPS = [
  '1. 시험 계정 2개 만들기(무작위 비밀번호, 출력 안 함) — 변경 필요 = 켬, 트리거가 login_id 로 프로필을 만듦, 표시 이름은 스크립트가 채운 뒤 확인(검증용 A·B)',
  '2. 로그인 안 한 요청(publishable 키): profiles·account_security·user_state 읽기·쓰기 모두 막힘',
  '2-1. 로그인 안 한 요청: set_display_name 호출 막힘(0002)',
  '2-2. 로그인 안 한 요청: chat_messages 읽기, chat_send·chat_list·chat_delete 호출 모두 막힘(0003)',
  '2-3. 로그인 안 한 요청: chat_mark_read·chat_read_counts 호출, chat_reads 읽기 막힘(0004)',
  '3. A(비밀번호 변경 전): 자기 변경 필요 = true, user_state 읽기 0행·쓰기 막힘',
  '4. A: profiles(표시 이름·is_admin)·account_security(변경 필요) 고치기 막힘, profiles 만들기 막힘',
  '4-1. A(비밀번호 변경 전): set_display_name 호출 막힘',
  '4-2. A(비밀번호 변경 전): chat_messages 읽기 0행, chat_list·chat_send 막힘',
  '4-3. A(비밀번호 변경 전): chat_mark_read·chat_read_counts 막힘(0004)',
  '5. A·B 비밀번호 변경(현재 비밀번호 필요) → 변경 필요 = false(트리거) → A user_state 쓰기·읽기 성공',
  '5-1. A 표시 이름(set_display_name): 거절 검사 먼저(21자·빈 값·공백만·제어 문자·B 의 이름 그대로·공백만 다름·대소문자만 다름) → 정상 변경·profiles 반영 → 바로 두 번째 변경 10분 제한 거절 → profiles 직접 고치기 여전히 막힘',
  '5-2. 채팅: A chat_send(응답 = id·created_at·표시 이름, login_id 없음) → B 가 chat_list·직접 읽기로 봄, 500자 허용·기사 첨부 저장',
  '5-3. 채팅 거절: 빈 글·공백만·501자·제어 문자, 기사 첨부(javascript: 주소·허용 안 한 키·너무 긴 제목·너무 긴 주소·잘못된 channel), 직접 insert·update·delete',
  '5-4. 채팅 삭제: A 본인 글 삭제(본문 비움) · B 가 A 의 글 삭제 거절 · B 에게 관리자 표시(is_admin)를 서비스 키로 임시로 주면 삭제됨 · 목록 페이지(p_limit·p_before)',
  '5-5. 채팅 분당 상한: B 가 60건 보낸 뒤 61번째 거절',
  '5-6. 기사만 있는 글(0004): 본문 없이 기사만 전송됨(body = 빈 문자열) · 본문도 기사도 없으면 거절 · 삭제하면 본문·기사 비움',
  '5-7. 읽음(0004): B 가 읽음 처리하면 A 의 글 읽음 +1, 글쓴이 본인은 세지 않음, 응답은 id·숫자만 · last_read_id 줄지 않음·최대 id 로 맞춤 · 삭제 글 제외 · chat_reads 직접 읽기·쓰기 막힘',
  '6. B: A 의 행 읽기 0행, 고치기·지우기 0행, A 의 user_id 로 만들기 막힘, 자기 행 user_id 를 A 로 바꾸기 막힘',
  '7. A: 서버 상한 초과(북마크 3,001·폴더 101·태그 201·메모 1,001자·북마크당 태그 51) 거절, 화면 한도를 넘는 합친 결과(북마크 2,000·폴더 40·태그 100)와 상한 경계(3,000·100·200) 저장 성공',
  '7-1. A: 사용자당 채널 행 10개 상한(11번째 거절)',
  '8. A: private 함수(password_ready) 직접 호출 불가',
  '9. 관리자 초기화(reset_pending → 비밀번호 변경 → 변경 필요 켬) 뒤 A 의 user_state 다시 막힘, 새 비밀번호로 로그인해도 변경 필요 유지',
  '10. 시험 계정 삭제(행·채팅 글·읽은 위치는 함께 삭제) — 실패해도 실행',
];

const pw = () => 'Vf' + randomBytes(18).toString('base64url') + '9';   // 영문+숫자, 24자 이상

// 앞 단계(로그인 등)가 실패했을 때 쓰는 자리표시: 어떤 호출이든 오류 → '막힘' 검사가 통과로 착각되지 않는다(익명 요청으로 바뀌지 않게)
class Skipped extends Error {}
const deadApi = why => new Proxy({}, { get: () => async () => { throw new Skipped(why); } });

export async function runVerify({ admin, anonFor, out, redactor }) {
  const results = [];
  const ok = (name, cond, note = '') => { results.push({ name, ok: !!cond }); out(`${cond ? '✓' : '✗'} ${name}${note ? ' — ' + note : ''}`); };
  const why = e => e instanceof ApiError ? `HTTP ${e.status} ${e.code}` : e instanceof Skipped ? `실행 못 함(${e.message})` : '오류';
  const is4xx = e => e instanceof ApiError && e.status >= 400 && e.status < 500;
  // 각 검사는 스스로 오류를 받아 실패로 적고 다음 검사로 넘어간다(한 건 오류로 전체가 멈추지 않게)
  const check = async (name, fn) => {   // fn → true/false 또는 [true/false, 메모]
    try { const v = await fn(); const [c, note] = Array.isArray(v) ? v : [v, '']; ok(name, c === true, note); }
    catch (e) { ok(name, false, why(e)); }
  };
  const step = async (name, fn) => {    // 검사가 아닌 준비 동작: 실패하면 실패로 적고 undefined
    try { return await fn(); } catch (e) { ok(name, false, why(e)); return undefined; }
  };
  const denied = async (name, fn) => {   // 4xx 로 막히면 통과(성공하거나 5xx 면 실패)
    try { const d = await fn(); ok(name, false, `막히지 않음(${Array.isArray(d) ? d.length + '행' : '성공'})`); }
    catch (e) { ok(name, is4xx(e), why(e)); }
  };
  // 4xx 로 막히고 오류 메시지에 기대한 키(0002 의 name_taken 등)가 있으면 통과
  const deniedWith = async (name, fn, key) => {
    try { await fn(); ok(name, false, '막히지 않음'); }
    catch (e) { ok(name, is4xx(e) && e.message.includes(key), why(e)); }
  };
  const rows0 = async (name, fn) => {
    try { const d = await fn(); ok(name, Array.isArray(d) && d.length === 0, `${Array.isArray(d) ? d.length : '?'}행`); }
    catch (e) { ok(name, is4xx(e), is4xx(e) ? `막힘 HTTP ${e.status}` : why(e)); }
  };
  const signIn = async (lid, password) => { const t = (await anonFor(null).signIn(toEmail(lid), password)).access_token; redactor.add(t); return t; };
  const asUser = (tok, lid) => tok ? anonFor(tok) : deadApi(`${lid} 로그인 실패`);
  const ids = {}, pass = {};
  try {
    // 1. 시험 계정(이전 실행이 남긴 것은 먼저 지움). 여기서 실패하면 남은 단계는 의미가 없어 중단한다
    for (const a of (await accounts(admin)).filter(x => TEST_IDS.includes(x.login_id))) await admin.deleteUser(a.user_id);
    for (const lid of TEST_IDS) {
      pass[lid] = pw(); redactor.add(pass[lid]);
      const u = await admin.createUser({ email: toEmail(lid), password: pass[lid], email_confirm: true, app_metadata: { login_id: lid, display_name: TEST_NAMES[TEST_IDS.indexOf(lid)] } });
      const id = u && (u.id || (u.user && u.user.id));
      if (!id) throw new ApiError(0, 'no_id', '생성 응답에 사용자 id 가 없습니다');
      ids[lid] = id;
    }
    const [A, B] = TEST_IDS;
    const sec = async id => ((await admin.select('account_security', `select=must_change_password&user_id=eq.${id}`)) || [])[0];
    // display_name_changed_at 은 0002 의 열이라 1단계에서는 읽지 않는다(0002 적용 전에도 1~5단계가 돌게)
    const prof = async (id, cols = 'login_id,display_name') => ((await admin.select('profiles', `select=${cols}&user_id=eq.${id}`)) || [])[0];
    const prof2 = id => prof(id, 'display_name,display_name_changed_at');
    await check('1. 시험 계정 생성, 변경 필요 = 켬', async () => (await sec(ids[A]))?.must_change_password === true && (await sec(ids[B]))?.must_change_password === true);
    // 트리거가 보장하는 것(login_id)과 스크립트가 보정하는 것(표시 이름)을 나눠 확인한다(create 와 같은 lib.fixNewProfile)
    for (const [i, lid] of TEST_IDS.entries()) {
      const fix = await step(`1. ${lid} 트리거가 login_id 로 프로필을 만듦`, () => fixNewProfile(admin, ids[lid], TEST_NAMES[i]));
      if (!fix) continue;
      ok(`1. ${lid} 트리거가 login_id 로 프로필을 만듦`, fix.trigger.login_id === lid);
      await check(`1. ${lid} 표시 이름 보정 뒤 '${TEST_NAMES[i]}'`, async () =>
        [(await prof(ids[lid]))?.display_name === TEST_NAMES[i], fix.fixed ? `트리거 결과 ${fix.trigger.display_name === null ? '비어 있음' : '다름'} → 스크립트가 채움` : '트리거가 이미 채움']);
    }

    // 2. anon
    const anon = anonFor(null);
    for (const t of ['profiles', 'account_security', 'user_state']) {
      await denied(`2. anon ${t} 읽기 막힘`, () => anon.select(t, 'select=*&limit=1'));
      await denied(`2. anon ${t} 쓰기 막힘`, () => anon.insert(t, t === 'user_state' ? { channel: CHANNEL } : { user_id: ids[A] }));
    }
    await denied('2-1. anon set_display_name 호출 막힘', () => anon.rpc('set_display_name', { new_name: '아무개' }));
    await denied('2-2. anon chat_messages 읽기 막힘', () => anon.select('chat_messages', 'select=*&limit=1'));
    await denied('2-2. anon chat_send 막힘', () => anon.rpc('chat_send', { p_body: '익명 글' }));
    await denied('2-2. anon chat_list 막힘', () => anon.rpc('chat_list', {}));
    await denied('2-2. anon chat_delete 막힘', () => anon.rpc('chat_delete', { p_id: 1 }));
    await denied('2-3. anon chat_mark_read 막힘', () => anon.rpc('chat_mark_read', { p_last_id: 1 }));
    await denied('2-3. anon chat_read_counts 막힘', () => anon.rpc('chat_read_counts', { p_ids: [1] }));
    await denied('2-3. anon chat_reads 읽기 막힘', () => anon.select('chat_reads', 'select=*&limit=1'));

    // 3·4. A 변경 전
    const tokens = {};
    tokens[A] = await step('3. A 로그인', () => signIn(A, pass[A]));
    const asA = asUser(tokens[A], A);
    await check('3. A 자기 account_security 읽기: 변경 필요 = true', async () => ((await asA.select('account_security', 'select=must_change_password')) || [])[0]?.must_change_password === true);
    await rows0('3. A(변경 전) user_state 읽기 0행', () => asA.select('user_state', 'select=*'));
    await denied('3. A(변경 전) user_state 만들기 막힘', () => asA.insert('user_state', { channel: CHANNEL }));
    await denied('4. A profiles 표시 이름 고치기 막힘', () => asA.patch('profiles', `user_id=eq.${ids[A]}`, { display_name: '바꿈' }));
    await denied('4. A profiles is_admin 고치기 막힘', () => asA.patch('profiles', `user_id=eq.${ids[A]}`, { is_admin: true }));
    await denied('4. A profiles 만들기 막힘', () => asA.insert('profiles', { user_id: ids[A], login_id: 'zz-forged' }));
    await denied('4. A account_security 변경 필요 = false 위조 막힘', () => asA.patch('account_security', `user_id=eq.${ids[A]}`, { must_change_password: false }));
    await check('4. 위조 시도 뒤에도 변경 필요 = true', async () => (await sec(ids[A]))?.must_change_password === true);
    await deniedWith('4-1. A(변경 전) set_display_name 막힘', () => asA.rpc('set_display_name', { new_name: '검증 새이름' }), 'password_change_required');
    await rows0('4-2. A(변경 전) chat_messages 읽기 0행', () => asA.select('chat_messages', 'select=*'));
    await deniedWith('4-2. A(변경 전) chat_list 막힘', () => asA.rpc('chat_list', {}), 'not_allowed');
    await deniedWith('4-2. A(변경 전) chat_send 막힘', () => asA.rpc('chat_send', { p_body: '변경 전 글' }), 'not_allowed');
    await deniedWith('4-3. A(변경 전) chat_mark_read 막힘', () => asA.rpc('chat_mark_read', { p_last_id: 1 }), 'not_allowed');
    await deniedWith('4-3. A(변경 전) chat_read_counts 막힘', () => asA.rpc('chat_read_counts', { p_ids: [1] }), 'not_allowed');

    // 5. 비밀번호 변경
    for (const lid of [A, B]) {
      if (!tokens[lid]) tokens[lid] = await step(`5. ${lid} 로그인`, () => signIn(lid, pass[lid]));
      if (!tokens[lid]) continue;
      const np = pw(); redactor.add(np);
      const changed = await step(`5. ${lid} 비밀번호 변경 요청`, async () => { await anonFor(tokens[lid]).changeOwnPassword(np, pass[lid]); return true; });
      if (changed) pass[lid] = np;
      await check(`5. ${lid} 비밀번호 변경 → 변경 필요 = false(트리거)`, async () => (await sec(ids[lid]))?.must_change_password === false);
    }
    const asB = asUser(tokens[B], B);
    await check('5. A(변경 후) user_state 만들기 성공', async () => { const r = await asA.insert('user_state', { channel: CHANNEL, bookmarks: {}, folders: {}, tags: {} }); return Array.isArray(r) && r.length === 1; });
    await check('5. A user_state 읽기 1행', async () => ((await asA.select('user_state', `select=channel&channel=eq.${CHANNEL}`)) || []).length === 1);

    // 5-1. 표시 이름 변경(0002). 순서: 거절 검사 전부 → 정상 변경 → 바로 두 번째 변경(10분 제한) → 직접 고치기 막힘.
    //  거절 검사가 뜻밖에 성공하면(이름이 바뀌면) 실패로 적고 관리 키로 이름·변경 시각을 되돌려, 뒤 검사가 10분 제한에 걸려 잘못 판정되지 않게 한다.
    const setName = n => asA.rpc('set_display_name', { new_name: n });
    const rejectName = async (name, input, key) => {
      const before = await prof2(ids[A]).catch(() => undefined);
      try { await setName(input); }
      catch (e) { ok(name, is4xx(e) && e.message.includes(key), why(e)); return; }
      let note = '막히지 않음(이름이 바뀜';
      try { if (before) { await admin.patch('profiles', `user_id=eq.${ids[A]}`, { display_name: before.display_name, display_name_changed_at: before.display_name_changed_at }); note += ' → 되돌림)'; } else note += ' → 되돌리지 못함)'; }
      catch { note += ' → 되돌리지 못함)'; }
      ok(name, false, note);
    };
    await check('5-1. 준비: A 는 아직 표시 이름을 바꾼 적 없음(10분 제한 밖)', async () => (await prof2(ids[A]))?.display_name_changed_at == null);
    await rejectName('5-1. 21자 거절', '가'.repeat(21), 'name_too_long');
    await rejectName('5-1. 빈 값 거절', '', 'name_empty');
    await rejectName('5-1. 공백만 거절', '   ', 'name_empty');
    await rejectName('5-1. 제어 문자(줄바꿈) 거절', '검증\n이름', 'name_invalid_char');
    // 겹침 검사는 B 의 표시 이름이 들어 있어야 의미가 있다(비어 있으면 '정상 변경'이 되어 버린다)
    const bReady = await step('5-1. 준비: B 표시 이름 읽기', async () => (await prof(ids[B]))?.display_name === TEST_NAMES[1]);
    for (const [label, input] of [['그대로', '검증용 B'], ['공백만 다름', '검증용B'], ['대소문자만 다름', '검증용 b']]) {
      if (bReady) await rejectName(`5-1. B 의 이름 ${label} 거절`, input, 'name_taken');
      else ok(`5-1. B 의 이름 ${label} 거절`, false, `실행 안 함(B 표시 이름이 '${TEST_NAMES[1]}' 가 아님 — 1단계 보정 확인)`);
    }
    let renamed = false;
    await check('5-1. A 표시 이름 변경 성공(앞뒤 공백 지움)', async () => { const r = await setName('  검증 새이름  '); renamed = r === '검증 새이름'; return [renamed, typeof r === 'string' ? '' : '응답 형식 다름']; });
    await check('5-1. profiles 에 반영(변경 시각 기록)', async () => { const p = await prof2(ids[A]); return p?.display_name === '검증 새이름' && p?.display_name_changed_at != null; });
    if (renamed) {
      await deniedWith('5-1. 바로 다시 바꾸기 10분 제한 거절', () => setName('검증 또다른이름'), 'too_soon');
      await check('5-1. 거절 뒤 이름 그대로', async () => (await prof2(ids[A]))?.display_name === '검증 새이름');
    } else {
      ok('5-1. 바로 다시 바꾸기 10분 제한 거절', false, '실행 안 함(앞의 정상 변경이 실패)');
    }
    await denied('5-1. A profiles 표시 이름 직접 고치기 여전히 막힘', () => asA.patch('profiles', `user_id=eq.${ids[A]}`, { display_name: '직접' }));
    await denied('5-1. A display_name_changed_at 직접 고치기 막힘', () => asA.patch('profiles', `user_id=eq.${ids[A]}`, { display_name_changed_at: null }));

    // 5-2 ~ 5-5. 채팅(0003). 표시 이름은 보낼 때의 profiles.display_name(5-1 을 거친 지금 값)
    const send = (api, body, article) => api.rpc('chat_send', article === undefined ? { p_body: body } : { p_body: body, p_article: article });
    const list = (api, args = {}) => api.rpc('chat_list', args);
    const rowOf = async (api, id) => ((await list(api, { p_limit: 200 })) || []).find(r => Number(r.id) === Number(id));
    const noLogin = v => { const t = JSON.stringify(v ?? null); return !TEST_IDS.some(l => t.includes(l)) && !t.includes('login_id'); };
    const nameA = (await step('5-2. 준비: A 표시 이름 읽기', () => prof(ids[A])))?.display_name;
    const art = { id: 'zz-verify-art', cluster_id: 'c-zz', channel: 'insurance', title: '검증 기사 제목', source: '검증일보', url: 'https://example.invalid/a?b=1', published_at: '2026-01-01T09:00:00+09:00' };
    let m1, m2;
    await check('5-2. A chat_send 성공(응답 = id·created_at·author_name, 표시 이름)', async () => {
      m1 = await send(asA, '  검증 채팅 1  ');
      const keys = m1 && typeof m1 === 'object' ? Object.keys(m1).sort().join(',') : '';
      return [keys === 'author_name,created_at,id' && Number(m1.id) > 0 && !!nameA && m1.author_name === nameA && noLogin(m1), keys || '응답 형식 다름'];
    });
    await check('5-2. B chat_list 로 A 의 글 읽기(앞뒤 공백 지움, 표시 이름, login_id 없음)', async () => {
      const all = await list(asB);
      const r = (all || []).find(x => Number(x.id) === Number(m1?.id));
      return !!r && r.body === '검증 채팅 1' && r.author_name === nameA && r.deleted_at == null && noLogin(all);
    });
    await check('5-2. B chat_messages 직접 읽기(RLS) 허용, login_id 없음', async () => { const r = await asB.select('chat_messages', `select=*&id=eq.${Number(m1?.id)}`); return Array.isArray(r) && r.length === 1 && noLogin(r); });
    await check('5-2. 500자 글 허용', async () => Number((await send(asA, '가'.repeat(500)))?.id) > 0);
    await check('5-2. 기사 첨부 저장·B 가 같은 모양으로 읽음', async () => {
      m2 = await send(asA, '기사 첨부 검증', art);
      const r = await rowOf(asB, m2?.id);
      return !!r && JSON.stringify(Object.fromEntries(Object.entries(r.article || {}).sort())) === JSON.stringify(Object.fromEntries(Object.entries(art).sort()));
    });
    for (const [label, body] of [['빈 글', ''], ['공백·줄바꿈만', '  \n\t '], ['501자', '가'.repeat(501)]]) await deniedWith(`5-3. ${label} 거절`, () => send(asA, body), 'body_length');
    await deniedWith('5-3. 제어 문자 거절', () => send(asA, '검증\u0007글'), 'body_format');
    const badArts = [
      ['javascript: 주소', { ...art, url: 'javascript:alert(1)' }],
      ['허용 안 한 키', { ...art, memo: '내 메모' }],
      ['너무 긴 제목(201자)', { ...art, title: '가'.repeat(201) }],
      ['너무 긴 주소(2,049자)', { ...art, url: 'https://example.invalid/' + 'a'.repeat(2049 - 24) }],
      ['잘못된 channel', { ...art, channel: 'sports' }],
      ['문자열이 아닌 값', { ...art, title: 123 }],
    ];
    for (const [label, a] of badArts) await deniedWith(`5-3. 기사 첨부 ${label} 거절`, () => send(asA, '기사 첨부 거절 검증', a), 'article_format');
    await denied('5-3. 직접 insert 막힘', () => asA.insert('chat_messages', { user_id: ids[A], author_name: '위조', body: '직접 쓰기' }));
    await denied('5-3. 직접 update 막힘', () => asA.patch('chat_messages', `id=eq.${Number(m1?.id)}`, { body: '위조' }));
    await denied('5-3. 직접 delete 막힘', () => asA.remove('chat_messages', `id=eq.${Number(m1?.id)}`));
    await check('5-3. 직접 쓰기 시도 뒤에도 글 그대로', async () => (await rowOf(asB, m1?.id))?.body === '검증 채팅 1');
    // 5-4. 삭제
    await check('5-4. A 본인 글 삭제 → 본문 비움·삭제 시각', async () => {
      await asA.rpc('chat_delete', { p_id: Number(m1?.id) });
      const r = await rowOf(asB, m1?.id);
      return !!r && r.body === null && r.article === null && r.deleted_at != null;
    });
    await deniedWith('5-4. B 가 A 의 글 삭제 거절', () => asB.rpc('chat_delete', { p_id: Number(m2?.id) }), 'not_allowed');
    await check('5-4. 거절 뒤 A 의 글 그대로', async () => (await rowOf(asA, m2?.id))?.body === '기사 첨부 검증');
    const madeAdmin = await step('5-4. 준비: B 에 관리자 표시(is_admin) 임시로 주기', async () => { await admin.patch('profiles', `user_id=eq.${ids[B]}`, { is_admin: true }); return true; });
    if (madeAdmin) {
      await check('5-4. 관리자 B 가 A 의 글 삭제(본문·첨부 비움)', async () => {
        await asB.rpc('chat_delete', { p_id: Number(m2?.id) });
        const r = await rowOf(asA, m2?.id);
        return !!r && r.body === null && r.article === null && r.deleted_at != null;
      });
      await step('5-4. 정리: B 관리자 표시 끄기', () => admin.patch('profiles', `user_id=eq.${ids[B]}`, { is_admin: false }));
    } else ok('5-4. 관리자 B 가 A 의 글 삭제(본문·첨부 비움)', false, '실행 안 함(준비 실패)');
    await check('5-4. 목록 페이지: p_limit 1 → 가장 최근 1건, p_before → 그보다 작은 id 만', async () => {
      const top = await list(asB, { p_limit: 1 });
      const older = await list(asB, { p_before: Number(m2?.id), p_limit: 200 });
      return Array.isArray(top) && top.length === 1 && Array.isArray(older) && older.length > 0 && older.every(r => Number(r.id) < Number(m2?.id))
        && older.every((r, i) => i === 0 || Number(older[i - 1].id) > Number(r.id));
    });
    // 5-5. 분당 상한(B 는 아직 보낸 글이 없다 → 60건까지 성공, 61번째 거절)
    let sent = 0;
    await step('5-5. 준비: B 가 60건 보내기', async () => { for (let i = 1; i <= 60; i++) { await send(asB, `분당 상한 검증 ${i}`); sent++; } return true; });
    ok('5-5. B 60건 전송 성공', sent === 60, `${sent}건`);
    if (sent === 60) await deniedWith('5-5. B 61번째 전송 거절', () => send(asB, '분당 상한 검증 61'), 'rate_limited');
    else ok('5-5. B 61번째 전송 거절', false, '실행 안 함(앞 60건 실패)');

    // 5-6. 기사만 있는 글(0004). 저장 구분: 기사만 = body ''(빈 문자열), 삭제 = body·article null + deleted_at
    let mA;
    await check('5-6. 본문 없이 기사만 전송(body 빈 문자열·기사 그대로)', async () => {
      mA = await send(asA, '   ', art);
      const r = await rowOf(asB, mA?.id);
      return !!r && r.body === '' && r.deleted_at == null && r.article?.url === art.url;
    });
    await deniedWith('5-6. 본문도 기사도 없으면 거절', () => send(asA, '  ', null), 'body_length');
    await check('5-6. 기사만 있는 글 삭제 → 본문·기사 비움(삭제와 구분)', async () => {
      await asA.rpc('chat_delete', { p_id: Number(mA?.id) });
      const r = await rowOf(asB, mA?.id);
      return !!r && r.body === null && r.article === null && r.deleted_at != null;
    });

    // 5-7. 읽음(0004). 실제 방에 다른 사람(친구)의 읽은 위치도 있으므로 B 가 읽기 전후의 차이로 본다
    const counts = async (api, list) => { const r = await api.rpc('chat_read_counts', { p_ids: list.map(Number) }); return Array.isArray(r) ? r : []; };
    const countOf = async (api, id) => (await counts(api, [id])).find(r => Number(r.id) === Number(id))?.read_count;
    const maxId = async () => Number(((await admin.select('chat_messages', 'select=id&order=id.desc&limit=1')) || [])[0]?.id ?? 0);
    let mR, c0;
    await step('5-7. 준비: A 가 글 하나 보내기(보낸 사람의 읽은 위치는 그 글까지 올라감)', async () => { mR = await send(asA, '읽음 검증'); return true; });
    await check('5-7. 보낸 사람(A)의 읽은 위치가 그 글 이상', async () => Number(((await admin.select('chat_reads', `select=last_read_id&user_id=eq.${ids[A]}`)) || [])[0]?.last_read_id) >= Number(mR?.id));
    await check('5-7. 응답은 id·read_count 만(누가 읽었는지·이름·login_id 없음)', async () => {
      const r = await counts(asB, [mR?.id]);
      const t = JSON.stringify(r);
      c0 = r[0]?.read_count;
      return [r.length === 1 && Object.keys(r[0]).sort().join(',') === 'id,read_count' && Number.isInteger(c0) && !Object.values(ids).some(u => t.includes(u)) && !TEST_NAMES.some(n => t.includes(n)) && noLogin(r) && !!nameA && !t.includes(nameA), `읽음 ${c0}(글쓴이 A 는 세지 않음${c0 ? ', 방의 다른 사람 포함' : ''})`];
    });
    await check('5-7. B 가 읽음 처리 → A 의 글 읽음 +1', async () => {
      const v = await asB.rpc('chat_mark_read', { p_last_id: Number(mR?.id) });
      const c1 = await countOf(asA, mR?.id);
      return [Number(v) >= Number(mR?.id) && c1 === c0 + 1, `${c0} → ${c1}(동시에 방을 읽은 사람이 있으면 다시 실행)`];
    });
    // 글쓴이 제외: 함수의 읽음 수 = 서비스 키로 직접 센 '글쓴이가 아닌 사용자 중 그 글까지 읽은 사람 수'(A 의 읽은 위치는 이미 그 글 이상)
    await check('5-7. 글쓴이 본인(A)은 세지 않음(서비스 키로 센 값과 같음)', async () => {
      await asA.rpc('chat_mark_read', { p_last_id: Number(mR?.id) });
      const fn = await countOf(asB, mR?.id);
      const direct = ((await admin.select('chat_reads', `select=user_id&last_read_id=gte.${Number(mR?.id)}&user_id=neq.${ids[A]}`)) || []).length;
      return [fn === direct, `함수 ${fn} · 직접 ${direct}`];
    });
    await check('5-7. last_read_id 는 줄어들지 않음', async () => { const v = await asB.rpc('chat_mark_read', { p_last_id: 1 }); return Number(v) >= Number(mR?.id); });
    await check('5-7. 최대 id 를 넘는 값은 최대 id 로', async () => {
      const lo = await maxId(); const v = Number(await asB.rpc('chat_mark_read', { p_last_id: 9_000_000_000 })); const hi = await maxId();
      return [v >= lo && v <= hi, `${v}(방의 최대 id ${lo}~${hi})`];
    });
    await check('5-7. 삭제된 글은 읽음 수에서 빠짐', async () => { const r = await counts(asB, [mA?.id, mR?.id]); return r.length === 1 && Number(r[0].id) === Number(mR?.id); });
    await denied('5-7. chat_reads 직접 읽기 막힘', () => asB.select('chat_reads', 'select=*'));
    await denied('5-7. chat_reads 직접 만들기 막힘', () => asB.insert('chat_reads', { user_id: ids[B], last_read_id: 1 }));
    await denied('5-7. chat_reads 직접 고치기 막힘', () => asB.patch('chat_reads', `user_id=eq.${ids[B]}`, { last_read_id: 0 }));
    await denied('5-7. chat_reads 직접 지우기 막힘', () => asB.remove('chat_reads', `user_id=eq.${ids[B]}`));

    // 6. 다른 사용자
    await rows0('6. B 가 A 의 행 읽기 0행', () => asB.select('user_state', `select=*&user_id=eq.${ids[A]}`));
    await rows0('6. B 가 A 의 행 고치기 0행', () => asB.patch('user_state', `user_id=eq.${ids[A]}&channel=eq.${CHANNEL}`, { companies: ['위조'] }));
    await rows0('6. B 가 A 의 행 지우기 0행', () => asB.remove('user_state', `user_id=eq.${ids[A]}&channel=eq.${CHANNEL}`));
    await denied('6. B 가 A 의 user_id 로 만들기 막힘', () => asB.insert('user_state', { user_id: ids[A], channel: 'zz-verify-b' }));
    await step('6. 준비: B 자기 user_state 만들기', () => asB.insert('user_state', { channel: CHANNEL }));
    await denied('6. B 가 자기 행 user_id 를 A 로 바꾸기 막힘', () => asB.patch('user_state', `user_id=eq.${ids[B]}&channel=eq.${CHANNEL}`, { user_id: ids[A] }));
    await rows0('6. B profiles 에서 A 행 읽기 0행', () => asB.select('profiles', `select=*&user_id=eq.${ids[A]}`));

    // 7. 서버 상한(악용 방지용 넉넉한 값). 화면 한도(1,000·20·50·200자·10)를 넘는 합친 결과는 통과해야 한다
    const many = (n, f) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`x${i}`, f(i)]));
    const bm = i => ({ id: `x${i}`, channel: CHANNEL, title: 't', url: 'https://example.invalid/', savedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', tags: [], memo: '' });
    const grp = i => ({ id: `x${i}`, name: `n${i}`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    const q = `user_id=eq.${ids[A]}&channel=eq.${CHANNEL}`;
    const saved1 = async row => { const r = await asA.patch('user_state', q, row); return Array.isArray(r) && r.length === 1; };
    await denied('7. 북마크 3,001건 거절', () => asA.patch('user_state', q, { bookmarks: many(3001, bm) }));
    await denied('7. 폴더 101개 거절', () => asA.patch('user_state', q, { folders: many(101, grp) }));
    await denied('7. 태그 201개 거절', () => asA.patch('user_state', q, { tags: many(201, grp) }));
    await denied('7. 메모 1,001자 거절', () => asA.patch('user_state', q, { bookmarks: { x0: { ...bm(0), memo: '가'.repeat(1001) } } }));
    await denied('7. 북마크당 태그 51개 거절', () => asA.patch('user_state', q, { bookmarks: { x0: { ...bm(0), tags: Array.from({ length: 51 }, (_, i) => `t${i}`) } } }));
    await check('7. 화면 한도를 넘는 합친 결과(북마크 2,000·폴더 40·태그 100) 저장 성공', () => saved1({ bookmarks: many(2000, bm), folders: many(40, grp), tags: many(100, grp) }));
    await check('7. 서버 상한 경계(북마크 3,000·폴더 100·태그 200) 저장 성공', () => saved1({ bookmarks: many(3000, bm), folders: many(100, grp), tags: many(200, grp) }));
    await check('7. 메모 1,000자·북마크당 태그 50 저장 성공', () => saved1({ bookmarks: { x0: { ...bm(0), memo: '가'.repeat(1000), tags: Array.from({ length: 50 }, (_, i) => `t${i}`) } } }));
    const extra = await step('7-1. 준비: 채널 행 9개 더 만들기', async () => { for (let i = 1; i < 10; i++) await asA.insert('user_state', { channel: `${CHANNEL}-${i}` }); return true; });
    if (extra) await denied('7-1. 채널 행 11번째 거절', () => asA.insert('user_state', { channel: `${CHANNEL}-10` }));
    else ok('7-1. 채널 행 11번째 거절', false, '실행 안 함(준비 실패)');

    // 8. private 함수
    await denied('8. private.password_ready 직접 호출 불가', () => asA.rpc('password_ready'));

    // 9. 관리자 초기화(scripts/admin/users.mjs reset-password 와 같은 순서)
    const tmp = pw(); redactor.add(tmp);
    const reset = await step('9. 준비: 관리자 초기화(reset_pending → 비밀번호 변경)', async () => {
      await admin.patch('account_security', `user_id=eq.${ids[A]}`, { reset_pending: true });
      await admin.updateUser(ids[A], { password: tmp });
      return true;
    });
    if (reset) {
      await check('9. 비밀번호 변경 직후에도 변경 필요 = true(reset_pending 트리거)', async () => (await sec(ids[A]))?.must_change_password === true);
      await step('9. 준비: 변경 필요 켬·reset_pending 끔', () => admin.patch('account_security', `user_id=eq.${ids[A]}`, { must_change_password: true, reset_pending: false }));
      await rows0('9. 초기화 뒤 A 의 user_state 읽기 0행(막힘)', () => asA.select('user_state', 'select=*'));
      const tokA2 = await step('9. 초기화한 비밀번호로 A 로그인', () => signIn(A, tmp));
      await check('9. 초기화한 비밀번호로 로그인한 뒤에도 변경 필요 = true(로그인이 해시를 다시 쓰지 않음)', async () => !!tokA2 && (await sec(ids[A]))?.must_change_password === true);
      await rows0('9. 새로 로그인한 A 의 user_state 읽기 0행(막힘)', () => asUser(tokA2, A).select('user_state', 'select=*'));
    }
  } catch (e) {
    ok('준비 단계 오류(남은 단계 중단)', false, e instanceof ApiError ? e.message : '오류');
  } finally {
    // 10. 정리(지우기 전에 시험 계정의 채팅 글 수를 세어 두고, 지운 뒤 0건인지 본다 — on delete cascade)
    const chatQ = () => `select=id&user_id=in.(${TEST_IDS.map(l => ids[l]).filter(Boolean).join(',')})`;
    let chatBefore = null, readsBefore = null;
    if (Object.keys(ids).length) {
      try { chatBefore = ((await admin.select('chat_messages', chatQ())) || []).length; } catch { chatBefore = null; }
      try { readsBefore = ((await admin.select('chat_reads', chatQ().replace('select=id', 'select=user_id'))) || []).length; } catch { readsBefore = null; }
    }
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
    if (chatBefore) {
      try { const left = ((await admin.select('chat_messages', chatQ())) || []).length; ok('10. 시험 계정의 채팅 글 함께 삭제(on delete cascade)', left === 0, `${chatBefore}건 → ${left}건`); }
      catch { ok('10. 시험 계정의 채팅 글 함께 삭제 확인', false, '확인 못 함'); }
    }
    if (readsBefore) {
      try { const left = ((await admin.select('chat_reads', chatQ().replace('select=id', 'select=user_id'))) || []).length; ok('10. 시험 계정의 읽은 위치 함께 삭제(on delete cascade)', left === 0, `${readsBefore}행 → ${left}행`); }
      catch { ok('10. 시험 계정의 읽은 위치 함께 삭제 확인', false, '확인 못 함'); }
    }
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
