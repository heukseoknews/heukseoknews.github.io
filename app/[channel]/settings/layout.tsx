import type { Metadata } from 'next';
import { pageMetadata } from '../../../lib/meta';

// 옛 주소(마이페이지로 이동): 검색 색인에서 뺀다
const base = pageMetadata('내 데이터', 'settings/');
export const generateMetadata = async (p: Parameters<typeof base>[0]): Promise<Metadata> => ({ ...(await base(p)), robots: { index: false, follow: false } });

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
