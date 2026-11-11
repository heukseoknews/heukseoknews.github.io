import type { Metadata } from 'next';
import { pageMetadata } from '../../../lib/meta';

// 수집 상태는 운영 확인용: 주소는 두되 링크하지 않고 검색 색인에서 뺀다
const base = pageMetadata('수집 상태', 'status/');
export const generateMetadata = async (p: Parameters<typeof base>[0]): Promise<Metadata> => ({ ...(await base(p)), robots: { index: false, follow: false } });

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
