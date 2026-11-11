'use client';
import { fmtShort } from '../lib/format';
import { formatBuild } from '../lib/version';
import { useLastCollected, useVersion } from '../lib/useSiteInfo';

const ISSUES = 'https://github.com/Insurance-math/actuary-news-hub/issues';

/** 모든 페이지 공통 푸터(3단, 모바일 1단). */
export default function Footer() {
  const v = useVersion();
  const finished = useLastCollected();
  return <footer className="siteFooter">
    <div className="siteFooterInner">
      <div className="footCols">
        <section aria-labelledby="ft-about">
          <h2 id="ft-about">서비스 소개</h2>
          <p>보험계리 업무에 필요한 뉴스를 매일 아침 자동으로 모아 보여 주는 공개 뉴스 대시보드입니다.</p>
        </section>
        <section aria-labelledby="ft-data">
          <h2 id="ft-data">데이터 안내</h2>
          <ul>
            <li>제목·링크·출처·발행시각만 저장하며 본문·이미지는 저장하지 않습니다.</li>
            <li>기사의 저작권은 각 언론사와 기관에 있습니다.</li>
            <li>구글 뉴스 경유 링크는 구글을 거쳐 원문으로 이동합니다.</li>
            <li>북마크·읽음 표시는 이 브라우저에만 저장되며 기기 간 동기화되지 않습니다.</li>
          </ul>
        </section>
        <section aria-labelledby="ft-contact">
          <h2 id="ft-contact">만든 이 · 문의</h2>
          <p>Seungu Sin</p>
          <p><a href={ISSUES} target="_blank" rel="noopener noreferrer">문의·제안 (GitHub Issues)</a><small> GitHub 계정 필요, 없으면 팀 채널로</small></p>
        </section>
      </div>
      <p className="footBottom">© 2026 Seungu Sin
        {v && <> · 사이트 빌드 {formatBuild(v.built_at)} · {v.commit}</>}
        {finished && <> · 마지막 수집 {fmtShort(finished)}</>}
      </p>
    </div>
  </footer>;
}
