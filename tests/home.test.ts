import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IMPORT_REDIRECT_JS, IMPORT_TARGET } from '../lib/directory.ts';

// 홈(/)은 항상 홈을 보여 준다. /#import=… (북마크·읽음 이전 링크)만 해시를 유지한 채 내 데이터 화면으로 보낸다.
const run = (hash: string) => {
  let to: string | null = null;
  new Function('location', IMPORT_REDIRECT_JS)({ hash, replace: (u: string) => { to = u; } });
  return to;
};
assert.equal(IMPORT_TARGET, '/insurance/settings/');
assert.equal(run('#import=eyJ2IjoxfQ'), '/insurance/settings/#import=eyJ2IjoxfQ');
assert.equal(run('#import='), '/insurance/settings/#import=');
assert.equal(run(''), null, '해시 없으면 이동하지 않는다');
assert.equal(run('#content'), null);
assert.equal(run('#x#import=1'), null);

const page = readFileSync('app/page.tsx', 'utf8');
assert.ok(page.includes('IMPORT_REDIRECT_JS'), '홈은 #import= 이동 스크립트를 쓴다');
assert.doesNotMatch(page, /http-?equiv|refresh/i, '홈에 meta refresh 없음(자동 이동 없음)');
assert.doesNotMatch(page, /location\.replace|['"]use client['"]/, '홈은 정적 서버 컴포넌트, 자동 이동 없음');
assert.ok(page.includes('DIRECTORY.map') && page.includes("d.status === 'live'") && page.includes('aria-disabled="true"'), '카드 상태는 레지스트리 status, 준비 중은 링크 아님');
assert.doesNotMatch(page, /useNews|fetch\(|\/data\//, '홈은 데이터를 받지 않는다');
console.log('home tests passed');
