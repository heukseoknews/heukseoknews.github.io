import type { Metadata } from 'next';
import { SITE } from '../../lib/site';
import { shareMeta } from '../../lib/meta';

const description = `${SITE.name} 일정 — 금융·보험 자격시험, 채용, AI 학회 마감, 대학원 입시`;
export const metadata: Metadata = {
  title: { absolute: `일정 | ${SITE.name}` },
  description,
  ...shareMeta(`일정 | ${SITE.name}`, description, '/calendar/'),
  alternates: { types: { 'text/calendar': '/calendar.ics' } },
};

export default function CalendarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
