import type { Metadata } from 'next';
import { getChannel } from './channels';
import { SITE } from './site';

/** 공유 메타(openGraph·twitter). Next 는 하위 경로의 openGraph 를 통째로 바꾸므로 페이지마다 이 함수로 만든다. */
export function shareMeta(title: string, description: string, path = '/'): Pick<Metadata, 'openGraph' | 'twitter' | 'alternates'> {
  const image = { url: '/og.png', width: 1200, height: 630, alt: `${SITE.name} — ${SITE.subtitle}` };
  return {
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: SITE.name, locale: 'ko_KR', title, description, url: path, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  };
}

/** 채널 하위 페이지 제목: '이번 주 핵심 · 보험 | 흑석일보'. 페이지가 클라이언트 컴포넌트라 경로별 layout 에서 쓴다. */
export function pageMetadata(label: string, sub: string) {
  return async ({ params }: { params: Promise<{ channel: string }> }): Promise<Metadata> => {
    const c = getChannel((await params).channel);
    if (!c) return {};
    const title = `${label} · ${c.name}`;
    const description = `${SITE.name} ${c.name} — ${label}`;
    const full = `${title} | ${SITE.name}`;  // 중간 레이아웃이 제목을 정하면 루트 템플릿이 내려오지 않아 완성된 제목을 쓴다
    return { title: { absolute: full }, description, ...shareMeta(full, description, `/${c.slug}/${sub}`) };
  };
}
