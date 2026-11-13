import { ArrowRight, UserRound } from 'lucide-react';
import Wordmark from '../components/Wordmark';
import AccountMenu from '../components/AccountMenu';
import { AUTH_MODE } from '../lib/authConfig';
import { ChannelIcon, channelColors } from '../components/channelLook';
import { channelHref, getChannel } from '../lib/channels';
import { DIRECTORY, IMPORT_REDIRECT_JS } from '../lib/directory';
import { ME_HOME } from '../lib/me';
import { SITE } from '../lib/site';

/** 홈(/): 상단 줄('마이페이지' 링크)·워드마크·한 줄 소개·채널 카드. 정적 HTML 이라 JS 없이도 보이고 데이터를 받지 않는다.
 *  카드 상태는 lib/directory.ts status(live = 링크, soon = '준비 중'). /#import=… 만 마이페이지 내 데이터로 이동한다. */
const meLink = <a href={ME_HOME}><UserRound size={18} aria-hidden="true" />마이페이지</a>;

export default function Home() {
  return <div className="home">
    <script dangerouslySetInnerHTML={{ __html: IMPORT_REDIRECT_JS }} />
    <div className="homeTop"><nav aria-label="보조 메뉴">{AUTH_MODE === 'off' ? meLink : <AccountMenu as="div" meHref={ME_HOME} />}</nav></div>
    <main className="homeMain" id="content">
      <header className="homeHero">
        <h1><span className="srOnly">{SITE.name}</span><Wordmark /></h1>
        <p>{SITE.tagline}</p>
      </header>
      <ul className="chGrid" aria-label="채널">
        {DIRECTORY.map(d => {
          const live = d.status === 'live' && !!getChannel(d.slug);
          const body = <>
            <span className="chIco"><ChannelIcon slug={d.slug} size={28} /></span>
            <h2>{d.name}</h2>
            <p>{d.card}</p>
            <span className="chFoot">{live ? <span className="chGo">보기<ArrowRight size={18} aria-hidden="true" /></span> : <span className="soonBadge">준비 중</span>}</span>
          </>;
          return <li key={d.slug} style={channelColors(d.slug)}>
            {live
              ? <a className="chCard live" href={channelHref(d.slug)}>{body}</a>
              : <div className="chCard soon" aria-disabled="true">{body}</div>}
          </li>;
        })}
      </ul>
    </main>
    <footer className="homeFoot"><p>© 2026 {SITE.author} · {SITE.notice}</p></footer>
  </div>;
}
