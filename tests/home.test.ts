import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IMPORT_REDIRECT_JS, IMPORT_TARGET } from '../lib/directory.ts';
import { dataHref, settingsRedirectJs } from '../lib/me.ts';

// 홈(/)은 항상 홈을 보여 준다. /#import=… (북마크·읽음 이전 링크)만 해시를 유지한 채 마이페이지 내 데이터(보험)로 보낸다.
const run = (hash: string) => {
  let to: string | null = null;
  new Function('location', IMPORT_REDIRECT_JS)({ hash, replace: (u: string) => { to = u; } });
  return to;
};
assert.equal(IMPORT_TARGET, '/me/data/?ch=insurance');
assert.equal(IMPORT_TARGET, dataHref('insurance'));
assert.equal(run('#import=eyJ2IjoxfQ'), '/me/data/?ch=insurance#import=eyJ2IjoxfQ');
assert.equal(run('#import='), '/me/data/?ch=insurance#import=');
assert.equal(run(''), null, '해시 없으면 이동하지 않는다');
assert.equal(run('#content'), null);
assert.equal(run('#x#import=1'), null);

const page = readFileSync('app/page.tsx', 'utf8');
assert.ok(page.includes('IMPORT_REDIRECT_JS'), '홈은 #import= 이동 스크립트를 쓴다');
assert.doesNotMatch(page, /http-?equiv|refresh/i, '홈에 meta refresh 없음(자동 이동 없음)');
assert.doesNotMatch(page, /location\.replace|['"]use client['"]/, '홈은 정적 서버 컴포넌트, 자동 이동 없음');
assert.ok(page.includes('DIRECTORY.map') && page.includes("d.status === 'live'") && page.includes('aria-disabled="true"'), '카드 상태는 레지스트리 status, 준비 중은 링크 아님');
assert.doesNotMatch(page, /useNews|fetch\(|\/data\//, '홈은 데이터를 받지 않는다');
// 상단 줄: 오른쪽 '마이페이지' 링크, 한 줄 소개는 SITE.tagline(부제 SITE.subtitle 은 title·OG·푸터용)
assert.ok(page.includes('className="homeTop"') && page.includes('href={ME_HOME}') && page.includes('마이페이지'));
assert.ok(page.includes('{SITE.tagline}') && !page.includes('{SITE.subtitle}'));
const site = readFileSync('lib/site.ts', 'utf8');
assert.ok(site.includes("tagline: '보험·AI·금융 뉴스를 매일 모아 전합니다.'") && site.includes("subtitle: '보험·AI·금융 뉴스 모아보기'"));
// 옛 내 데이터 주소(/<채널>/settings/)는 마이페이지 내 데이터로(해시 유지)
const redirect = (slug: string, hash: string) => { let to: string | null = null; new Function('location', settingsRedirectJs(slug))({ hash, replace: (u: string) => { to = u; } }); return to; };
assert.equal(redirect('insurance', '#import=abc'), '/me/data/?ch=insurance#import=abc');
assert.equal(redirect('ai', ''), '/me/data/?ch=ai');
const settings = readFileSync('app/[channel]/settings/page.tsx', 'utf8');
assert.ok(settings.includes('settingsRedirectJs(ch.slug)') && settings.includes('location.replace(dataHref(ch.slug) + location.hash)'));
// 헤더 오른쪽 위: 마이페이지(채널을 ?ch= 로 넘김)
const header = readFileSync('components/SiteHeader.tsx', 'utf8');
assert.ok(header.includes('meHref(ME_HOME, ch.slug)') && header.includes('마이페이지') && !header.includes("'settings/'"));
console.log('home tests passed');
