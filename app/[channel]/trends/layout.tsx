import { pageMetadata } from '../../../lib/meta';

export const generateMetadata = pageMetadata('키워드 추이', 'trends/');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
