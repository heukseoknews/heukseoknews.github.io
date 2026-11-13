'use client';
import { MSG } from '../lib/auth';

type Props = {
  loginId: string; cur: string; pw: string; pw2: string;
  onCur: (v: string) => void; onPw: (v: string) => void; onPw2: (v: string) => void;
  firstRef?: React.Ref<HTMLInputElement>; disabled?: boolean;
};

/** 비밀번호 변경 입력칸 묶음(첫 로그인 변경 화면·마이페이지 → 계정이 함께 쓴다). 규칙 한 줄은 lib/auth.ts MSG.pwRule.
 *  모두 type=password, 자동완성은 current-password/new-password. 아이디는 브라우저 비밀번호 관리자용으로만(보이지 않음).
 *  값은 화면 상태에만 두고 저장·출력하지 않는다. */
export default function PasswordFields({ loginId, cur, pw, pw2, onCur, onPw, onPw2, firstRef, disabled }: Props) {
  return <>
    <input className="srOnly" name="username" autoComplete="username" value={loginId} readOnly tabIndex={-1} aria-hidden="true" />
    <label className="authField"><span>현재 비밀번호</span>
      <input ref={firstRef} type="password" name="current-password" autoComplete="current-password" maxLength={200} value={cur} onChange={e => onCur(e.target.value)} disabled={disabled} />
    </label>
    <label className="authField"><span>새 비밀번호</span>
      <input type="password" name="new-password" autoComplete="new-password" maxLength={200} value={pw} onChange={e => onPw(e.target.value)} aria-describedby="pwRule" disabled={disabled} />
    </label>
    <label className="authField"><span>새 비밀번호 확인</span>
      <input type="password" name="new-password-confirm" autoComplete="new-password" maxLength={200} value={pw2} onChange={e => onPw2(e.target.value)} disabled={disabled} />
    </label>
    <p className="authHint" id="pwRule">{MSG.pwRule}</p>
  </>;
}
