import { redirect } from 'next/navigation';

export default function DashboardEditRedirectPage() {
  // 数据总览编辑已下线：回到网站管理。
  redirect('/websites');
}
