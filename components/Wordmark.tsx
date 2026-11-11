import mark from '../lib/wordmark.json';
import { SITE } from '../lib/site';

/** 제호 워드마크(ㅎ 심볼 + 고딕). 글자는 윤곽선 path(lib/wordmark.json)라 폰트와 무관하게 같은 모양.
 *  심볼 바탕은 채널 색(--brand), 글자는 currentColor. sub=true 면 사이트 부제를 옆에 붙인다. */
export default function Wordmark({ sub = false }: { sub?: boolean }) {
  const s = mark.symbol;
  return <>
    <svg className="wordmark" viewBox={mark.viewBox.join(' ')} aria-hidden="true" focusable="false">
      <rect className="wmSym" width={s.size} height={s.size} rx={s.radius} />
      <path className="wmGlyph" fillRule="evenodd" d={s.glyph} />
      <path className="wmText" d={mark.text} />
    </svg>
    {sub && <span className="wordmarkSub">{SITE.subtitle}</span>}
  </>;
}
