// Pretendard 웹폰트(npm 패키지 pretendard, SIL OFL 1.1) → public/fonts/pretendard/ 복사. 빌드·dev 전에 실행된다(결과물은 커밋하지 않음).
// 글자 범위별로 잘린 dynamic subset(woff2)만, 굵기 400·600·700만 쓴다. 브라우저는 페이지에 나온 글자 범위의 조각만 받는다.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const WEIGHTS = [400, 600, 700];
const OUT = 'public/fonts/pretendard';

/** 패키지 CSS 에서 지정 굵기의 @font-face 만 골라 woff2 경로를 바꾼다. 반환: { css, files } */
export function pickFaces(css, weights = WEIGHTS, base = '/fonts/pretendard/') {
  const files = [];
  const faces = [...css.matchAll(/@font-face\s*{[^}]*}/g)].map(m => m[0]).filter(f => weights.includes(Number(/font-weight:\s*(\d+)/.exec(f)?.[1])));
  const out = faces.map(f => {
    const file = /url\(\.\/woff2-dynamic-subset\/([^)]+\.woff2)\)/.exec(f)?.[1];
    if (!file) throw new Error('woff2 경로를 찾지 못함: ' + f.slice(0, 120));
    files.push(file);
    const range = /unicode-range:\s*([^;]+);/.exec(f)?.[1];
    const weight = /font-weight:\s*(\d+)/.exec(f)[1];
    return `@font-face{font-family:Pretendard;font-style:normal;font-display:swap;font-weight:${weight};src:url(${base}${file}) format('woff2');unicode-range:${range}}`;
  });
  return { css: out.join('\n') + '\n', files };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pkg = dirname(createRequire(import.meta.url).resolve('pretendard/package.json'));
  const dir = join(pkg, 'dist/web/static');
  const { css, files } = pickFaces(readFileSync(join(dir, 'pretendard-dynamic-subset.css'), 'utf8'));
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const f of files) {
    const src = join(dir, 'woff2-dynamic-subset', f);
    if (!existsSync(src)) throw new Error('폰트 파일 없음: ' + src);
    copyFileSync(src, join(OUT, f));
  }
  const license = readFileSync(join(pkg, 'dist/LICENSE.txt'), 'utf8');
  writeFileSync(join(OUT, 'pretendard.css'), `/* Pretendard ${JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version} — SIL Open Font License 1.1 (LICENSE.txt) */\n` + css);
  writeFileSync(join(OUT, 'LICENSE.txt'), license);
  console.log(`fonts: Pretendard ${WEIGHTS.join('·')} — @font-face ${files.length}개 → ${OUT}`);
}
