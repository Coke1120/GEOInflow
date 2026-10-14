'use client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';

import { Modal, ModalDescription, ModalTitle } from '@umami/react-zen';
import {
  createContext,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import '@/styles/liekan/Features.module.css';

const DialogContext = createContext<{
  footer: HTMLElement | null;
  requestClose: () => void;
  setActionCount: Dispatch<SetStateAction<number>>;
} | null>(null);

export const useDialog = () => useContext(DialogContext);

export function DialogActions({ children }: { children: ReactNode }) {
  const dialog = useDialog();
  useEffect(() => {
    if (!dialog) return;
    dialog.setActionCount(count => count + 1);
    return () => dialog.setActionCount(count => count - 1);
  }, [dialog?.setActionCount]);
  const actions = <div className="form-actions dialog-actions">{children}</div>;
  return dialog?.footer ? createPortal(actions, dialog.footer) : actions;
}

export function LiekanDialog({
  title,
  subtitle,
  children,
  onClose,
  size = 'standard',
  className = '',
  protectUnsaved = true,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  size?: 'standard' | 'wide';
  className?: string;
  protectUnsaved?: boolean;
}) {
  const i18n = useLiekanI18n();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const [actionCount, setActionCount] = useState(0);
  const [discarding, setDiscarding] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    trigger.current = document.activeElement as HTMLElement;
    return () => {
      if (trigger.current?.isConnected) trigger.current.focus();
    };
  }, []);
  useEffect(() => {
    if (!host) return;
    let frame: number;
    const keepFocus = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (panel.current && !host.contains(document.activeElement)) panel.current.focus();
      });
    };
    const observer = new MutationObserver(keepFocus);
    observer.observe(host, { childList: true, subtree: true });
    keepFocus();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [host]);
  useEffect(() => {
    if (discarding) confirm.current?.focus();
    else if (previousFocus.current?.isConnected) {
      previousFocus.current.focus();
      previousFocus.current = null;
    }
  }, [discarding]);
  const isSubmitting = () => !!panel.current?.querySelector('form[aria-busy="true"]');
  const requestClose = () => {
    if (isSubmitting()) return;
    if (discarding) {
      setDiscarding(false);
      return;
    }
    if (protectUnsaved && panel.current?.querySelector('form[data-unsaved="true"]')) {
      previousFocus.current = document.activeElement as HTMLElement;
      setDiscarding(true);
      return;
    }
    close.current();
  };
  return createPortal(
    <div data-liekan-features className="liekan-dialog-root" ref={setHost}>
      {host && (
        <Modal
          container={host}
          isOpen
          placement="center"
          onOpenChange={open => {
            if (!open) requestClose();
          }}
          className="liekan-dialog-portal"
        >
          <section
            className={`liekan-dialog ${size === 'wide' ? 'dialog-wide' : ''} ${className}`}
            data-dialog-size={size}
            ref={panel}
            tabIndex={-1}
          >
            <header className="dialog-head drawer-head">
              <div>
                <ModalTitle className="dialog-title">{title}</ModalTitle>
                {subtitle && (
                  <ModalDescription className="dialog-subtitle">{subtitle}</ModalDescription>
                )}
              </div>
              <button
                type="button"
                className="btn dialog-close"
                aria-label={i18n.text('关闭弹窗')}
                onClick={requestClose}
              >
                <svg
                  className="nav-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="m6 6 12 12M6 18 18 6" />
                </svg>
              </button>
            </header>
            <DialogContext.Provider value={{ footer, requestClose, setActionCount }}>
              <div className="dialog-body drawer-body" hidden={discarding}>
                {children}
              </div>
              <footer className="dialog-footer" ref={setFooter} hidden={discarding}>
                <div className="dialog-default-close" hidden={actionCount > 0}>
                  <button type="button" className="btn" onClick={requestClose}>
                    {i18n.text('关闭')}
                  </button>
                </div>
              </footer>
            </DialogContext.Provider>
            {discarding && (
              <div
                className="dialog-discard"
                role="group"
                aria-label={i18n.text('放弃未保存的修改？')}
              >
                <div className="dialog-body">
                  <h3>{i18n.text('放弃未保存的修改？')}</h3>
                  <p className="muted">{i18n.text('关闭弹窗后，当前输入的修改将被放弃。')}</p>
                </div>
                <div className="dialog-footer form-actions">
                  <button ref={confirm} type="button" className="btn" onClick={requestClose}>
                    {i18n.text('继续编辑')}
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => {
                      if (!isSubmitting()) close.current();
                    }}
                  >
                    {i18n.text('放弃修改并关闭')}
                  </button>
                </div>
              </div>
            )}
          </section>
        </Modal>
      )}
    </div>,
    document.body,
  );
}
