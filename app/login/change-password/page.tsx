import type { Metadata } from 'next';
import ChangePasswordForm from '../../../components/ChangePasswordForm';
import { SITE } from '../../../lib/site';

export const metadata: Metadata = { title: { absolute: `비밀번호 변경 | ${SITE.name}` }, robots: { index: false, follow: false } };

export default function ChangePasswordPage() {
  return <ChangePasswordForm />;
}
