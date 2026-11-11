import type { Metadata } from 'next';
import Link from 'next/link';
import Wordmark from '../components/Wordmark';

export const metadata: Metadata = { title: '페이지를 찾을 수 없습니다', robots: { index: false } };

/** 404(정적 빌드에서 404.html). 채널 레이아웃 밖이라 헤더 없이 단독으로 그린다. */
export default function NotFound() {
  return <main className="notFound">
    <Link href="/" aria-label="흑석일보 홈"><Wordmark /></Link>
    <h1>페이지를 찾을 수 없습니다</h1>
    <p>주소가 바뀌었거나 없는 페이지입니다.</p>
    <Link href="/" className="confirm">홈으로 돌아가기</Link>
  </main>;
}
