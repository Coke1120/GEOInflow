import { useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Button, DialogActions, Field, Form, LiekanDialog } from './ui';

function Editor({ save = async () => {} }: { save?: (values: any) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>编辑设置</Button>
      {open && (
        <LiekanDialog title="编辑设置" onClose={() => setOpen(false)}>
          <Form submitLabel="保存设置" onSubmit={save}>
            <Field label="名称" name="name" required defaultValue="原名称" />
          </Form>
        </LiekanDialog>
      )}
    </>
  );
}
it('submits the body form from the fixed footer exactly once and preserves input on failure', async () => {
  let reject!: (error: Error) => void;
  const save = vi.fn().mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const user = userEvent.setup();
  render(<Editor save={save} />);
  await user.click(screen.getByRole('button', { name: '编辑设置' }));
  const dialog = within(screen.getByRole('dialog'));
  const submit = dialog.getByRole('button', { name: '保存设置' }) as HTMLButtonElement;
  expect(submit.closest('form')).toBeNull();
  expect(submit.form).toContainElement(dialog.getByLabelText(/名称/));
  await user.clear(dialog.getByLabelText(/名称/));
  await user.type(dialog.getByLabelText(/名称/), '新名称');
  await user.dblClick(submit);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0]).toEqual({ name: '新名称' });
  reject(new Error('保存失败'));
  expect(await dialog.findByRole('alert')).toHaveTextContent('保存失败');
  expect(dialog.getByLabelText(/名称/)).toHaveValue('新名称');
});
it.each(['取消', '关闭弹窗', 'Escape'])(
  'protects an edited form through %s with one active dialog',
  async close => {
    const user = userEvent.setup();
    render(<Editor />);
    const trigger = screen.getByRole('button', { name: '编辑设置' });
    await user.click(trigger);
    await user.type(screen.getByLabelText(/名称/), '修改');
    if (close === 'Escape') await user.keyboard('{Escape}');
    else await user.click(screen.getByRole('button', { name: close }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('group', { name: '放弃未保存的修改？' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByLabelText(/名称/)).toHaveValue('原名称修改');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: '放弃修改并关闭' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  },
);
it('closes a pristine dialog on Escape and restores page scrolling', async () => {
  const user = userEvent.setup();
  render(<Editor />);
  const trigger = screen.getByRole('button', { name: '编辑设置' });
  await user.click(trigger);
  await waitFor(() => expect(document.body.style.overflowY).toBe('hidden'));
  await waitFor(() =>
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement),
  );
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() => expect(document.body.style.overflowY).toBe(''));
  expect(trigger).toHaveFocus();
});
it('keeps focus inside after a successful action replaces the form', async () => {
  function SwitchingContent() {
    const [saved, setSaved] = useState(false);
    return (
      <LiekanDialog title="创建密钥" onClose={() => {}}>
        {saved ? (
          <>
            <p>密钥已创建</p>
            <DialogActions>
              <Button>已保存，关闭</Button>
            </DialogActions>
          </>
        ) : (
          <Form submitLabel="创建" onSubmit={async () => setSaved(true)}>
            <Field label="名称" name="name" defaultValue="测试密钥" />
          </Form>
        )}
      </LiekanDialog>
    );
  }
  const user = userEvent.setup();
  render(<SwitchingContent />);
  await user.click(screen.getByRole('button', { name: '创建' }));
  await screen.findByRole('button', { name: '已保存，关闭' });
  await waitFor(() =>
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement),
  );
});
it('preserves the primary action order on full page forms', () => {
  render(
    <Form submitLabel="保存页面" onSubmit={async () => {}} cancel={<Button>取消页面</Button>}>
      <Field label="页面名称" name="name" />
    </Form>,
  );
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([
    '保存页面',
    '取消页面',
  ]);
});

it.each(['关闭弹窗', 'Escape'])(
  'keeps a submitting form open through %s until its complete save settles',
  async close => {
    let resolve!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>(done => {
          resolve = done;
        }),
    );
    const user = userEvent.setup();
    render(<Editor save={save} />);
    await user.click(screen.getByRole('button', { name: '编辑设置' }));
    await user.type(screen.getByLabelText(/名称/), '待保存');
    await user.click(screen.getByRole('button', { name: '保存设置' }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '正在保存设置…' })).toBeDisabled();
    if (close === 'Escape') await user.keyboard('{Escape}');
    else await user.click(screen.getByRole('button', { name: close }));
    expect(screen.getByLabelText(/名称/)).toBeVisible();
    expect(screen.queryByRole('group', { name: '放弃未保存的修改？' })).not.toBeInTheDocument();
    await act(async () => {
      resolve();
    });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  },
);
