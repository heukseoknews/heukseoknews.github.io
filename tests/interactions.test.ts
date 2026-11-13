import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 미세 상호작용 규칙(app/globals.css): hover 는 (hover:hover) 안에서만, 동작 줄이기면 모두 끔, 레이아웃 속성은 움직이지 않음, 짧은 시간
const css = readFileSync('app/globals.css', 'utf8');

// 모든 ':hover' 선택자가 @media(hover:hover) 블록 안에 있는지(블록 머리를 쌓아 가며 확인)
function hoverOutside(text: string): string[] {
  const heads: string[] = [], bad: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('/*', i)) { i = text.indexOf('*/', i) + 1; continue; }
    const c = text[i];
    if (c === '{') { const cm = text.lastIndexOf('*/', i - 1); const start = Math.max(text.lastIndexOf('}', i - 1) + 1, text.lastIndexOf('{', i - 1) + 1, cm >= 0 ? cm + 2 : 0); heads.push(text.slice(start, i).trim()); }
    else if (c === '}') heads.pop();
    else if (text.startsWith(':hover', i) && !text.slice(Math.max(0, i - 6), i).endsWith('(hover')) {   // '(hover:hover)' 미디어 조건 자체는 제외
      const nextOpen = text.indexOf('{', i), nextClose = text.indexOf('}', i);
      const inSelector = nextOpen >= 0 && (nextClose < 0 || nextOpen < nextClose);
      if (inSelector && !heads.some(h => h.replace(/\s/g, '').startsWith('@media(hover:hover)'))) bad.push(text.slice(Math.max(0, i - 40), i + 6));
    }
  }
  return bad;
}
assert.equal(hoverOutside('.a:hover{color:red}').length, 1, '검사기 자체: 밖의 hover 를 찾는다');
assert.equal(hoverOutside('@media(max-width:640px){.a,.b:hover{x:1}}').length, 1);
assert.equal(hoverOutside('@media(hover:hover){.a:hover{x:1}}@media(max-width:9px){@media(hover:hover){.b:hover{x:1}}}').length, 0);
const outside = hoverOutside(css);
assert.deepEqual(outside, [], 'hover 는 (hover:hover) 안에서만(터치 뒤 hover 가 남지 않게)');

// 새 블록: 누르기 scale .97, 0.12~0.2초, transform·opacity·색만(크기·여백 전환 없음)
const block = css.slice(css.indexOf('/* ───── 미세 상호작용'));
assert.ok(block.length > 100, '미세 상호작용 블록');
assert.match(block, /:not\(:disabled\):active\{transform:scale\(\.97\)\}/);
for (const m of block.matchAll(/(?:transition|animation):[^;}]*/g)) {
  for (const t of m[0].matchAll(/(\d*\.?\d+)s\b/g)) { const v = Number(t[1]); assert.ok(v >= 0.12 && v <= 0.2, `시간 ${v}s: ${m[0]}`); }
  assert.ok(!/\b(width|height|padding|margin|top|left|max-height|grid-template-rows)\b/.test(m[0]), `레이아웃 속성 전환 없음: ${m[0]}`);
}
for (const k of block.matchAll(/@keyframes \w+\{([^@]*?)\}\}/g)) assert.ok(!/\b(width|height|padding|margin|max-height)\s*:/.test(k[1]), `keyframes 는 transform·opacity 만: ${k[0]}`);
assert.ok(!/infinite/.test(block), '항상 도는 애니메이션 없음');
assert.ok(!/(box-shadow|filter|backdrop-filter)\s*:/.test(block.replace(/\/\*[\s\S]*?\*\//g, '')), '그림자·블러 효과 없음(카드 수백 개)');
// 동작 줄이기: 모두 끔
assert.match(block, /@media\(prefers-reduced-motion:reduce\)\{\s*\*,\*::before,\*::after\{animation:none!important;transition:none!important\}/);
// 키보드 선택 테두리 공통(우선순위 0)
assert.match(block, /:where\(a,button,summary,select,input\[type=checkbox\],input\[type=radio\],\[tabindex\]:not\(\[tabindex="-1"\]\)\):focus-visible\{outline:2px solid var\(--accent\);outline-offset:2px\}/);
// 색은 채널 변수만(새 색 값 없음)
assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(block.replace(/\/\*[\s\S]*?\*\//g, '')), '새 색 값 없이 채널 변수만');
// 북마크 별: 누를 때만 .pop(처음 그려질 때는 움직이지 않음)
const card = readFileSync('components/ArticleCard.tsx', 'utf8');
assert.equal((card.match(/onClick=\{e => \{ pop\(e\); onBookmark\(/g) ?? []).length, 2, '카드·묶음 안 북마크 모두');
assert.equal((card.match(/onAnimationEnd=\{unpop\}/g) ?? []).length, 2);
assert.match(block, /\.bookmark\.pop svg\{animation:bmPop \.2s ease-out\}/);
assert.ok(!/\.bookmark\[aria-pressed=(true|"true")\][^{]*\{[^}]*animation/.test(css), '저장 상태만으로는 애니메이션하지 않음');
console.log('interactions tests passed');
