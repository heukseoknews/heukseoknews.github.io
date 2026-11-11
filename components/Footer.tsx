'use client';
import Link from 'next/link';
import { channelHref } from '../lib/channels';
import { useChannel } from '../lib/channelContext';
import { SITE } from '../lib/site';
import { formatBuild } from '../lib/version';
import { useLastCollected, useVersion } from '../lib/useSiteInfo';

/** 모든 페이지 공통 푸터(3단, 모바일 1단). */
export default function Footer() {
  const ch = useChannel();
  const v = useVersion();
  const finished = useLastCollected(ch.slug);
  return <footer className="siteFooter">
    <div className="siteFooterInner">
      <div className="footCols">
        <section aria-labelledby="ft-about">
          <h2 id="ft-about">서비스 소개</h2>
          <p>{SITE.name}({SITE.nameEn}) — {SITE.subtitle}. {ch.name} 채널은 {ch.description}</p>
          <p>{SITE.notice}</p>
        </section>
        <section aria-labelledby="ft-data">
          <h2 id="ft-data">데이터 안내</h2>
          <ul>
            <li>제목·링크·출처·발행시각만 저장하며 본문·이미지는 저장하지 않습니다.</li>
            <li>구글 뉴스 경유 링크는 구글을 거쳐 원문으로 이동합니다.</li>
            <li>북마크·읽음 표시는 이 브라우저에만 저장되며 기기 간 동기화되지 않습니다(<Link href={channelHref(ch.slug, 'settings/')}>내 데이터</Link>에서 백업·복원).</li>
          </ul>
        </section>
        <section aria-labelledby="ft-contact">
          <h2 id="ft-contact">만든 이 · 문의</h2>
          <p>{SITE.author}</p>
          <p><a href={SITE.issues} target="_blank" rel="noopener noreferrer">문의·제안 (GitHub Issues)</a><small> GitHub 계정 필요, 없으면 팀 채널로</small></p>
        </section>
      </div>
      <p className="footBottom">© 2026 {SITE.author}
        {v && <> · 사이트 빌드 {formatBuild(v.built_at)} · {v.commit}</>}
        {finished && <> · 마지막 수집 {ch.fmtShort(finished)}</>}
      </p>
    </div>
  </footer>;
}
