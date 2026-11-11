'use client';
import { useChannel } from '../lib/channelContext';
import { SITE } from '../lib/site';
import { useLastCollected } from '../lib/useSiteInfo';

/** 채널 페이지 공통 푸터: 한 줄 소개 · 저작권 안내 · 문의 · 마지막 수집 시각. 빌드·commit 은 /version.json 에만 둔다. */
export default function Footer() {
  const ch = useChannel();
  const finished = useLastCollected(ch.slug);
  return <footer className="siteFooter">
    <div className="siteFooterInner">
      <p className="footIntro"><b>{SITE.name}</b> <span lang="en">{SITE.nameEn}</span> — {SITE.subtitle}. {SITE.notice}</p>
      <p className="footMeta">© 2026 {SITE.author}
        {' · '}<a href={SITE.issues} target="_blank" rel="noopener noreferrer" title="GitHub 계정이 필요합니다">문의·제안</a>
        {finished && <> · 마지막 수집 {ch.fmtShort(finished)}</>}
      </p>
    </div>
  </footer>;
}
