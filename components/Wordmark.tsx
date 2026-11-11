import { SITE } from '../lib/site';

/** 제호 워드마크(시스템 세리프 글꼴, 폰트 파일 없음). sub=true 면 사이트 부제를 옆에 붙인다. */
export default function Wordmark({ sub = false }: { sub?: boolean }) {
  return <>
    <span className="wordmark">{SITE.name}</span>
    {sub && <span className="wordmarkSub">{SITE.subtitle}</span>}
  </>;
}
