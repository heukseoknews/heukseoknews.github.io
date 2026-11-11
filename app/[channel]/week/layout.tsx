import { pageMetadata } from '../../../lib/meta';

export const generateMetadata = pageMetadata('이번 주 핵심', 'week/');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
