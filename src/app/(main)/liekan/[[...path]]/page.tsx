import { redirect } from 'next/navigation';
export default async function LiekanFeatureEntry({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const page = (await params).path?.[0];
  const auth = { login: '/login', 'login-2fa': '/login/two-factor', sso: '/sso' }[page];
  if (auth) redirect(auth);
  return null;
}
