import { DEFAULT_CHANNEL, channelHref, getChannel } from '../lib/channels';
import { DIRECTORY } from '../lib/directory';
import { SITE } from '../lib/site';

const target = channelHref(DEFAULT_CHANNEL);
// 해시는 그대로 넘긴다. #import=… (북마크·읽음 이전 링크)는 내 데이터 화면으로 보낸다.
const redirect = `(function(){var h=location.hash||'';location.replace((h.indexOf('#import=')===0?${JSON.stringify(channelHref(DEFAULT_CHANNEL, 'settings/'))}:${JSON.stringify(target)})+h);})();`;

/** 포털 주소(/). 지금은 채널이 하나라 기본 채널(/insurance/)로 바로 이동한다. JS 가 꺼져 있으면 meta refresh·링크로 이동. */
export default function Portal() {
  return <main className="shell portal">
    <script dangerouslySetInnerHTML={{ __html: redirect }} />
    <noscript><meta httpEquiv="refresh" content={`0; url=${target}`} /></noscript>
    <h1>{SITE.name}</h1>
    <p>{SITE.subtitle}</p>
    <ul>{DIRECTORY.filter(d => d.status === 'live' && getChannel(d.slug)).map(c => <li key={c.slug}><a href={channelHref(c.slug)}>{c.name} — {c.card}</a></li>)}</ul>
  </main>;
}
