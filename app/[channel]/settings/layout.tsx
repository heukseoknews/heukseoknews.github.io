import { pageMetadata } from '../../../lib/meta';

export const generateMetadata = pageMetadata('내 데이터', 'settings/');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
