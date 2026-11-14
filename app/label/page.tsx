import type { Metadata } from 'next';
import LabelTool from '../../components/LabelTool';
import { SITE } from '../../lib/site';

// 운영용 라벨링 화면: 메뉴·링크에 넣지 않고 검색 색인에서 뺀다(라벨은 이 브라우저에만 저장, lib/label.ts)
export const metadata: Metadata = {
  title: { absolute: `기사 라벨링 | ${SITE.name}` },
  description: `${SITE.name} 기사 라벨링`,
  robots: { index: false, follow: false },
};

export default function LabelPage() {
  return <LabelTool />;
}
