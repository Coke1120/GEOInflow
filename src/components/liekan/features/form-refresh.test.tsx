import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Field, Form, Select, Switch } from './ui';

function Editor({ version, disabled = false, save }: any) {
  return (
    <Form resetKey={String(version)} disabled={disabled} onSubmit={save}>
      <Field label="名称" name="name" defaultValue={`server-${version}`} />
      <Field label="密码" name="password" type="password" />
      <Select
        label="角色"
        name="role"
        options={['user', 'admin']}
        defaultValue={version === 1 ? 'user' : 'admin'}
      />
      <Switch label="启用" name="enabled" defaultChecked={version !== 1} />
    </Form>
  );
}

it('applies refreshed definitions to a clean form', () => {
  const view = render(<Editor version={1} save={vi.fn()} />);
  view.rerender(<Editor version={2} save={vi.fn()} />);
  expect(screen.getByLabelText('名称')).toHaveValue('server-2');
  expect(screen.getByLabelText('角色')).toHaveValue('admin');
  expect(screen.getByLabelText('启用')).toBeChecked();
});

it.each(['success', 'failure'])(
  'preserves drafts during refreshed definitions and handles save %s',
  async mode => {
    const save = vi.fn(async (_values: any, _form: HTMLFormElement) => {
      if (mode === 'failure') throw new Error('保存失败');
    });
    const view = render(<Editor version={1} save={save} />);
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'local-draft' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'local-secret' } });
    fireEvent.change(screen.getByLabelText('角色'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByLabelText('启用'));
    const form = screen.getByLabelText('名称').closest('form');
    view.rerender(<Editor version={2} save={save} disabled />);
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.getByLabelText('名称')).toHaveValue('local-draft');
    expect(screen.getByLabelText('密码')).toHaveValue('local-secret');
    expect(screen.getByLabelText('角色')).toHaveValue('admin');
    expect(screen.getByLabelText('启用')).toBeChecked();
    expect(screen.getByLabelText('名称').closest('form')).toBe(form);
    expect(form).toHaveAttribute('data-unsaved', 'true');
    view.rerender(<Editor version={2} save={save} />);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toEqual({
      name: 'local-draft',
      password: 'local-secret',
      role: 'admin',
      enabled: 'on',
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
    expect(screen.getByLabelText('名称')).toHaveValue(
      mode === 'success' ? 'server-2' : 'local-draft',
    );
    expect(screen.getByLabelText('密码')).toHaveValue(mode === 'success' ? '' : 'local-secret');
    expect(form).toHaveAttribute('data-unsaved', String(mode === 'failure'));
  },
);
