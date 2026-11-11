import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { WEIGHTS, pickFaces } from '../scripts/sync-fonts.mjs';

// Pretendard: 패키지 하나만 의존, 굵기 400·600·700, woff2 dynamic subset, font-display: swap, 외부 CDN 없음
const pkgJson = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(pkgJson.dependencies.pretendard, '1.3.9');
assert.deepEqual(WEIGHTS, [400, 600, 700]);
const pkg = dirname(createRequire(import.meta.url).resolve('pretendard/package.json'));
const { css, files } = pickFaces(readFileSync(join(pkg, 'dist/web/static/pretendard-dynamic-subset.css'), 'utf8'));
const faces = css.trim().split('\n');
assert.equal(faces.length, files.length);
assert.ok(faces.length >= 3 * 80, '굵기마다 글자 범위 조각 80개 이상');
for (const w of WEIGHTS) assert.ok(faces.filter(f => f.includes(`font-weight:${w};`)).length >= 80, `굵기 ${w}`);
for (const f of faces) {
  assert.match(f, /font-display:swap/);
  assert.match(f, /src:url\(\/fonts\/pretendard\/Pretendard-(Regular|SemiBold|Bold)\.subset\.\d+\.woff2\) format\('woff2'\);unicode-range:U\+/);
  assert.doesNotMatch(f, /woff\)|https?:/);
}
// 화면 CSS·레이아웃에 외부 폰트 CDN 이 없다
for (const f of ['app/globals.css', 'app/layout.tsx']) assert.doesNotMatch(readFileSync(f, 'utf8'), /cdn\.jsdelivr|fonts\.googleapis|unpkg/);
assert.match(readFileSync('app/layout.tsx', 'utf8'), /href="\/fonts\/pretendard\/pretendard\.css"/);
assert.match(readFileSync('app/globals.css', 'utf8'), /--font:Pretendard,/);
console.log('fonts tests passed');
