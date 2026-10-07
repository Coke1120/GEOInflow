'use client';
import { Column, Dialog, Modal } from '@umami/react-zen';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ControlledDialog } from '@/components/common/ControlledDialog';
import { buildPath } from '@/lib/url';
import styles from './SessionModal.module.css';
import { SessionProfile } from './SessionProfile';

export function SessionProfileModal({
  websiteId,
  sessionId,
}: {
  websiteId: string;
  sessionId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // 段缓存可能在软导航后复用 @modal 槽位：只有地址仍指向本弹窗时才视为打开，
  // 关闭动作也只在这种前提下写回列表地址，避免把其它页面的 URL 覆盖掉。
  const onModalPath = pathname === buildPath(`/websites/${websiteId}/sessions/${sessionId}`);

  const closeModal = () => {
    if (!onModalPath) return;
    const query = Object.fromEntries(searchParams.entries());
    delete query.session;

    router.replace(buildPath(`/websites/${websiteId}/sessions`, query), { scroll: false });
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      closeModal();
    }
  };

  return (
    <ControlledDialog>
      <Modal className={styles.modal} isOpen={onModalPath} onOpenChange={handleOpenChange}>
        <Column height="100%">
          <Dialog className="h-full rounded-lg">
            <Column padding="10">
              <SessionProfile websiteId={websiteId} sessionId={sessionId} onClose={closeModal} />
            </Column>
          </Dialog>
        </Column>
      </Modal>
    </ControlledDialog>
  );
}
