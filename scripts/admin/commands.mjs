// 계정 관리 명령(create · reset-password · list · disable · enable · check). 모두 기본은 모의 실행이고 apply=true 일 때만 바꾼다.
// api 는 lib.makeApi() 와 같은 모양(테스트에서는 가짜 객체). 출력은 out() 만 쓴다(가림 거침). 학번·비밀번호·키는 출력하지 않는다.
import { accounts, fixNewProfile, fmtKst, planCreate, toEmail, ApiError } from './lib.mjs';

const errText = e => (e instanceof ApiError ? e.message : '오류');   // 원문 오류 객체는 출력하지 않는다

function reportPlan(out, plan) {
  if (plan.skip.length) {
    out(`건너뜀 ${plan.skip.length}건:`);
    for (const s of plan.skip) out(`  ${s.line}줄 ${s.login_id} — ${s.reason}`);
  }
  if (plan.invalid.length) {
    out(`검증 실패 ${plan.invalid.length}건(만들지 않음):`);
    for (const s of plan.invalid) out(`  ${s.line}줄 ${s.login_id || '(아이디 없음)'} — ${s.reasons.join(', ')}`);
  }
}

/** CSV 일괄 생성. rows: parseCsv 결과. 이미 있는 아이디는 건너뛴다(멱등). */
export async function cmdCreate({ api, out, rows, csvErrors = [], apply = false }) {
  const existing = await accounts(api);
  const noProfile = existing.filter(a => !a.has_profile);
  const plan = planCreate(rows, existing.map(a => ({ login_id: a.login_id, display_name: a.display_name })));
  for (const e of csvErrors) plan.invalid.push({ line: e.line, login_id: '', reasons: [e.reason] });
  out(`${apply ? '[반영]' : '[모의 실행 — 바꾸지 않음, 반영하려면 --apply]'} 계정 만들기: 대상 ${plan.create.length}건`);
  for (const r of plan.create) out(`  ${r.line}줄 ${r.login_id} (표시 이름: ${r.display_name})`);
  const created = [], failed = [];
  if (apply) {
    for (const r of plan.create) {
      try {
        const u = await api.createUser({ email: toEmail(r.login_id), password: r.student_no, email_confirm: true,
                                          app_metadata: { login_id: r.login_id, display_name: r.display_name } });
        const id = u && (u.id || (u.user && u.user.id));
        if (!id) throw new ApiError(0, 'no_id', '생성 응답에 사용자 id 가 없습니다');
        // 트리거가 만든 프로필·'변경 필요'를 확인하고, 다르면 고친다(트리거는 login_id 를 보장하고 표시 이름은 여기서 채움 — lib.fixNewProfile)
        await fixNewProfile(api, id, r.display_name);
        const [s] = (await api.select('account_security', `select=must_change_password&user_id=eq.${id}`)) || [];
        if (!s || s.must_change_password !== true) await api.patch('account_security', `user_id=eq.${id}`, { must_change_password: true });
        created.push(r.login_id);
        out(`  만듦: ${r.login_id}`);
      } catch (e) {
        failed.push({ line: r.line, login_id: r.login_id, reason: errText(e) });
        out(`  실패: ${r.login_id} — ${errText(e)}`);
      }
    }
  }
  reportPlan(out, plan);
  if (noProfile.length) out(`주의: 프로필 없는 Auth 계정 ${noProfile.length}개(${noProfile.map(a => a.login_id || a.user_id).join(', ')}) — 절차서 '문제가 생겼을 때' 참고`);
  if (failed.length) { out(`실패 ${failed.length}건:`); for (const f of failed) out(`  ${f.line}줄 ${f.login_id} — ${f.reason}`); }
  out(apply ? `끝: 만듦 ${created.length}, 건너뜀 ${plan.skip.length}, 검증 실패 ${plan.invalid.length}, 실패 ${failed.length}`
            : `모의 실행 끝: 만들 예정 ${plan.create.length}, 건너뜀 ${plan.skip.length}, 검증 실패 ${plan.invalid.length}`);
  return { plan, created, failed };
}

/** 비밀번호를 학번(CSV)으로 다시 초기화하고 '변경 필요'를 켠다.
 *  순서(중요): ① reset_pending=true → ② 비밀번호 변경(트리거가 변경 필요 유지) → ③ must_change=true, reset_pending=false → ④ 다시 읽어 확인 */
export async function cmdResetPassword({ api, out, loginId, rows, apply = false }) {
  const row = rows.find(r => r.login_id === loginId);
  if (!row) { out(`CSV 에 ${loginId} 가 없습니다(학번을 찾을 수 없음).`); return { ok: false }; }
  if (row.student_no.length < 8) { out(`${loginId}: 학번(초기 비밀번호)이 8자 미만이라 쓸 수 없습니다.`); return { ok: false }; }
  const acc = (await accounts(api)).find(a => a.login_id === loginId);
  if (!acc) { out(`서버에 ${loginId} 계정이 없습니다.`); return { ok: false }; }
  out(`${apply ? '[반영]' : '[모의 실행 — 바꾸지 않음, 반영하려면 --apply]'} ${loginId}: 비밀번호를 학번으로 초기화하고 첫 로그인 변경을 다시 요구합니다.`);
  if (!apply) return { ok: true, dryRun: true };
  const id = acc.user_id;
  await api.patch('account_security', `user_id=eq.${id}`, { reset_pending: true });
  try {
    await api.updateUser(id, { password: row.student_no });
  } catch (e) {
    await api.patch('account_security', `user_id=eq.${id}`, { reset_pending: false }).catch(() => {});
    out(`실패: 비밀번호를 바꾸지 못했습니다 — ${errText(e)}`);
    return { ok: false };
  }
  await api.patch('account_security', `user_id=eq.${id}`, { must_change_password: true, reset_pending: false });
  const [s] = (await api.select('account_security', `select=must_change_password,reset_pending&user_id=eq.${id}`)) || [];
  const ok = !!s && s.must_change_password === true && s.reset_pending === false;
  out(ok ? `완료: ${loginId} 비밀번호 초기화, 첫 로그인 변경 필요 = 켬(확인함)` : `확인 실패: ${loginId} 의 '변경 필요'가 켜지지 않았습니다. 다시 실행하세요.`);
  return { ok };
}

/** 아이디·표시 이름·상태만(학번·비밀번호·이메일 안 보임) */
export async function cmdList({ api, out }) {
  const list = await accounts(api);
  out(`계정 ${list.length}개`);
  out('아이디 | 표시 이름 | 관리자 | 비밀번호 | 상태 | 마지막 로그인(한국 시간)');
  for (const a of list) {
    out(`${a.login_id || '(프로필 없음)'} | ${a.display_name ?? '(미정)'} | ${a.is_admin ? '예' : '-'} | ${a.must_change === null ? '?' : a.must_change ? '변경 필요' : '변경함'} | ${a.disabled ? '사용 중지' : '사용 중'} | ${fmtKst(a.last_sign_in_at)}`);
  }
  return list;
}

/** 사용 중지(ban 100년) / 다시 사용(ban 해제) */
export async function cmdSetDisabled({ api, out, loginId, disable, apply = false }) {
  const acc = (await accounts(api)).find(a => a.login_id === loginId);
  if (!acc) { out(`서버에 ${loginId} 계정이 없습니다.`); return { ok: false }; }
  if (acc.disabled === disable) { out(`${loginId}: 이미 ${disable ? '사용 중지' : '사용 중'} 상태입니다(바꿀 것 없음).`); return { ok: true, unchanged: true }; }
  out(`${apply ? '[반영]' : '[모의 실행 — 바꾸지 않음, 반영하려면 --apply]'} ${loginId}: ${disable ? '사용 중지(로그인·토큰 갱신 불가)' : '다시 사용'}`);
  if (!apply) return { ok: true, dryRun: true };
  await api.updateUser(acc.user_id, { ban_duration: disable ? '876000h' : 'none' });
  const now = (await accounts(api)).find(a => a.login_id === loginId);
  const ok = !!now && now.disabled === disable;
  out(ok ? `완료: ${loginId} ${disable ? '사용 중지' : '다시 사용'}(확인함)` : `확인 실패: ${loginId} 상태가 바뀌지 않았습니다.`);
  return { ok };
}

/** 연결 확인(읽기 전용). 비밀 키로 Auth 관리 API·표 읽기, (있으면) publishable 키로 anon 차단을 본다. */
export async function cmdCheck({ api, anonApi, bearerApi, out }) {
  const results = [];
  const step = async (name, fn) => {
    try { const msg = await fn(); results.push({ name, ok: true }); out(`✓ ${name}${msg ? ' — ' + msg : ''}`); }
    catch (e) { results.push({ name, ok: false }); out(`✗ ${name} — ${errText(e)}`); }
  };
  await step('Auth 관리 API(비밀 키, apikey 헤더)', async () => {
    try { const d = await api.listUsers(1, 1); return `계정 조회 가능(첫 페이지 ${((d && d.users) || []).length}건)`; }
    catch (e) {
      // 문서상 권장 방식(apikey 만)이 막히면, 같은 읽기 요청을 Authorization: Bearer 를 더해 한 번만 시험한다(바꾸는 요청 없음)
      if (bearerApi && e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        try { await bearerApi.listUsers(1, 1); }
        catch { throw e; }
        throw new ApiError(e.status, 'needs_bearer', 'apikey 헤더만으로는 막히고 Authorization: Bearer 를 더하면 통과합니다 — export HEUKSEOK_ADMIN_BEARER=1 로 다시 실행하세요');
      }
      throw e;
    }
  });
  await step('표 profiles 읽기(service_role)', async () => { await api.select('profiles', 'select=user_id&limit=1'); return 'SQL 적용됨'; });
  await step('표 account_security 읽기(service_role)', async () => { await api.select('account_security', 'select=user_id&limit=1'); });
  await step('표 user_state 읽기(service_role)', async () => { await api.select('user_state', 'select=user_id&limit=1'); });
  if (anonApi) {
    for (const t of ['profiles', 'account_security', 'user_state']) {
      await step(`로그인 안 한 요청(publishable 키)으로 ${t} 읽기 차단`, async () => {
        try { await anonApi.select(t, 'select=user_id&limit=1'); } catch (e) { if (e instanceof ApiError && e.status >= 400 && e.status < 500) return `막힘(HTTP ${e.status})`; throw e; }
        throw new ApiError(200, 'exposed', '읽혔습니다 — anon 권한을 확인하세요');
      });
    }
  } else out('· publishable 키가 없어 anon 차단 확인은 건너뜀(NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 를 주면 확인)');
  const bad = results.filter(r => !r.ok).length;
  out(bad ? `확인 실패 ${bad}건 — 절차서 '문제가 생겼을 때' 참고` : '모두 정상');
  return results;
}
