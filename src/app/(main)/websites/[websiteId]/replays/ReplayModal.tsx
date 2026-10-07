'use client';
import { Column, Dialog, Modal, type ModalProps } from '@umami/react-zen';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ReplayPlayback } from '@/app/(main)/websites/[websiteId]/replays/[replayId]/ReplayPlayback';
import { ControlledDialog } from '@/components/common/ControlledDialog';
import { useNavigation } from '@/components/hooks';
import { buildPath } from '@/lib/url';
import styles from './ReplayModal.module.css';

export interface ReplayModalProps extends ModalProps {
  websiteId: string;
  replayId?: string;
}

export function ReplayModal({ websiteId, replayId, className, ...props }: ReplayModalProps) {
  const {
    router,
    query: { replay },
    searchParams,
    updateParams,
  } = useNavigation();
  const pathname = usePathname();
  const activeReplayId = replayId || replay;
  // 弹窗有路由参数（@modal 拦截）与 ?replay= 查询参数两种打开方式；
  // 段缓存可能在软导航后复用 @modal 槽位，地址不在 replays 下时一律视为关闭。
  const onReplaysPath = pathname.startsWith(buildPath(`/websites/${websiteId}/replays`));
  const [replayOrientation, setReplayOrientation] = useState<'portrait' | 'landscape' | null>(null);

  useEffect(() => {
    if (activeReplayId) {
      setReplayOrientation(null);
    }
  }, [activeReplayId]);

  const modalClassName = [
    styles.modal,
    replayOrientation === 'portrait' ? styles.portrait : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      if (!onReplaysPath) return;
      if (replayId) {
        const query = Object.fromEntries(searchParams.entries());
        delete query.replay;

        router.push(buildPath(`/websites/${websiteId}/replays`, query));
      } else {
        router.push(updateParams({ replay: undefined }));
      }
    }
  };

  return (
    <ControlledDialog>
      <Modal
        {...props}
        className={modalClassName}
        isOpen={!!activeReplayId && onReplaysPath}
        onOpenChange={handleOpenChange}
      >
        <Column height="100%">
          <Dialog className="h-full rounded-lg">
            {({ close }) => (
              <Column padding="6">
                {activeReplayId && (
                  <ReplayPlayback
                    websiteId={websiteId}
                    replayId={activeReplayId}
                    onClose={close}
                    onReplayStateChange={setReplayOrientation}
                  />
                )}
              </Column>
            )}
          </Dialog>
        </Column>
      </Modal>
    </ControlledDialog>
  );
}
