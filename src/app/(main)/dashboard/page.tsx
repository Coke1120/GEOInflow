import { redirect } from 'next/navigation';

export default function DashboardRedirectPage() {
  // 数据总览已下线：历史 /dashboard 地址统一回到网站管理。
  redirect('/websites');
}
