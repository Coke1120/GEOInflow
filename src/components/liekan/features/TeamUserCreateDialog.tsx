'use client';
import { useEffect, useRef, useState } from 'react';
import {
  teamUserCreateSchema,
  teamUserResultSchema,
  teamUserRoleChoices,
  matchesTeamUserAttempt,
  type TeamUserCreate,
  type TeamUserCreated,
} from '@/lib/liekan/contracts/team-users';
import type { FeatureEntity } from '@/lib/liekan/contracts/features';
import { useFeature } from './context';
import {
  Button,
  Definition,
  DialogActions,
  Field,
  Form,
  LiekanDialog,
  LinkButton,
  Notice,
  Select,
} from './ui';

export function TeamUserCreateDialog({
  team,
  onClose,
  onCreated,
}: {
  team: FeatureEntity;
  onClose: () => void;
  onCreated: (result: TeamUserCreated) => void;
}) {
  const c = useFeature();
  const [role, setRole] = useState('team-view-only');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [changedUser, setChangedUser] = useState<string>();
  const [message, setMessage] = useState('');
  const id = useRef(crypto.randomUUID());
  const attempt = useRef<TeamUserCreate>(null);
  const pending = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const scope = `${c.user.id}:${c.user.role}:${c.route.page}:${team.id}`;
  const life = useRef({ alive: true, scope });
  life.current.scope = scope;
  useEffect(() => {
    life.current.alive = true;
    return () => {
      life.current.alive = false;
      attempt.current = null;
      for (const controller of requests.current) controller.abort();
    };
  }, []);
  const path = `/liekan/teams/${team.id}/users/create`;
  async function deadline<T>(
    load: (signal: AbortSignal) => Promise<T>,
    milliseconds = 30_000,
  ): Promise<T> {
    const controller = new AbortController();
    requests.current.add(controller);
    let reject: (error: Error) => void;
    const aborted = new Promise<never>((_, fail) => {
      reject = fail;
    });
    const onAbort = () => reject(new Error('请求已中止，需要核对服务端结果'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), milliseconds);
    try {
      return await Promise.race([load(controller.signal), aborted]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      requests.current.delete(controller);
    }
  }

  const active = (started: string) => life.current.alive && life.current.scope === started;
  const complete = (result: TeamUserCreated, started: string) => {
    if (!active(started)) return;
    attempt.current = null;
    onCreated(result);
  };
  async function reconcile(body: TeamUserCreate, started: string) {
    const result = teamUserResultSchema.parse(
      await deadline(signal => c.api.get(path, { userId: body.userId }, signal), 10_000),
    );
    if (!active(started)) return;
    if (matchesTeamUserAttempt(result, team.id, body)) {
      complete(result, started);
      return 'created';
    }
    if (result.state !== 'unconfirmed') {
      setChangedUser(result.user.id);
      setMessage(
        '账户已存在，当前角色或团队归属已有变化。请查看账户并重新读取团队，核对过程不会修改密码或权限。',
      );
    } else
      setMessage('暂未查到完整创建结果。原请求可能仍在处理，请重新核对；重试会沿用本次账户 ID。');
    return result.state === 'unconfirmed' ? 'unconfirmed' : 'changed';
  }
  async function submit(body: TeamUserCreate) {
    if (!body || pending.current) return;
    pending.current = true;
    const started = scope;
    setBusy(true);
    setMessage('');
    try {
      const result = teamUserResultSchema.parse(
        await deadline(signal => c.api.post(path, body, signal)),
      );
      if (!matchesTeamUserAttempt(result, team.id, body)) throw new Error('创建响应需要核对');
      complete(result, started);
    } catch (error: any) {
      if (!active(started)) return;
      if ([400, 401, 403, 404, 413].includes(error?.status) || error?.code === 'username-conflict')
        throw error;
      setUncertain(true);
      try {
        const outcome = await reconcile(body, started);
        if (outcome === 'created') return;
        if (error?.status === 409 && outcome === 'unconfirmed' && active(started))
          setMessage(`${error.message}。请核对本次账户 ID，或关闭弹窗后添加已有用户。`);
      } catch {
        if (active(started))
          setMessage(
            '创建结果尚未确认，结果核对暂时失败。请重试核对，关闭弹窗不会撤销服务端操作。',
          );
      }
    } finally {
      pending.current = false;
      if (active(started)) setBusy(false);
    }
  }
  return (
    <LiekanDialog
      title="新建用户并加入团队"
      subtitle={team.name}
      onClose={() => {
        if (!busy) {
          attempt.current = null;
          onClose();
        }
      }}
    >
      {uncertain ? (
        <>
          <Notice tone="amber">{message || '创建结果尚未确认。'}</Notice>
          <Notice>关闭弹窗不会回滚已经完成的创建。用户名和团队权限需要核对后确认。</Notice>
          <DialogActions>
            <Button disabled={busy} onClick={onClose}>
              关闭
            </Button>
            {changedUser ? (
              <LinkButton page="admin-user" params={{ id: changedUser }}>
                查看用户
              </LinkButton>
            ) : (
              <Button disabled={busy} onClick={() => submit(attempt.current)}>
                重试本次创建
              </Button>
            )}
            <Button
              primary
              disabled={busy}
              onClick={async () => {
                if (pending.current) return;
                pending.current = true;
                const started = scope,
                  body = attempt.current;
                setBusy(true);
                try {
                  await reconcile(body, started);
                } catch {
                  if (active(started)) setMessage('结果核对失败，请重新读取。');
                } finally {
                  pending.current = false;
                  if (active(started)) setBusy(false);
                }
              }}
            >
              核对创建结果
            </Button>
          </DialogActions>
        </>
      ) : (
        <Form
          columns
          busy={busy}
          submitLabel="创建并加入团队"
          onSubmit={async (values: any) => {
            if (values.password !== values.confirmPassword) throw new Error('两次输入的密码不一致');
            const parsed = teamUserCreateSchema.safeParse({
              userId: id.current,
              username: values.username,
              password: values.password,
              teamRole: values.teamRole,
            });
            if (!parsed.success) throw new Error(parsed.error.issues[0].message);
            attempt.current = parsed.data;
            await submit(parsed.data);
          }}
        >
          <Field
            label="用户名"
            name="username"
            required
            maxLength={255}
            autoComplete="off"
            help="全系统唯一，去除首尾空白并统一保存为小写。"
          />
          <Field label="所属团队" value={team.name} readOnly />
          <Field
            label="初始密码"
            name="password"
            type={showPassword ? 'text' : 'password'}
            required
            minLength={8}
            autoComplete="new-password"
            help="至少 8 位，UTF-8 编码最多 72 字节。"
          />
          <Field
            label="确认密码"
            name="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            required
            minLength={8}
            autoComplete="new-password"
          />
          <Button aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>
            {showPassword ? '隐藏密码' : '显示密码'}
          </Button>
          <Field label="系统角色" value="普通用户" readOnly />
          <Select
            label="团队角色"
            name="teamRole"
            value={role}
            options={teamUserRoleChoices}
            onChange={event => setRole(event.target.value)}
          />
          <Definition
            items={[
              ['访问范围', '当前团队的可访问资源'],
              [
                '网站权限',
                role === 'team-view-only' ? '查看统计与配置' : '创建、修改、删除团队网站',
              ],
              ['成员管理', role === 'team-manager' ? '管理团队成员及只读成员' : '无'],
              ['AI 分析', role === 'team-view-only' ? '查看已有记录' : '实例启用后可发起分析'],
              [
                'AI 配置与蜘蛛控制',
                role === 'team-manager' ? '具有管理权限，实际执行按功能规则核验' : '无',
              ],
            ]}
          />
          <Notice tone="amber">
            团队成员包含删除团队网站的权限。团队只读限制当前团队，普通账户仍可在个人空间创建资源。
          </Notice>
          <Notice>
            双重验证沿用全局和当前团队的安全策略。系统管理员及全局只读角色由系统用户管理配置。
          </Notice>
        </Form>
      )}
    </LiekanDialog>
  );
}
