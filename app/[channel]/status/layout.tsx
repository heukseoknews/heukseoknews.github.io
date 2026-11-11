import { pageMetadata } from '../../../lib/meta';

export const generateMetadata = pageMetadata('수집 상태', 'status/');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
