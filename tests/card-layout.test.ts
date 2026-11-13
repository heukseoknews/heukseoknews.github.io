import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 기사 카드 버튼 줄(가로): 순서·탭별 구성·접근 이름·폭별 자리·눌리는 영역
const card = readFileSync('components/ArticleCard.tsx', 'utf8');
const acts = card.slice(card.indexOf('<div className="cardActions">'), card.indexOf('</div>', card.indexOf('<div className="cardActions">')));
const at = (s: string) => { const i = acts.indexOf(s); assert.ok(i >= 0, `버튼 줄에 ${s}`); return i; };
// 순서: [치우기] [채팅에 올리기] [북마크] — 북마크가 맨 끝(오른쪽 정렬이라 모든 탭에서 맨 오른쪽)
assert.ok(at('aria-label="치우기(새 뉴스에서 빼기)"') < at('aria-label="채팅에 올리기"') && at('aria-label="채팅에 올리기"') < at("aria-label={bookmarked ? '북마크 해제' : '북마크 추가'}"));
assert.ok(at('aria-label="되돌리기(새 뉴스에 다시 보이기)"') < at('aria-label="채팅에 올리기"'), '되돌리기도 치우기 자리');
// 접근 이름·툴팁 그대로
for (const t of ['title="치우기"', 'title="되돌리기"', 'title="채팅에 올리기"', 'aria-pressed={bookmarked}']) at(t);
// 탭별 구성: 치우기는 dismiss 가 있을 때만(새 뉴스 탭만 넘김), 채팅은 로그인 중(share)만, 북마크는 항상
assert.match(acts, /\{dismiss && \(gone/); assert.match(acts, /\{share && isSafeUrl\(a\.url\) && <button/);
assert.match(readFileSync('app/[channel]/page.tsx', 'utf8'), /dismiss=\{tab === 'new' \?/);
assert.ok(!/dismiss=/.test(readFileSync('app/[channel]/week/page.tsx', 'utf8')), '이번 주 핵심에는 치우기 없음');
// 키보드 순서 = 제목 → 버튼 줄 → 같은 사건(버튼 줄은 본문 grid 안 제목 바로 뒤)
const i = (s: string) => card.indexOf(s);
assert.ok(i('className="cardTitle"') < i('<div className="cardActions">') && i('<div className="cardActions">') < i('className="meta"') && i('className="meta"') < i('className="groupToggle"'));
assert.match(card, /<div className="articleMain cardGrid">/);

// CSS: 넓은 화면은 칩·제목 줄 오른쪽, 560px 이하는 출처·중요도 줄 오른쪽, 420px 이하는 칩 줄 오른쪽(탭과 무관하게 같은 자리)
const css = readFileSync('app/globals.css', 'utf8');
assert.match(css, /\.article>\.cardGrid\{[^}]*grid-template-areas:"top act" "title act" "meta meta" "bm bm" "grp grp" "list list"\}/);
assert.match(css, /\.cardGrid>\.cardActions\{grid-area:act;flex-direction:row;justify-content:flex-end;gap:6px\}/);
assert.match(css, /@media\(max-width:560px\)\{\.article>\.cardGrid\{[^}]*"meta act" "bm act"/);
assert.match(css, /@media\(max-width:420px\)\{\.article>\.cardGrid\{grid-template-areas:"top act" "title title"/);
assert.ok(!/cardActions>:nth-child/.test(css), '버튼 수에 따라 자리가 바뀌지 않음');
// 눌리는 영역: 기본 44px, 마우스(hover·정밀 포인터)+넓은 화면에서만 36px
assert.match(css, /\.cardActions \.bookmark,\.cardActions \.readBtn\{width:44px;height:44px/);
assert.match(css, /@media\(hover:hover\) and \(pointer:fine\) and \(min-width:561px\)\{\.cardGrid>\.cardActions \.bookmark,\.cardGrid>\.cardActions \.readBtn\{width:36px;height:36px\}\}/);
// 치운 카드: 본문만 흐리게, 버튼(되돌리기)은 그대로
assert.match(css, /\.article\.isDismissed \.articleMain>:not\(\.cardActions\)\{opacity:\.55\}/);
console.log('card-layout tests passed');
