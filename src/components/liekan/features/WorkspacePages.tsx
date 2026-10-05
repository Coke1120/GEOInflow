'use client';
import { useListState } from './listState';

import {
  freshnessStaleTime,
  withClientFreshness,
  shareWithFreshness,
} from '@/lib/liekan/upstream/client-freshness';
import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { FeatureEntity } from '@/lib/liekan/contracts/features';
import { numberLabel, rowsOf } from '@/lib/liekan/contracts/features';
import {
  allowedShareSections,
  bindBoardComponent,
  boardColumns,
  boardEntity,
  boardParameters,
  canCreateResource,
  canManageMember,
  canManageResource,
  canManageTeam,
  eventChartData,
  hasShareSection,
  moveBoardColumn,
  nativeMetric,
  removeBoardColumn,
  setBoardColumnWidth,
  shareParameters,
  shareSections,
  shareTypes,
  teamRoleOptions,
  updateBoardColumn,
  userRoleOptions,
  type WorkspaceComponent,
  type WorkspaceParameters,
  workspaceRoleLabels,
  workspaceTeamRole,
} from '@/lib/liekan/contracts/workspace';
import {
  featureRequest,
  getFeatureWebsiteSummary,
  mapFeatureRows,
  getAllFeatureRows,
  getFeaturePreferences,
} from '@/lib/liekan/upstream/features-client';
import { Chart } from './Chart';
import { SharedWebsiteOverview } from './SharedWebsiteOverview';
import { sharedDateRange } from '@/lib/liekan/contracts/shared-report';
import sharedStyles from '@/styles/liekan/SharedReport.module.css';
import { FeatureProvider, useAction, useData, useFeature, useResourceContext } from './context';
import {
  Badge,
  Body,
  Button,
  Check,
  Definition,
  LiekanDialog,
  Field,
  Form,
  Icon,
  LinkButton,
  Metrics,
  StaticHeading,
  Notice,
  Panel,
  QueryState,
  Select,
  Switch,
  Table,
  Tabs,
  Textarea,
} from './ui';

export const workspacePages = new Set([
  'teams',
  'team-detail',
  'team-join',
  'admin-users',
  'admin-user',
  'admin-websites',
  'admin-teams',
  'admin-security',
  'boards',
  'board-editor',
  'board-design',
  'board-view',
  'dashboard',
  'dashboard-edit',
  'sharing',
  'share-preview',
]);
const types: [string, string][] = [
  ['website', '网站'],
  ['link', '链接'],
  ['pixel', '像素'],
  ['mixed', '混合'],
];
const labels: Record<string, string> = {
  website: '网站',
  link: '链接',
  pixel: '像素',
  board: '看板',
  mixed: '混合',
  open: '混合',
};
const date = (value: any) =>
  value
    ? new Date(value).toLocaleString('zh-CN', { timeZone: getFeaturePreferences().timezone })
    : '未提供';
const role = (value: string) => workspaceRoleLabels[value] || value || '未提供';
const pagesOf = (data: any, size = 20) =>
  Math.max(1, Math.ceil((data?.count || 0) / (data?.pageSize || size)));
const readable = (value: any) => (value == null ? '未提供' : numberLabel(nativeMetric(value)));
const uid = () => crypto.randomUUID();

function Forbidden() {
  return (
    <Notice tone="amber">
      当前账户没有系统管理权限。
      <div className="form-actions">
        <LinkButton page="dashboard">返回工作台</LinkButton>
      </div>
    </Notice>
  );
}
function ReadOnly() {
  return <Notice tone="amber">当前角色可以查看资源。修改配置需要管理权限。</Notice>;
}
function Search({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="search">
      <input
        type="search"
        aria-label="搜索资源"
        placeholder="搜索名称"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  );
}
function Confirm({ title, word = 'DELETE', children, onConfirm, onClose }: any) {
  const action = useAction();
  return (
    <LiekanDialog protectUnsaved={false} title={title} onClose={() => !action.busy && onClose()}>
      <Form
        busy={action.busy}
        danger
        trackUnsaved={false}
        submitLabel={title}
        onSubmit={async (values: any) => {
          if (values.confirmation !== word) throw new Error(`请输入 ${word} 确认`);
          await action.run(onConfirm);
          onClose();
        }}
      >
        <Notice tone="red">{children}</Notice>
        <Field label={`输入 ${word} 确认`} name="confirmation" required autoComplete="off" />
      </Form>
    </LiekanDialog>
  );
}

export function useWorkspaceEntities() {
  const c = useFeature();
  const allSources = ['board-editor', 'board-design', 'board-view'].includes(c.route.page);
  const websiteOnly = c.route.page === 'sharing' && c.route.context === 'website';
  const query = useData(
    ['workspace-entities', c.route.teamId, allSources, websiteOnly, c.teams.map(team => team.id)],
    async signal => {
      if (websiteOnly) return { link: [], pixel: [], board: [] };
      const prefix = c.route.teamId && !allSources ? `/teams/${c.route.teamId}` : '';
      const [links, pixels, boards] = await Promise.all(
        ['links', 'pixels', 'boards'].map(async kind => {
          const personal = await getAllFeatureRows<FeatureEntity>(`${prefix}/${kind}`, {}, signal);
          if (!allSources) return personal;
          const teams = await mapFeatureRows(c.teams, team =>
            getAllFeatureRows<FeatureEntity>(`/teams/${team.id}/${kind}`, {}, signal),
          );
          return [
            ...new Map([...personal, ...teams.flat()].map(entity => [entity.id, entity])).values(),
          ];
        }),
      );
      return { link: links, pixel: pixels, board: boards };
    },
  );
  return {
    ...query,
    data: query.data
      ? { ...query.data, website: websiteOnly ? (c.site ? [c.site] : []) : c.sites }
      : undefined,
  };
}

function TeamCreate({ onClose }: { onClose: () => void }) {
  const c = useFeature(),
    action = useAction();
  const users = useData(
    'team-owner-options',
    signal => getAllFeatureRows<any>('/admin/users', {}, signal),
    !!c.user.isAdmin,
  );
  return (
    <LiekanDialog title="创建团队" onClose={() => !action.busy && onClose()}>
      <Form
        columns
        busy={action.busy}
        submitLabel="创建团队"
        onSubmit={async (values: any) => {
          await action.run(
            () =>
              c.api.post('/teams', {
                name: String(values.name).trim(),
                ...(c.user.isAdmin && values.ownerId ? { ownerId: values.ownerId } : {}),
              }),
            '团队已创建',
          );
          try {
            await c.refresh();
          } catch {
            c.notify('团队已创建，页面状态刷新失败，请重新读取。');
          }
          onClose();
        }}
      >
        <Field label="团队名称" name="name" maxLength={50} required />
        {c.user.isAdmin ? (
          <QueryState query={users}>
            <Select
              label="团队所有者"
              name="ownerId"
              defaultValue={c.user.id}
              options={(users.data || []).map((user: any) => [user.id, user.username])}
            />
          </QueryState>
        ) : (
          <Definition items={[['团队所有者', c.user.username]]} />
        )}
      </Form>
    </LiekanDialog>
  );
}
function TwoFactorBadge({ userId }: { userId: string }) {
  const c = useFeature(),
    q = useData(
      ['user-2fa', userId],
      signal => c.api.get(`/admin/users/${userId}/2fa`, undefined, signal),
      !!c.user.isAdmin,
    );
  return q.error ? (
    <span className="muted">未提供</span>
  ) : q.isPending ? (
    <span className="muted">读取中</span>
  ) : (
    <Badge tone={q.data?.isEnabled ? 'green' : 'amber'}>
      {q.data?.isEnabled ? '已启用' : '未启用'}
    </Badge>
  );
}
function Teams({ admin = false }: { admin?: boolean }) {
  const c = useFeature(),
    [page, setPage] = useListState('page', 1),
    [search, setSearch] = useListState('search', ''),
    [create, setCreate] = useState(false);
  const q = useData(
    [admin ? 'admin-teams' : 'teams', page, search],
    async signal => {
      if (admin) return c.api.get('/admin/teams', { page, pageSize: 20, search }, signal);
      const all = await getAllFeatureRows<FeatureEntity>('/teams', {}, signal);
      const filtered = all.filter(
        team => !search || team.name.toLowerCase().includes(search.toLowerCase()),
      );
      return {
        data: filtered.slice((page - 1) * 20, page * 20),
        count: filtered.length,
        pageSize: 20,
      };
    },
    !admin || !!c.user.isAdmin,
  );
  const rows = rowsOf<FeatureEntity>(q.data).filter(
    team => !search || team.name.toLowerCase().includes(search.toLowerCase()),
  );
  if (admin && !c.user.isAdmin) return <Forbidden />;
  const myTeams = c.teams,
    totalMembers = myTeams.every(team => team._count?.members != null)
      ? myTeams.reduce((n, team) => n + team._count.members, 0)
      : null;
  return (
    <>
      {!admin && (
        <Metrics
          loading={q.isPending}
          items={[
            ['参与团队', myTeams.length, '当前账户'],
            [
              '团队网站',
              myTeams.every(team => team._count?.websites != null)
                ? myTeams.reduce((total, team) => total + team._count.websites, 0)
                : '未提供',
              '按团队汇总',
            ],
            ['团队成员', readable(totalMembers), '按团队汇总'],
            ['安全策略', '按团队设置', '沿用双重验证要求'],
          ]}
        />
      )}
      <Panel
        title={admin ? '全局团队' : '我的团队'}
        subtitle={admin ? '系统管理员管理团队与所有者。' : '所有者管理团队，管理员管理资源与成员。'}
        actions={
          <>
            <Search
              value={search}
              onChange={value => {
                setSearch(value);
                setPage(1);
              }}
            />
            {!admin && <LinkButton page="team-join">通过访问码加入</LinkButton>}
            <Button primary disabled={!canCreateResource(c.user)} onClick={() => setCreate(true)}>
              <Icon name="plus" />
              创建团队
            </Button>
          </>
        }
      >
        <QueryState query={q}>
          <Table
            mobile
            rowKeys={rows.map(team => team.id)}
            columns={
              admin
                ? ['团队', '所有者', '成员', '网站', '操作']
                : ['团队', '我的角色', '成员', '网站', '操作']
            }
            numeric={[2, 3]}
            rows={rows.map(team => [
              team.name,
              admin ? (
                team.members?.find((m: any) => m.role === 'team-owner')?.user?.username || '未提供'
              ) : (
                <Badge
                  key="cell-badge-1"
                  tone={workspaceTeamRole(c.user, team) === 'team-owner' ? 'blue' : 'gray'}
                >
                  {role(workspaceTeamRole(c.user, team))}
                </Badge>
              ),
              team._count?.members ?? '未提供',
              team._count?.websites ?? '未提供',
              <LinkButton
                key="cell-linkbutton-2"
                page="team-detail"
                params={{ id: team.id, teamId: team.id }}
              >
                {canManageTeam(c.user, team) ? '管理' : '查看'}
              </LinkButton>,
            ])}
            page={page}
            pages={pagesOf(q.data)}
            onPage={setPage}
          />
        </QueryState>
      </Panel>
      {create && <TeamCreate onClose={() => setCreate(false)} />}
    </>
  );
}
function MemberDrawer({
  team,
  member,
  onClose,
}: {
  team: FeatureEntity;
  member?: any;
  onClose: () => void;
}) {
  const c = useFeature(),
    action = useAction(),
    [remove, setRemove] = useState(false);
  const pending = useRef(false);
  const users = useData(
    ['member-user-options', team.id],
    signal => getAllFeatureRows<any>('/admin/users', {}, signal),
    !member && !!c.user.isAdmin,
  );
  const selfRole = workspaceTeamRole(c.user, team),
    choices = teamRoleOptions.filter(
      ([value]) => c.user.isAdmin || selfRole === 'team-owner' || value !== 'team-manager',
    );
  return (
    <LiekanDialog
      subtitle={team.name + (member ? ' · ' + (member.user?.username || member.userId) : '')}
      title={remove ? '移除成员' : member ? '编辑成员角色' : '添加团队成员'}
      protectUnsaved={!remove && !action.busy && !pending.current}
      onClose={() => !action.busy && !pending.current && onClose()}
    >
      <Form
        columns
        busy={action.busy}
        danger={remove}
        submitLabel={remove ? '移除成员' : member ? '保存成员角色' : '添加团队成员'}
        onSubmit={async (values: any) => {
          pending.current = true;
          try {
            if (remove) {
              if (values.confirmation !== 'REMOVE') throw new Error('请输入 REMOVE 确认');
              await action.run(
                () => c.api.del(`/teams/${team.id}/users/${member.userId}`),
                '成员已移除',
              );
            } else {
              await action.run(() =>
                c.api.post(`/teams/${team.id}/users${member ? `/${member.userId}` : ''}`, {
                  role: values.role,
                  ...(!member && { userId: values.userId }),
                }),
              );
            }
            try {
              await c.refresh();
            } catch {
              c.notify(
                `${remove ? '成员已移除' : member ? '成员角色已保存' : '成员已添加'}，页面状态刷新失败，请重新读取。`,
              );
            }
            onClose();
          } finally {
            pending.current = false;
          }
        }}
      >
        {remove ? (
          <>
            <Notice tone="red">
              成员“{member.user?.username || member.userId}”将失去团队“{team.name}
              ”的资源访问权限，个人账户继续保留。
            </Notice>
            <Field label="输入 REMOVE 确认" name="confirmation" required autoComplete="off" />
          </>
        ) : (
          <>
            {member ? (
              <Field
                label="用户名"
                defaultValue={member.user?.username || member.userId}
                readOnly
              />
            ) : c.user.isAdmin ? (
              <QueryState query={users}>
                <Select
                  label="用户名"
                  name="userId"
                  required
                  options={(users.data || [])
                    .filter((user: any) => !team.members?.some((m: any) => m.userId === user.id))
                    .map((user: any) => [user.id, user.username])}
                />
              </QueryState>
            ) : (
              <Field
                label="已有用户 ID"
                name="userId"
                required
                pattern="[a-fA-F0-9-]{36}"
                help="请向该用户取得账户 ID。现有接口仅向系统管理员开放全局用户名列表。"
              />
            )}
            <Select
              label="团队角色"
              name="role"
              defaultValue={member?.role || 'team-member'}
              options={choices}
            />
            <Notice>添加使用本系统已有账户。</Notice>
            {member && (
              <Button danger disabled={action.busy} onClick={() => setRemove(true)}>
                移除成员
              </Button>
            )}
          </>
        )}
      </Form>
    </LiekanDialog>
  );
}
function TeamDetail() {
  const c = useFeature(),
    id = c.route.teamId || c.route.id,
    [tab, setTab] = useListState('tab', 'members'),
    [page, setPage] = useListState('page', 1),
    [search, setSearch] = useListState('search', ''),
    [drawer, setDrawer] = useState<any>(null),
    action = useAction();
  const q = useData(
    ['team-record', id],
    signal => c.api.get<FeatureEntity>(`/teams/${id}`, undefined, signal),
    !!id,
  );
  const members = useData(
    ['team-members', id, page, search],
    signal => c.api.get(`/teams/${id}/users`, { page, pageSize: 20, search }, signal),
    !!id && tab === 'members',
  );
  const resources = useData(
    ['team-resources', id, page, search],
    signal => c.api.get(`/teams/${id}/websites`, { page, pageSize: 20, search }, signal),
    !!id && tab === 'resources',
  );
  const security = useData(
    'workspace-security',
    signal => c.api.get('/2fa/status', undefined, signal),
    tab === 'security',
  );
  const team = q.data,
    management = canManageTeam(c.user, team),
    owner = workspaceTeamRole(c.user, team) === 'team-owner',
    canDelete = !!c.user.isAdmin || owner;
  useResourceContext(team);
  if (!id)
    return (
      <Notice>
        请选择一个团队。<LinkButton page="teams">我的团队</LinkButton>
      </Notice>
    );
  return (
    <QueryState query={q}>
      {team && (
        <>
          <div className="row between">
            <div>
              <h2>{team.name}</h2>
              <p className="muted">{role(workspaceTeamRole(c.user, team))}</p>
            </div>
            <LinkButton page="teams">返回团队列表</LinkButton>
          </div>
          <Tabs
            items={[
              ['members', '成员'],
              ['resources', '资源'],
              ['security', '安全'],
              ['settings', '设置'],
            ]}
            active={tab}
            onChange={value => {
              setTab(value);
              setPage(1);
              setSearch('');
            }}
          />
          {tab === 'members' ? (
            <Panel
              title="团队成员"
              subtitle="所有者、管理员、成员与只读角色分别保留。"
              actions={
                <>
                  <Search
                    value={search}
                    onChange={value => {
                      setSearch(value);
                      setPage(1);
                    }}
                  />
                  <Button
                    primary
                    disabled={!management}
                    onClick={() => setDrawer({ type: 'member' })}
                  >
                    添加已有用户
                  </Button>
                </>
              }
            >
              <QueryState query={members}>
                <Table
                  mobile
                  rowKeys={rowsOf<any>(members.data).map(member => member.id || member.userId)}
                  columns={['成员', '用户名', '角色', '双重验证', '加入时间', '操作']}
                  rows={rowsOf<any>(members.data).map(member => [
                    member.user?.username || member.userId,
                    member.user?.username || '未提供',
                    <Badge key="cell-badge-3" tone={member.role === 'team-owner' ? 'blue' : 'gray'}>
                      {role(member.role)}
                    </Badge>,
                    c.user.isAdmin ? (
                      <TwoFactorBadge key="cell-twofactorbadge-4" userId={member.userId} />
                    ) : (
                      '未提供'
                    ),
                    date(member.createdAt),
                    member.role === 'team-owner' ? (
                      <span key="cell-span-5" className="muted">
                        所有者
                      </span>
                    ) : (
                      <Button
                        key="cell-button-6"
                        disabled={!canManageMember(c.user, team, member)}
                        onClick={() => setDrawer({ type: 'member', member })}
                      >
                        编辑角色
                      </Button>
                    ),
                  ])}
                  page={page}
                  pages={pagesOf(members.data)}
                  onPage={setPage}
                />
              </QueryState>
            </Panel>
          ) : tab === 'resources' ? (
            <Panel
              title="团队资源"
              subtitle="查看此团队所属的网站、看板、链接和像素。网站转移保留历史访问数据。"
              actions={
                <>
                  <LinkButton page="boards" params={{ teamId: id }}>
                    团队看板
                  </LinkButton>
                  <LinkButton page="links" params={{ teamId: id }}>
                    团队链接
                  </LinkButton>
                  <LinkButton page="pixels" params={{ teamId: id }}>
                    团队像素
                  </LinkButton>
                  <Search
                    value={search}
                    onChange={value => {
                      setSearch(value);
                      setPage(1);
                    }}
                  />
                  {canCreateResource(c.user, team) && (
                    <LinkButton page="onboarding" params={{ teamId: id }} primary>
                      添加网站
                    </LinkButton>
                  )}
                </>
              }
            >
              <QueryState query={resources}>
                <Table
                  mobile
                  rowKeys={rowsOf<FeatureEntity>(resources.data).map(site => site.id)}
                  columns={['网站', '域名', '状态', '操作']}
                  rows={rowsOf<FeatureEntity>(resources.data).map(site => [
                    site.name,
                    site.domain,
                    <Badge key="cell-badge-7">未提供接入状态</Badge>,
                    <LinkButton
                      key="cell-linkbutton-8"
                      page="website-settings"
                      params={{ websiteId: site.id, teamId: id }}
                    >
                      设置
                    </LinkButton>,
                  ])}
                  page={page}
                  pages={pagesOf(resources.data)}
                  onPage={setPage}
                />
              </QueryState>
            </Panel>
          ) : tab === 'security' ? (
            <Panel title="团队双重验证" subtitle="团队要求覆盖个人自主设置。">
              <Body>
                <QueryState query={security}>
                  <Form
                    key={String(team.twoFactorRequired)}
                    busy={action.busy}
                    disabled={!c.user.isAdmin || !security.data?.isConfigured}
                    submitLabel="保存团队策略"
                    onSubmit={(values: any) =>
                      action.run(() =>
                        c.api.post(`/admin/teams/${id}/2fa`, {
                          required: values.required === 'on',
                        }),
                      )
                    }
                  >
                    <Switch
                      label="要求团队成员启用双重验证"
                      name="required"
                      defaultChecked={team.twoFactorRequired}
                      help="开启后未配置的成员需要完成绑定。"
                    />
                    <Notice tone="amber">
                      {!c.user.isAdmin
                        ? '团队安全策略由系统管理员设置。'
                        : !security.data?.isConfigured
                          ? '服务缺少加密配置，暂时无法开启策略。'
                          : team.twoFactorRequired
                            ? '团队已要求双重验证，成员无法自行关闭。'
                            : '成员当前可自主启用双重验证。'}
                    </Notice>
                  </Form>
                </QueryState>
              </Body>
            </Panel>
          ) : (
            <Panel title="团队设置" subtitle="访问码用于已登录用户加入团队。">
              <Body>
                {!management && <ReadOnly />}
                <Form
                  key={`${team.id}-${team.updatedAt}`}
                  busy={action.busy}
                  disabled={!management}
                  submitLabel="保存团队设置"
                  onSubmit={async (values: any) => {
                    await action.run(() => c.api.post(`/teams/${id}`, { name: values.name }));
                    await c.refresh();
                  }}
                >
                  <Field
                    label="团队名称"
                    name="name"
                    defaultValue={team.name}
                    maxLength={50}
                    required
                  />
                  <Field label="团队 ID" value={team.id} readOnly />
                  <div className="row">
                    <Field label="团队访问码" value={team.accessCode || '未提供'} readOnly />
                    <Button
                      disabled={!team.accessCode}
                      onClick={async () => {
                        await navigator.clipboard.writeText(team.accessCode);
                        c.notify('访问码已复制');
                      }}
                    >
                      复制访问码
                    </Button>
                    <Button
                      disabled={action.busy || !management}
                      onClick={async () => {
                        await action.run(
                          () =>
                            c.api.post(`/teams/${id}`, {
                              accessCode: `team_${uid().replaceAll('-', '').slice(0, 16)}`,
                            }),
                          '访问码已更新',
                        );
                      }}
                    >
                      重新生成
                    </Button>
                  </div>
                  <Notice tone="amber">新访问码生成后旧码失效。</Notice>
                </Form>
                <hr className="divider" />
                <div className="row">
                  <Button
                    disabled={owner || action.busy}
                    title={owner ? '所有者需要先转移所有权' : undefined}
                    onClick={() => setDrawer({ type: 'leave' })}
                  >
                    退出团队
                  </Button>
                  <Button
                    danger
                    disabled={!canDelete || action.busy}
                    onClick={() => setDrawer({ type: 'delete' })}
                  >
                    删除团队
                  </Button>
                </div>
              </Body>
            </Panel>
          )}
          {drawer?.type === 'member' && (
            <MemberDrawer team={team} member={drawer.member} onClose={() => setDrawer(null)} />
          )}
          {['delete', 'leave'].includes(drawer?.type) && (
            <Confirm
              title={drawer.type === 'delete' ? '删除团队' : '退出团队'}
              word={drawer.type === 'delete' ? 'DELETE' : 'LEAVE'}
              onClose={() => setDrawer(null)}
              onConfirm={async () => {
                await c.api.del(
                  drawer.type === 'delete' ? `/teams/${id}` : `/teams/${id}/users/${c.user.id}`,
                );
                await c.refresh();
                c.navigate('teams');
              }}
            >
              {drawer.type === 'delete'
                ? '此操作会删除团队及关联链接、像素和看板。请先核对资源归属。'
                : '退出后将失去该团队的资源访问权限。'}
            </Confirm>
          )}
        </>
      )}
    </QueryState>
  );
}
function TeamJoin() {
  const c = useFeature(),
    action = useAction();
  return (
    <div className="wide-narrow">
      <Panel title="通过访问码加入" subtitle="向团队管理者获取访问码。">
        <Body>
          <Form
            busy={action.busy}
            submitLabel="验证并加入"
            cancel={<LinkButton page="teams">取消</LinkButton>}
            onSubmit={async (values: any) => {
              const result = await action.run(
                () => c.api.post('/teams/join', { accessCode: values.accessCode }),
                '已加入团队',
              );
              await c.refresh();
              c.navigate('team-detail', { id: result.teamId, teamId: result.teamId });
            }}
          >
            <Field label="访问码" name="accessCode" required maxLength={50} />
            <Notice>加入使用已有登录账户。成功后显示团队名称与分配角色。</Notice>
          </Form>
        </Body>
      </Panel>
      <Panel title="角色说明" subtitle="权限来自团队管理者的角色设置。">
        <Body>
          <Definition
            items={[
              ['管理员', '管理资源与成员'],
              ['成员', '查看分析并管理授权资源'],
              ['只读', '查看分析，无法修改配置'],
            ]}
          />
        </Body>
      </Panel>
    </div>
  );
}
function CreateUser({ onClose }: { onClose: () => void }) {
  const c = useFeature(),
    action = useAction();
  return (
    <LiekanDialog title="创建系统用户" onClose={() => !action.busy && onClose()}>
      <Form
        columns
        busy={action.busy}
        submitLabel="创建用户"
        onSubmit={async (values: any) => {
          await action.run(() => c.api.post('/users', values), '用户已创建');
          onClose();
        }}
      >
        <Field label="用户名" name="username" required maxLength={255} autoComplete="off" />
        <Field
          label="初始密码"
          name="password"
          type="password"
          required
          minLength={8}
          maxLength={255}
          autoComplete="new-password"
          help="密码至少 8 位。"
        />
        <Select label="系统角色" name="role" options={userRoleOptions} defaultValue="user" />
      </Form>
    </LiekanDialog>
  );
}
function AdminUsers() {
  const c = useFeature(),
    [page, setPage] = useListState('page', 1),
    [search, setSearch] = useListState('search', ''),
    [create, setCreate] = useState(false);
  const q = useData(
    ['admin-users', page, search],
    signal => c.api.get('/admin/users', { page, pageSize: 20, search }, signal),
    !!c.user.isAdmin,
  );
  if (!c.user.isAdmin) return <Forbidden />;
  return (
    <>
      <Panel
        title="系统用户"
        subtitle="创建、查看角色和管理双重验证。"
        actions={
          <>
            <Search
              value={search}
              onChange={value => {
                setSearch(value);
                setPage(1);
              }}
            />
            <Button primary onClick={() => setCreate(true)}>
              <Icon name="plus" />
              创建用户
            </Button>
          </>
        }
      >
        <QueryState query={q}>
          <Table
            mobile
            rowKeys={rowsOf<any>(q.data).map(user => user.id)}
            columns={['用户名', '系统角色', '团队', '双重验证', '状态', '操作']}
            rows={rowsOf<any>(q.data).map(user => [
              user.username,
              <Badge key="cell-badge-9" tone={user.role === 'admin' ? 'blue' : 'gray'}>
                {role(user.role)}
              </Badge>,
              user._count?.teams ?? '未提供',
              <TwoFactorBadge key="cell-twofactorbadge-10" userId={user.id} />,
              <Badge key="cell-badge-11" tone={user.deletedAt ? 'gray' : 'green'}>
                {user.deletedAt ? '已删除' : '正常'}
              </Badge>,
              <LinkButton key="cell-linkbutton-12" page="admin-user" params={{ id: user.id }}>
                查看
              </LinkButton>,
            ])}
            page={page}
            pages={pagesOf(q.data)}
            onPage={setPage}
          />
        </QueryState>
      </Panel>
      <Notice>系统角色与团队角色独立。编辑当前管理员时，禁止修改自己的系统角色。</Notice>
      {create && <CreateUser onClose={() => setCreate(false)} />}
    </>
  );
}
function AdminUser() {
  const c = useFeature(),
    id = c.route.id,
    action = useAction(),
    [confirm, setConfirm] = useState('');
  const q = useData(
    ['admin-user', id],
    signal => c.api.get(`/users/${id}`, undefined, signal),
    !!id && !!c.user.isAdmin,
  );
  const resources = useData(
    ['admin-user-resources', id],
    async signal => {
      const [websites, teams] = await Promise.all([
        getAllFeatureRows<any>(`/users/${id}/websites`, {}, signal),
        getAllFeatureRows<any>(`/users/${id}/teams`, {}, signal),
      ]);
      return { websites, teams };
    },
    !!id && !!c.user.isAdmin,
  );
  const security = useData(
    ['user-2fa', id],
    signal => c.api.get(`/admin/users/${id}/2fa`, undefined, signal),
    !!id && !!c.user.isAdmin,
  );
  if (!c.user.isAdmin) return <Forbidden />;
  return (
    <QueryState query={q}>
      {q.data && (
        <>
          <div className="row between">
            <h2>用户 · {q.data.username}</h2>
            <LinkButton page="admin-users">返回用户管理</LinkButton>
          </div>
          <div className="two">
            <Panel title="账户信息" subtitle="管理员可修改用户资料，密码留空表示保留。">
              <Body>
                <Form
                  key={`${id}-${q.data.updatedAt}`}
                  busy={action.busy}
                  submitLabel="保存用户"
                  onSubmit={(values: any) =>
                    action.run(() =>
                      c.api.post(`/users/${id}`, {
                        username: values.username,
                        ...(values.password ? { password: values.password } : {}),
                        ...(id !== c.user.id ? { role: values.role } : {}),
                      }),
                    )
                  }
                >
                  <Field
                    label="用户名"
                    name="username"
                    defaultValue={q.data.username}
                    required
                    maxLength={255}
                  />
                  <Field
                    label="新密码（可选）"
                    name="password"
                    type="password"
                    minLength={8}
                    maxLength={255}
                    autoComplete="new-password"
                    help="留空保留当前密码，修改需至少 8 位。"
                  />
                  <Select
                    label="系统角色"
                    name="role"
                    options={userRoleOptions}
                    defaultValue={q.data.role}
                    disabled={id === c.user.id}
                  />
                </Form>
              </Body>
            </Panel>
            <Panel title="账户安全" subtitle="重置双重验证后，用户需要重新绑定。">
              <Body>
                <QueryState query={security}>
                  <Definition
                    items={[
                      [
                        '双重验证',
                        <Badge
                          key="cell-badge-13"
                          tone={security.data?.isEnabled ? 'green' : 'amber'}
                        >
                          {security.data?.isEnabled ? '已启用' : '未启用'}
                        </Badge>,
                      ],
                      ['账户要求', q.data.twoFactorRequired ? '必须启用' : '自主选择'],
                      [
                        '账户状态',
                        <Badge key="cell-badge-14" tone="green">
                          正常
                        </Badge>,
                      ],
                    ]}
                  />
                  <div className="form-actions">
                    <Button disabled={action.busy} onClick={() => setConfirm('reset')}>
                      重置双重验证
                    </Button>
                    <Button
                      danger
                      disabled={id === c.user.id || action.busy}
                      onClick={() => setConfirm('delete')}
                    >
                      删除用户
                    </Button>
                  </div>
                </QueryState>
              </Body>
            </Panel>
          </div>
          <Panel title="用户资源" subtitle="管理员查看该账户的网站和团队。">
            <QueryState query={resources}>
              <Table
                mobile
                identity={1}
                rowKeys={[
                  ...(resources.data?.teams || []).map((team: any) => `team:${team.id}`),
                  ...(resources.data?.websites || []).map((site: any) => `site:${site.id}`),
                ]}
                columns={['类型', '资源名称', '角色', '操作']}
                rows={[
                  ...(resources.data?.teams || []).map((team: any) => [
                    '团队',
                    team.name,
                    role(
                      workspaceTeamRole({ id, username: q.data.username, role: q.data.role }, team),
                    ),
                    <LinkButton
                      key="cell-linkbutton-15"
                      page="team-detail"
                      params={{ id: team.id, teamId: team.id }}
                    >
                      查看
                    </LinkButton>,
                  ]),
                  ...(resources.data?.websites || []).map((site: any) => [
                    '网站',
                    site.name,
                    '所有者',
                    <LinkButton
                      key="cell-linkbutton-16"
                      page="website-settings"
                      params={{ websiteId: site.id }}
                    >
                      查看
                    </LinkButton>,
                  ]),
                ]}
              />
            </QueryState>
          </Panel>
          {confirm && (
            <Confirm
              title={confirm === 'reset' ? '重置用户双重验证' : '删除用户'}
              word={confirm === 'reset' ? 'RESET' : 'DELETE'}
              onClose={() => setConfirm('')}
              onConfirm={async () => {
                await c.api.del(confirm === 'reset' ? `/admin/users/${id}/2fa` : `/users/${id}`);
                if (confirm === 'delete') c.navigate('admin-users');
              }}
            >
              {confirm === 'reset'
                ? '该用户需重新绑定验证器，现有恢复码将失效。'
                : '此操作会删除该用户及其拥有的资源。请核对资源归属。'}
            </Confirm>
          )}
        </>
      )}
    </QueryState>
  );
}
function AdminWebsites() {
  const c = useFeature(),
    [page, setPage] = useListState('page', 1),
    [search, setSearch] = useListState('search', ''),
    [space, setSpace] = useState(''),
    [filter, setFilter] = useState(false);
  const q = useData(
    ['admin-websites', page, search, space],
    signal =>
      c.api.get(
        space ? `/teams/${space}/websites` : '/admin/websites',
        { page, pageSize: 20, search },
        signal,
      ),
    !!c.user.isAdmin,
  );
  const teams = useData(
    'admin-space-options',
    signal => getAllFeatureRows<any>('/admin/teams', {}, signal),
    filter && !!c.user.isAdmin,
  );
  if (!c.user.isAdmin) return <Forbidden />;
  return (
    <>
      <Panel
        title="全局网站"
        subtitle="系统管理员检索资源及所属账户、团队。"
        actions={
          <>
            <Search
              value={search}
              onChange={value => {
                setSearch(value);
                setPage(1);
              }}
            />
            <Button onClick={() => setFilter(true)}>按空间筛选</Button>
          </>
        }
      >
        <QueryState query={q}>
          <Table
            mobile
            rowKeys={rowsOf<any>(q.data).map(site => site.id)}
            columns={['网站', '域名', '所属空间', '所有者', '操作']}
            rows={rowsOf<any>(q.data).map(site => [
              site.name,
              site.domain,
              site.team?.name ||
                c.teams.find(team => team.id === (site.teamId || space))?.name ||
                (site.teamId ? '团队' : '个人空间'),
              site.user?.username ||
                site.team?.members?.find((member: any) => member.role === 'team-owner')?.userId ||
                '未提供',
              <LinkButton
                key="cell-linkbutton-17"
                page="website-settings"
                params={{ websiteId: site.id, teamId: site.teamId || space || undefined }}
              >
                设置
              </LinkButton>,
            ])}
            page={page}
            pages={pagesOf(q.data)}
            onPage={setPage}
          />
        </QueryState>
      </Panel>
      {filter && (
        <LiekanDialog title="按所属空间筛选" onClose={() => setFilter(false)}>
          <QueryState query={teams}>
            <Form
              submitLabel="应用筛选"
              onSubmit={(values: any) => {
                setSpace(values.space);
                setPage(1);
                setFilter(false);
              }}
            >
              <Select
                label="所属空间"
                name="space"
                defaultValue={space}
                options={[
                  ['', '全部空间'],
                  ...(teams.data || []).map((team: any) => ({ value: team.id, label: team.name })),
                ]}
              />
            </Form>
          </QueryState>
        </LiekanDialog>
      )}
    </>
  );
}
function AdminSecurity() {
  const c = useFeature(),
    action = useAction(),
    q = useData(
      'workspace-security',
      signal => c.api.get('/2fa/status', undefined, signal),
      !!c.user.isAdmin,
    );
  if (!c.user.isAdmin) return <Forbidden />;
  return (
    <QueryState query={q}>
      <div className="wide-narrow">
        <Panel title="系统双重验证策略" subtitle="全局要求覆盖个人与团队的自主设置。">
          <Body>
            <Form
              key={String(q.data?.globalRequired)}
              busy={action.busy}
              disabled={!q.data?.isConfigured}
              submitLabel="保存全局策略"
              onSubmit={(values: any) =>
                action.run(() =>
                  c.api.post('/admin/2fa/global', { required: values.required === 'on' }),
                )
              }
            >
              <Switch
                label="所有用户必须启用双重验证"
                name="required"
                defaultChecked={q.data?.globalRequired}
                help="下次登录时引导尚未绑定的用户完成设置。"
              />
              <hr className="divider" />
              <Notice tone={q.data?.isConfigured ? 'blue' : 'red'}>
                {q.data?.isConfigured
                  ? '加密配置已就绪。开启前请确认管理员已保存恢复码。'
                  : '服务缺少加密配置，暂时无法开启全局策略。请先完成服务端配置。'}
              </Notice>
            </Form>
          </Body>
        </Panel>
        <Panel title="配置状态" subtitle="当前服务的配置与策略。">
          <Body>
            <Definition
              items={[
                [
                  '加密配置',
                  <Badge key="cell-badge-18" tone={q.data?.isConfigured ? 'green' : 'red'}>
                    {q.data?.isConfigured ? '已配置' : '未配置'}
                  </Badge>,
                ],
                ['全局要求', q.data?.globalRequired ? '开启' : '关闭'],
                ['团队策略', '全局要求开启时，团队无法覆盖'],
              ]}
            />
          </Body>
        </Panel>
      </div>
    </QueryState>
  );
}

export function ResourceAnalytics({
  id,
  kind = 'website',
  title = '访问趋势',
  metrics = true,
  request,
  range,
  filters = {},
  variant,
  allowGoals = true,
  chartEnabled = true,
}: {
  chartEnabled?: boolean;
  variant?: 'board' | 'public';
  allowGoals?: boolean;
  id: string;
  kind?: string;
  title?: string;
  metrics?: boolean;
  request?: (path: string, params?: any, signal?: AbortSignal) => Promise<any>;
  range?: any;
  filters?: any;
}) {
  const c = useFeature(),
    params = {
      ...(range || c?.range),
      ...filters,
      ...(!request ? (kind === 'website' ? c?.filters : {}) : {}),
      ...(kind === 'link' ? { eventType: 3 } : kind === 'pixel' ? { eventType: 4 } : {}),
    };
  const get =
    request || ((path: string, query: any, signal?: AbortSignal) => c.api.get(path, query, signal));
  const q = useQuery({
    queryKey: [
      'liekan-feature',
      'resource-analytics',
      request ? (request as any).shareToken : c?.user?.id,
      id,
      kind,
      params,
      metrics,
      variant,
      allowGoals,
    ],
    queryFn: ({ signal }) =>
      withClientFreshness(signal, async () => {
        const [stats, trend, aiTrend] = await Promise.all([
          metrics ? get(`/websites/${id}/stats`, params, signal) : null,
          get(`/websites/${id}/pageviews`, params, signal),
          kind === 'website'
            ? get(
                `/websites/${id}/pageviews`,
                { ...params, drill_channel: 'eq.AI 搜索引荐' },
                signal,
              )
            : null,
        ]);
        const aiStats =
          metrics && variant && kind === 'website'
            ? await get(
                `/websites/${id}/stats`,
                { ...params, drill_channel: 'eq.AI 搜索引荐' },
                signal,
              )
            : null;
        let appointment: any = null;
        if (metrics && variant && kind === 'website' && allowGoals) {
          const goals = await allSharedRows(get, `/websites/${id}/goals`, signal);
          const goal = goals.find((g: any) =>
            /预约|appointment|book.*demo|demo.*book/i.test(g.name || ''),
          );
          if (goal)
            appointment = await get(`/websites/${id}/goals/${goal.id}/stats`, params, signal);
        }
        return { stats, trend, aiTrend, aiStats, appointment };
      }),
    staleTime: query => freshnessStaleTime(query),
    gcTime: 600000,
    structuralSharing: shareWithFreshness,
    enabled: !!id,
    retry: false,
  });
  const trend = q.data?.trend,
    points = trend?.pageviews || [],
    sessions = trend?.sessions || [];
  return (
    <QueryState query={q}>
      {metrics && (
        <Metrics
          loading={q.isPending}
          items={
            variant
              ? variant === 'board'
                ? [
                    ['访客', readable(q.data?.stats?.visitors), '当前期间'],
                    ['AI 引荐', readable(q.data?.aiStats?.visitors), '已识别来源'],
                    [
                      '预约转化',
                      q.data?.appointment ? readable(q.data.appointment.conversions) : '未配置',
                      '所选预约目标的事件触发次数',
                    ],
                    [
                      '转化访客',
                      q.data?.appointment ? readable(q.data.appointment.num) : '未配置',
                      '独立转化访客',
                    ],
                  ]
                : [
                    ['访客', readable(q.data?.stats?.visitors), '当前期间'],
                    ['访问次数', readable(q.data?.stats?.pageviews), '页面访问次数'],
                    ['AI 引荐', readable(q.data?.aiStats?.visitors), '已识别来源'],
                    [
                      '预约演示',
                      q.data?.appointment
                        ? readable(q.data.appointment.conversions)
                        : allowGoals
                          ? '未配置'
                          : '未授权',
                      '所选预约目标的事件触发次数',
                    ],
                  ]
              : [
                  [
                    kind === 'link' ? '点击次数' : kind === 'pixel' ? '请求次数' : '页面访问',
                    readable(q.data?.stats?.pageviews),
                    '当前期间',
                  ],
                  [
                    '独立访客',
                    readable(q.data?.stats?.visitors),
                    kind === 'pixel' ? '请求访问标识聚合' : '访问标识聚合',
                  ],
                  ['访问次数', readable(q.data?.stats?.visits), '当前期间'],
                  [
                    '统计口径',
                    kind === 'pixel' ? '图片请求' : kind === 'link' ? '链接点击' : '网站访问',
                    kind === 'pixel' ? '包括代理与缓存影响' : '按采集记录统计',
                  ],
                ]
          }
        />
      )}
      {chartEnabled && variant !== 'board' && (
        <Chart
          title={title}
          subtitle="所选日期范围"
          labels={points.map((point: any) => String(point.x))}
          series={[
            {
              name: kind === 'link' ? '点击次数' : kind === 'pixel' ? '请求次数' : '访客',
              values: (kind === 'website' ? sessions : points).map((point: any) =>
                nativeMetric(point.y),
              ),
            },
            kind === 'website'
              ? {
                  name: 'AI 引荐',
                  color: '#009D9A',
                  values: (q.data?.aiTrend?.sessions || []).map((point: any) =>
                    nativeMetric(point.y),
                  ),
                }
              : { name: '独立访客', values: sessions.map((point: any) => nativeMetric(point.y)) },
          ]}
        />
      )}
    </QueryState>
  );
}
function Boards() {
  const c = useFeature(),
    [page, setPage] = useListState('page', 1),
    [search, setSearch] = useListState('search', '');
  const q = useData(['boards', c.route.teamId, page, search], signal =>
    c.api.get(
      c.route.teamId ? `/teams/${c.route.teamId}/boards` : '/boards',
      { page, pageSize: 20, search },
      signal,
    ),
  );
  const team = c.teams.find(team => team.id === c.route.teamId);
  return (
    <>
      <Panel
        title="自定义看板"
        subtitle="按网站、链接、像素或多个资源组织分析。"
        actions={
          <>
            <Search
              value={search}
              onChange={value => {
                setSearch(value);
                setPage(1);
              }}
            />
            {canCreateResource(c.user, team) && (
              <LinkButton page="board-editor" primary>
                <Icon name="plus" />
                创建看板
              </LinkButton>
            )}
          </>
        }
      >
        <QueryState query={q}>
          <Table
            mobile
            rowKeys={rowsOf<any>(q.data).map(board => board.id)}
            columns={['名称', '类型', '关联资源', '更新时间', '操作']}
            rows={rowsOf<any>(q.data).map(board => {
              const entity = boardEntity(board.parameters, board.type);
              return [
                board.name,
                <Badge key="cell-badge-19">{labels[board.type] || board.type}</Badge>,
                entity.entityId
                  ? c.sites.find(site => site.id === entity.entityId)?.name || entity.entityId
                  : `${boardColumns(board.parameters).length} 个组件`,
                date(board.updatedAt),
                <LinkButton key="cell-linkbutton-20" page="board-view" params={{ id: board.id }}>
                  打开
                </LinkButton>,
              ];
            })}
            page={page}
            pages={pagesOf(q.data)}
            onPage={setPage}
          />
        </QueryState>
      </Panel>
      <Notice>看板包括基本信息、图表编排和只读分享。复制看板会保留布局。</Notice>
    </>
  );
}
function BoardEditor({ board }: { board?: any }) {
  const c = useFeature(),
    action = useAction(),
    entities = useWorkspaceEntities(),
    [type, setType] = useState(board?.type === 'open' ? 'mixed' : board?.type || 'website');
  const selected = boardEntity(board?.parameters, board?.type),
    allowed = board ? canManageResource(c.user, board, c.teams) : canCreateResource(c.user);
  return (
    <Panel title="看板信息" subtitle="资源类型沿用上游网站、像素、链接与混合看板。">
      <Body>
        {!allowed && <ReadOnly />}
        <QueryState query={entities}>
          <Form
            busy={action.busy}
            disabled={!allowed}
            submitLabel="保存并编排"
            cancel={<LinkButton page="boards">取消</LinkButton>}
            onSubmit={async (values: any) => {
              if (
                !board &&
                !canCreateResource(
                  c.user,
                  values.owner ? c.teams.find(team => team.id === values.owner) : undefined,
                )
              )
                throw new Error('当前空间没有创建看板的权限');
              if (!board && values.owner && !c.teams.some(team => team.id === values.owner))
                throw new Error('请选择可访问的所属空间');
              if (type !== 'mixed' && !values.entity) throw new Error('请选择关联资源');
              const result = await action.run(() =>
                c.api.post(board ? `/boards/${board.id}` : '/boards', {
                  name: values.name,
                  description: values.description,
                  type,
                  parameters: boardParameters(board?.parameters, type, values.entity, board?.type),
                  ...(!board && values.owner ? { teamId: values.owner } : {}),
                }),
              );
              c.navigate('board-design', {
                id: result.id,
                teamId: result.teamId || values.owner || '',
              });
            }}
          >
            {board ? (
              <Definition
                items={[
                  [
                    '所属空间',
                    board.teamId
                      ? c.teams.find(team => team.id === board.teamId)?.name || '团队空间'
                      : '个人空间',
                  ],
                ]}
              />
            ) : (
              <Select
                label="所属空间"
                name="owner"
                defaultValue={c.route.teamId || ''}
                options={[
                  ['', '个人空间'],
                  ...c.teams
                    .filter(team => canCreateResource(c.user, team))
                    .map(team => [team.id, team.name] as [string, string]),
                ]}
              />
            )}
            <Field
              label="看板名称"
              name="name"
              defaultValue={board?.name || ''}
              required
              maxLength={board ? 200 : 100}
            />
            <Textarea
              label="说明"
              name="description"
              defaultValue={board?.description || ''}
              maxLength={500}
            />
            <div className="form-grid">
              <Select
                label="看板类型"
                name="type"
                value={type}
                onChange={e => setType(e.target.value)}
                options={types}
              />
              {type !== 'mixed' && (
                <Select
                  key={type}
                  label="关联资源"
                  name="entity"
                  defaultValue={selected.entityType === type ? selected.entityId : ''}
                  required
                  options={[
                    ['', '请选择资源'],
                    ...(entities.data?.[type] || []).map((entity: any) => [entity.id, entity.name]),
                  ]}
                />
              )}
            </div>
            <Notice>网站、链接、像素看板需要选择对应资源。混合看板由各图表分别选择资源。</Notice>
          </Form>
        </QueryState>
      </Body>
    </Panel>
  );
}
const widgetTypes: [string, string][] = [
  ['WebsiteChart', '访客趋势'],
  ['MetricsTable', '访问来源'],
  ['EventsChart', '转化事件'],
  ['WebsiteMetricsBar', '指标摘要'],
];
function WidgetDrawer({
  board,
  column,
  onSave,
  onClose,
}: {
  board: any;
  column?: any;
  onSave: (component: WorkspaceComponent, full: boolean) => void;
  onClose: () => void;
}) {
  const entities = useWorkspaceEntities(),
    [type, setType] = useState(column?.component?.type || 'WebsiteChart'),
    [entityType, setEntityType] = useState(column?.component?.entityType || 'website');
  const boardResource = boardEntity(board.parameters, board.type),
    fixed = !!boardResource.entityType,
    actualType = fixed ? boardResource.entityType : entityType,
    eventOnly = type === 'EventsChart';
  return (
    <LiekanDialog size="wide" title={column ? '编辑看板组件' : '添加看板组件'} onClose={onClose}>
      <QueryState query={entities}>
        <Form
          columns
          submitLabel={column ? '保存组件' : '添加组件'}
          onSubmit={(values: any) => {
            const entityId = fixed ? boardResource.entityId : values.entityId;
            if (!entityId) throw new Error('请选择关联资源');
            if (eventOnly && actualType !== 'website') throw new Error('转化事件组件需要网站资源');
            onSave(
              bindBoardComponent(
                {
                  ...column?.component,
                  title: values.title,
                  type,
                  props: {
                    ...column?.component?.props,
                    ...(type === 'MetricsTable'
                      ? { type: values.dimension || 'channel', liekanDisplay: 'bar' }
                      : {}),
                  },
                },
                fixed ? undefined : actualType,
                fixed ? undefined : entityId,
              ),
              values.full === 'on',
            );
            onClose();
          }}
        >
          <Field
            label="组件标题"
            name="title"
            defaultValue={column?.component?.title || ''}
            required
            maxLength={100}
          />
          <Select
            label="图表类型"
            name="type"
            options={[
              ...widgetTypes.filter(
                ([value]) => actualType === 'website' || value !== 'EventsChart',
              ),
              ...(column?.component?.type &&
              !widgetTypes.some(([value]) => value === column.component.type)
                ? [[column.component.type, '原有组件（保留配置）'] as [string, string]]
                : []),
            ]}
            value={type}
            onChange={e => setType(e.target.value)}
          />
          {!fixed && (
            <Select
              label="资源类型"
              value={entityType}
              onChange={e => {
                setEntityType(e.target.value);
                if (e.target.value !== 'website' && type === 'EventsChart') setType('WebsiteChart');
              }}
              options={types.filter(([value]) => value !== 'mixed')}
            />
          )}
          {fixed ? (
            <Definition
              items={[
                [
                  '关联资源',
                  entities.data?.[actualType]?.find(
                    (entity: any) => entity.id === boardResource.entityId,
                  )?.name || boardResource.entityId,
                ],
              ]}
            />
          ) : (
            <Select
              key={actualType}
              label="关联资源"
              name="entityId"
              required
              defaultValue={column?.component?.entityId || column?.component?.websiteId || ''}
              options={[
                ['', '请选择资源'],
                ...(entities.data?.[actualType] || []).map((entity: any) => [
                  entity.id,
                  entity.name,
                ]),
              ]}
            />
          )}
          {type === 'MetricsTable' && (
            <Select
              label="访问维度"
              name="dimension"
              options={[
                ['channel', '访问渠道'],
                ['referrer', '来源'],
                ['country', '国家 / 地区'],
                ['browser', '浏览器'],
                ['device', '设备'],
                ['path', '页面'],
              ]}
              defaultValue={column?.component?.props?.type || 'channel'}
            />
          )}
          <Notice>组件保存后，请继续保存看板以保留本次配置。</Notice>
          <Check
            name="full"
            defaultChecked={
              column &&
              boardColumns(board.parameters).find(entry => entry.column.id === column.id)?.row
                .columns.length === 1 &&
              (column.size ?? 100) > 50
            }
          >
            占据整行
          </Check>
        </Form>
      </QueryState>
    </LiekanDialog>
  );
}
function NativeWidget({
  board,
  component,
  request,
  range,
}: {
  board: any;
  component: WorkspaceComponent;
  request?: any;
  range?: any;
}) {
  const c = useFeature(),
    resolved = boardEntity(board.parameters, board.type),
    id = resolved.entityId || component?.entityId || component?.websiteId,
    kind = resolved.entityType || component?.entityType || 'website';
  const get =
    request ||
    ((path: string, params: any, signal?: AbortSignal) => c.api.get(path, params, signal));
  const params = {
    ...(range || c?.range),
    ...(!request && kind === 'website' ? c?.filters : {}),
    ...(kind === 'link' ? { eventType: 3 } : kind === 'pixel' ? { eventType: 4 } : {}),
  };
  const dimension = component?.props?.type || 'referrer',
    table = ['MetricsTable', 'UTM', 'WorldMap'].includes(component?.type),
    events = component?.type === 'EventsChart',
    conversion = ['Goal', 'Funnel'].includes(component?.type),
    eventMetrics = component?.type === 'EventsMetricsBar',
    reportId = component?.props?.reportId;
  const q = useQuery({
    queryKey: [
      'liekan-feature',
      'board-widget',
      request ? request.shareToken : c?.user?.id,
      id,
      component,
      params,
    ],
    queryFn: ({ signal }) =>
      get(
        `/websites/${id}/${conversion ? `${component.type === 'Goal' ? 'goals' : 'funnels'}/${reportId}/stats` : eventMetrics ? 'events/stats' : events ? 'events/series' : component.type === 'UTM' ? 'utm/metrics' : 'metrics'}`,
        {
          ...params,
          type: events
            ? 'event'
            : component.type === 'UTM'
              ? component.props?.param || 'utm_source'
              : component.type === 'WorldMap'
                ? 'country'
                : dimension,
          limit: component.props?.limit || 10,
        },
        signal,
      ),
    enabled: !!id && (table || events || eventMetrics || (conversion && !!reportId)),
    retry: false,
  });
  if (!component) return <div className="state-box">尚未配置组件</div>;
  if (component.type === 'TextBlock')
    return (
      <Body>
        <p style={{ whiteSpace: 'pre-wrap' }}>
          {component.props?.content || component.props?.text || ''}
        </p>
      </Body>
    );
  if (!id) return <Notice tone="amber">组件尚未选择关联资源。</Notice>;
  if (conversion && !reportId)
    return (
      <Notice tone="amber">
        此组件尚未选择已保存的{component.type === 'Goal' ? '目标' : '漏斗'}。
      </Notice>
    );
  if (conversion)
    return (
      <QueryState query={q}>
        {component.type === 'Goal' ? (
          <Metrics
            loading={q.isPending}
            items={[
              ['转化访客', readable(q.data?.num), '独立访客'],
              ['入组访客', readable(q.data?.total), '所选期间'],
              [
                '转化率',
                q.data?.total > 0
                  ? `${((q.data.num / q.data.total) * 100).toFixed(2)}%`
                  : q.data?.total === 0
                    ? '无入组访客'
                    : '未提供',
                '转化访客 / 入组访客',
              ],
            ]}
          />
        ) : (
          <Chart
            type="bar"
            labels={rowsOf<any>(q.data).map((step, index) => step.value || `步骤 ${index + 1}`)}
            series={[
              {
                name: '转化访客',
                values: rowsOf<any>(q.data).map(step => nativeMetric(step.visitors)),
              },
            ]}
          />
        )}
      </QueryState>
    );
  if (eventMetrics)
    return (
      <QueryState query={q}>
        <Metrics
          loading={q.isPending}
          items={[
            ['事件次数', readable(q.data?.data?.events), '当前期间'],
            ['触发访客', readable(q.data?.data?.visitors), '独立访客'],
            ['触发访问', readable(q.data?.data?.visits), '当前期间'],
            ['事件种类', readable(q.data?.data?.uniqueEvents), '当前期间'],
          ]}
        />
      </QueryState>
    );
  if (['WebsiteChart', 'WebsiteMetricsBar'].includes(component.type))
    return (
      <ResourceAnalytics
        id={id}
        kind={kind}
        title=""
        chartEnabled={component.type !== 'WebsiteMetricsBar'}
        metrics={component.type === 'WebsiteMetricsBar'}
        request={request}
        range={range}
      />
    );
  if (table || events)
    return (
      <QueryState query={q}>
        {events ? (
          <Chart {...eventChartData(rowsOf<any>(q.data))} type="line" />
        ) : component?.props?.liekanDisplay === 'bar' ? (
          <Chart
            type="bar"
            option={{
              grid: { left: 96, right: 56, top: 34, bottom: 26 },
              xAxis: {
                type: 'value',
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { fontSize: 10, color: '#9AA3B2' },
                splitLine: { lineStyle: { color: '#E9ECF1' } },
              },
              yAxis: {
                type: 'category',
                data: rowsOf<any>(q.data)
                  .map(row => row.utm ?? row.x ?? '直接访问')
                  .reverse(),
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { fontSize: 11, color: '#697386' },
              },
              series: [
                {
                  name: '独立访客',
                  type: 'bar',
                  data: rowsOf<any>(q.data)
                    .map(row => nativeMetric(row.views ?? row.y))
                    .reverse(),
                  barWidth: 14,
                  itemStyle: { borderRadius: [0, 3, 3, 0] },
                  label: { show: true, position: 'right', fontSize: 11, color: '#697386' },
                },
              ],
            }}
          />
        ) : (
          <Table
            columns={[
              component.type === 'WorldMap'
                ? '国家 / 地区'
                : component.type === 'UTM'
                  ? 'UTM 来源'
                  : '访问维度',
              '访客',
            ]}
            rows={rowsOf<any>(q.data).map(row => [
              row.utm ?? row.x ?? '直接访问',
              readable(row.views ?? row.y),
            ])}
            numeric={[1]}
          />
        )}
      </QueryState>
    );
  return (
    <Body>
      <Notice tone="amber">
        此看板组件「{component.type}」的统计展示尚未接入新界面。现有配置会保留。
      </Notice>
    </Body>
  );
}
function BoardCanvas({
  board,
  editing = false,
  request,
  range,
}: {
  board: any;
  editing?: boolean;
  request?: any;
  range?: any;
}) {
  const c = useFeature(),
    action = useAction(),
    [parameters, setParameters] = useState<WorkspaceParameters>(board.parameters || {}),
    [drawer, setDrawer] = useState<any>(null),
    [drag, setDrag] = useState(''),
    [confirm, setConfirm] = useState('');
  useEffect(() => setParameters(board.parameters || {}), [board]);
  const allowed = !request && canManageResource(c?.user, board, c?.teams),
    entries = boardColumns(parameters),
    entity = boardEntity(parameters, board.type);
  const add = (component: WorkspaceComponent, full: boolean, column?: any) => {
    if (column) {
      setParameters(current => {
        const updated = updateBoardColumn(current, column.id, { component });
        const entry = boardColumns(updated).find(item => item.column.id === column.id);
        const currentFull = entry?.row.columns.length === 1 && (entry.column.size ?? 100) > 50;
        return currentFull === full ? updated : setBoardColumnWidth(updated, column.id, full, uid);
      });
      return;
    }
    setParameters(current => {
      const rows = [...(current.rows || [])],
        newColumn = { id: uid(), size: full ? 100 : 50, component };
      const index = !full
        ? rows.findIndex(row => row.columns.length === 1 && (row.columns[0].size ?? 100) <= 50)
        : -1;
      if (index >= 0)
        rows[index] = { ...rows[index], columns: [...rows[index].columns, newColumn] };
      else rows.push({ id: uid(), columns: [newColumn] });
      return { ...current, rows };
    });
  };
  return (
    <>
      <div className="row between">
        <div>
          <h2>{board.name}</h2>
          <p className="muted">{board.description || '图表顺序与布局宽度均可调整。'}</p>
        </div>
        {!request && (
          <div className="actions">
            {editing ? (
              <>
                <Button disabled={!allowed || action.busy} onClick={() => setDrawer({})}>
                  <Icon name="plus" />
                  添加组件
                </Button>
                <Button
                  primary
                  disabled={!allowed || action.busy}
                  onClick={() =>
                    action.run(
                      () =>
                        c.api.post(`/boards/${board.id}`, {
                          parameters: boardParameters(
                            parameters,
                            board.type,
                            entity.entityId,
                            board.type,
                          ),
                        }),
                      '编排已保存',
                    )
                  }
                >
                  {action.busy ? '保存中…' : '保存编排'}
                </Button>
                <LinkButton page="board-view" params={{ id: board.id }}>
                  预览
                </LinkButton>
              </>
            ) : (
              <>
                <LinkButton page="board-editor" params={{ id: board.id }}>
                  基本信息
                </LinkButton>
                <LinkButton page="board-design" params={{ id: board.id }}>
                  编排
                </LinkButton>
                <LinkButton
                  page="sharing"
                  params={{ id: board.id, teamId: board.teamId || '', resource: 'board' }}
                >
                  分享
                </LinkButton>
                {allowed && (
                  <>
                    <Button
                      disabled={action.busy}
                      onClick={async () => {
                        const result = await action.run(
                          () =>
                            c.api.post(`/boards/${board.id}/clone`, {
                              name: `${board.name}（副本）`,
                            }),
                          '看板已复制',
                        );
                        c.navigate('board-editor', { id: result.id });
                      }}
                    >
                      复制
                    </Button>
                    <Button danger disabled={action.busy} onClick={() => setConfirm('delete')}>
                      删除
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {editing && !allowed && <ReadOnly />}
      {!editing && entity.entityId && (
        <ResourceAnalytics
          id={entity.entityId}
          kind={entity.entityType}
          variant="board"
          allowGoals={board._shareGoalsAllowed !== false}
          request={request}
          range={range}
        />
      )}
      {entries.length ? (
        <div className="stack">
          {(parameters.rows || []).map(row => (
            <div
              className="board-grid"
              key={row.id}
              style={
                {
                  '--board-columns':
                    row.columns.length === 1
                      ? 'repeat(2,minmax(0,1fr))'
                      : row.columns.map(column => `minmax(0,${column.size || 1}fr)`).join(' '),
                } as CSSProperties
              }
            >
              {row.columns.map(column => {
                const index = entries.findIndex(entry => entry.column.id === column.id),
                  full = row.columns.length === 1 && (column.size ?? 100) > 50;
                return (
                  <section
                    key={column.id}
                    className={`panel board-widget${full ? ' full' : ''}`}
                    style={{ gridColumn: full ? '1 / -1' : undefined }}
                    draggable={editing && allowed && !action.busy}
                    onDragStart={e => {
                      setDrag(column.id);
                      e.dataTransfer.setData('text/plain', column.id);
                    }}
                    onDragOver={e => {
                      if (editing && allowed && !action.busy) e.preventDefault();
                    }}
                    onDrop={e => {
                      e.preventDefault();
                      if (editing && allowed && !action.busy)
                        setParameters(current =>
                          moveBoardColumn(
                            current,
                            e.dataTransfer.getData('text/plain') || drag,
                            column.id,
                          ),
                        );
                      setDrag('');
                    }}
                  >
                    {editing ? (
                      <div className="widget-tools">
                        <strong>{column.component?.title || '未命名组件'}</strong>
                        <div className="actions" style={{ marginLeft: 'auto' }}>
                          <Button
                            disabled={!allowed || action.busy || index === 0}
                            onClick={() =>
                              setParameters(current =>
                                moveBoardColumn(current, column.id, entries[index - 1].column.id),
                              )
                            }
                          >
                            上移
                          </Button>
                          <Button
                            disabled={!allowed || action.busy}
                            onClick={() =>
                              setParameters(current =>
                                setBoardColumnWidth(current, column.id, !full, uid),
                              )
                            }
                          >
                            {full ? '半宽' : '全宽'}
                          </Button>
                          <Button
                            disabled={!allowed || action.busy}
                            onClick={() => setDrawer({ column })}
                          >
                            编辑
                          </Button>
                          <Button
                            disabled={!allowed || action.busy}
                            aria-label={`移除组件 ${column.component?.title || ''}`}
                            onClick={() =>
                              setParameters(current => removeBoardColumn(current, column.id))
                            }
                          >
                            <Icon name="close" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="panel-head">
                        <h2>{column.component?.title || '统计组件'}</h2>
                      </div>
                    )}
                    <NativeWidget
                      board={{ ...board, parameters }}
                      component={column.component}
                      request={request}
                      range={range}
                    />
                  </section>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <Notice>尚未添加看板组件。</Notice>
      )}
      {editing && <Notice>保存后，图表顺序、组件配置和布局宽度会写入看板。</Notice>}
      {drawer && (
        <WidgetDrawer
          board={{ ...board, parameters }}
          column={drawer.column}
          onClose={() => setDrawer(null)}
          onSave={(component, full) => add(component, full, drawer.column)}
        />
      )}
      {confirm && (
        <Confirm
          title="删除看板"
          onClose={() => setConfirm('')}
          onConfirm={async () => {
            await c.api.del(`/boards/${board.id}`);
            c.navigate('boards');
          }}
        >
          看板及其分享链接会被删除，原始资源数据继续保留。
        </Confirm>
      )}
    </>
  );
}
function BoardPage({ page }: { page: string }) {
  const c = useFeature(),
    id = c.route.id,
    q = useData(
      ['board-record', id],
      signal => c.api.get(`/boards/${id}`, undefined, signal),
      !!id,
    );
  useResourceContext(q.data);
  if (!id)
    return page === 'board-editor' ? (
      <BoardEditor />
    ) : (
      <Notice>
        请选择一个看板。<LinkButton page="boards">看板列表</LinkButton>
      </Notice>
    );
  return (
    <QueryState query={q}>
      {q.data &&
        (page === 'board-editor' ? (
          <BoardEditor key={id} board={q.data} />
        ) : (
          <BoardCanvas board={q.data} editing={page === 'board-design'} />
        ))}
    </QueryState>
  );
}

function dashboardIds(board: any, sites: FeatureEntity[]) {
  const configured = board?.parameters?.liekan?.siteIds;
  if (Array.isArray(configured))
    return configured.filter((id: string) => sites.some(site => site.id === id));
  const native = boardColumns(board?.parameters)
    .map(({ column }) => column.component?.entityId || column.component?.websiteId)
    .filter(Boolean);
  return native.length
    ? [...new Set(native)].filter(id => sites.some(site => site.id === id))
    : sites.map(site => site.id);
}
function DashboardEdit({ board }: { board: any }) {
  const c = useFeature(),
    action = useAction(),
    [ids, setIds] = useState<string[]>(dashboardIds(board, c.sites));
  return (
    <Panel title="工作台布局" subtitle="选择要固定的网站，使用按钮调整次序。">
      <Body>
        <Form
          busy={action.busy}
          submitLabel="保存工作台"
          cancel={<LinkButton page="dashboard">取消</LinkButton>}
          onSubmit={async (values: any) => {
            const existing: WorkspaceParameters = board?.parameters || {},
              liekan = {
                ...existing.liekan,
                siteIds: ids,
                showAI: values.showAI === 'on',
                showCompare: values.showCompare === 'on',
              };
            await action.run(
              () =>
                c.api.post('/dashboard', {
                  name: board?.name || '工作台',
                  description: board?.description || '',
                  parameters: { ...existing, liekan },
                }),
              '工作台已保存',
            );
            c.navigate('dashboard');
          }}
        >
          {c.sites.map(site => (
            <div className="switch-row" key={site.id}>
              <Check
                checked={ids.includes(site.id)}
                onChange={e =>
                  setIds(current =>
                    e.target.checked ? [...current, site.id] : current.filter(id => id !== site.id),
                  )
                }
              >
                <strong>{site.name}</strong>
                <small style={{ display: 'block' }}>{site.domain}</small>
              </Check>
            </div>
          ))}
          <div className="condition-group">
            <h3 style={{ marginBottom: 12 }}>当前顺序</h3>
            {ids.map((id, index) => (
              <div className="row between" style={{ margin: '8px 0' }} key={id}>
                <span>
                  {index + 1}. {c.sites.find(site => site.id === id)?.name}
                </span>
                <Button
                  disabled={index === 0}
                  onClick={() =>
                    setIds(current => {
                      const next = [...current];
                      [next[index - 1], next[index]] = [next[index], next[index - 1]];
                      return next;
                    })
                  }
                >
                  上移
                </Button>
              </div>
            ))}
          </div>
          <Check name="showAI" defaultChecked={board?.parameters?.liekan?.showAI !== false}>
            显示 AI 引荐访客摘要
          </Check>
          <Check
            name="showCompare"
            defaultChecked={board?.parameters?.liekan?.showCompare !== false}
          >
            显示前期对比
          </Check>
        </Form>
      </Body>
    </Panel>
  );
}
function Dashboard({ editing = false }: { editing?: boolean }) {
  const c = useFeature(),
    q = useData('dashboard-record', signal => c.api.get('/dashboard', undefined, signal));
  const ids = dashboardIds(q.data, c.sites),
    settings = q.data?.parameters?.liekan;
  const stats = useData(
    ['dashboard-stats', ids, settings?.showAI],
    async signal => {
      const summaries = await getFeatureWebsiteSummary(ids, c.range, signal, c.api.get);
      const failed = summaries.find(row => row.error);
      if (failed) throw failed.error;
      return Promise.all(
        summaries.map(async value => {
          const aiStats =
            settings?.showAI === false
              ? null
              : await c.api.get(
                  `/websites/${value.id}/stats`,
                  { ...c.range, ...c.filters, drill_channel: 'eq.AI 搜索引荐' },
                  signal,
                );
          return { ...value, ai: nativeMetric(aiStats?.visitors) };
        }),
      );
    },
    !editing && !q.isPending && !q.error,
  );
  const sum = (key: string) =>
    stats.data?.every((row: any) => nativeMetric(row[key]) != null)
      ? stats.data.reduce((total: number, row: any) => total + nativeMetric(row[key]), 0)
      : null;
  const change = (key: string) => {
    if (settings?.showCompare === false || !stats.data) return '当前期间';
    const current = sum(key),
      previous = stats.data.every((row: any) => nativeMetric(row.comparison?.[key]) != null)
        ? stats.data.reduce(
            (total: number, row: any) => total + nativeMetric(row.comparison[key]),
            0,
          )
        : null;
    return previous == null || current == null
      ? '前期数据未提供'
      : `前期 ${numberLabel(previous)} · 变化 ${numberLabel(current - previous)}`;
  };
  return (
    <QueryState query={q}>
      {editing ? (
        <QueryState query={{ isPending: !!c.sitesLoading }}>
          <DashboardEdit key={q.data?.updatedAt || 'new'} board={q.data} />
        </QueryState>
      ) : (
        <>
          <QueryState query={stats}>
            <Metrics
              loading={stats.isPending}
              items={[
                [
                  '全部网站访客',
                  readable(sum('visitors')),
                  `所选 ${ids.length} 个网站 · ${change('visitors')}`,
                ],
                ['页面访问', readable(sum('pageviews')), change('pageviews')],
                [
                  'AI 引荐访客',
                  settings?.showAI === false ? '已隐藏' : readable(sum('ai')),
                  '按网站累计，跨网站不去重',
                ],
                ['管理空间', c.route.teamId ? '团队' : '个人 / 团队', '跨网站快速访问'],
              ]}
            />
          </QueryState>
          <div className="row between">
            <StaticHeading>固定的网站</StaticHeading>
            <LinkButton page="dashboard-edit">编辑工作台</LinkButton>
          </div>
          {ids.length ? (
            <div className="two">
              {ids.map(id => (
                <Panel
                  key={id}
                  title={c.sites.find(site => site.id === id)?.name || id}
                  actions={
                    <>
                      <LinkButton page="overview" params={{ websiteId: id }}>
                        查看统计
                      </LinkButton>
                      <LinkButton page="website-settings" params={{ websiteId: id }}>
                        网站设置
                      </LinkButton>
                    </>
                  }
                >
                  <ResourceAnalytics id={id} metrics={false} title="" />
                </Panel>
              ))}
            </div>
          ) : (
            <Notice>尚未固定网站。可以在编辑工作台中选择可访问的网站。</Notice>
          )}
          <Panel title="快速入口" subtitle="从工作台进入常用管理与分析。">
            <Body>
              <div className="row">
                <LinkButton page="websites">管理网站</LinkButton>
                <LinkButton page="boards">自定义看板</LinkButton>
                <LinkButton page="realtime">实时访客</LinkButton>
                <LinkButton page="exports">完整导出</LinkButton>
              </div>
            </Body>
          </Panel>
        </>
      )}
    </QueryState>
  );
}

export function ShareDrawer({
  share,
  entity,
  onClose,
}: {
  share?: any;
  entity?: FeatureEntity & { kind?: string };
  onClose: () => void;
}) {
  const c = useFeature(),
    action = useAction(),
    entities = useWorkspaceEntities(),
    [kind, setKind] = useState(
      entity?.kind ||
        Object.keys(shareTypes).find(key => shareTypes[key] === share?.shareType) ||
        'website',
    );
  const parameters = share?.parameters || {},
    permitted = entity ? canManageResource(c.user, entity, c.teams) : true;
  return (
    <LiekanDialog
      title={share ? '编辑分享链接' : '创建分享链接'}
      subtitle="设置分享资源、统计页面范围与访问保护。"
      className="share-dialog"
      onClose={() => !action.busy && onClose()}
    >
      <QueryState query={entities}>
        <Form
          busy={action.busy}
          disabled={!permitted}
          submitLabel={share ? '保存分享链接' : '创建分享链接'}
          cancel={
            <Button disabled={action.busy} onClick={onClose}>
              取消
            </Button>
          }
          onSubmit={async (values: any) => {
            const id = share?.entityId || entity?.id || values.entityId;
            if (!id) throw new Error('请选择分享资源');
            const selected =
              entity || entities.data?.[kind]?.find((resource: any) => resource.id === id);
            if (selected && !canManageResource(c.user, selected, c.teams))
              throw new Error('此资源需要管理权限');
            if (values.password && new TextEncoder().encode(String(values.password)).length > 72)
              throw new Error('密码最多 72 个 UTF-8 字节');
            const body = { name: values.name, parameters: shareParameters(values, parameters) };
            await action.run(
              () =>
                c.api.post(
                  share ? `/share/id/${share.id}` : '/share',
                  share
                    ? { ...body, slug: share.slug }
                    : { ...body, entityId: id, shareType: shareTypes[kind] },
                ),
              '分享链接已保存',
            );
            onClose();
          }}
        >
          <div className="share-settings-grid">
            <div className="share-settings-column">
              <section className="share-settings-section">
                <div className="share-section-heading">
                  <h3>基本信息</h3>
                  <p className="muted">选择要分享的资源，方便访客识别。</p>
                </div>
                <Field
                  label="分享名称"
                  name="name"
                  defaultValue={share?.name || entity?.name || ''}
                  required
                  maxLength={200}
                />
                <Select
                  label="分享类型"
                  value={kind}
                  onChange={e => setKind(e.target.value)}
                  disabled={!!share || !!entity}
                  options={Object.keys(shareTypes).map(key => [key, labels[key]])}
                />
                {!share && !entity ? (
                  <Select
                    key={kind}
                    label="关联资源"
                    name="entityId"
                    required
                    options={[
                      ['', '请选择资源'],
                      ...(entities.data?.[kind] || [])
                        .filter((resource: any) => canManageResource(c.user, resource, c.teams))
                        .map((resource: any) => [resource.id, resource.name]),
                    ]}
                  />
                ) : (
                  <Field
                    label="关联资源"
                    readOnly
                    value={
                      entity?.name ||
                      entities.data?.[kind]?.find(
                        (resource: any) => resource.id === share?.entityId,
                      )?.name ||
                      share?.entityId ||
                      ''
                    }
                  />
                )}
              </section>
              <section className="share-settings-section">
                <div className="share-section-heading">
                  <h3>访问保护</h3>
                  <p className="muted">按需设置密码，控制分享页面的访问。</p>
                </div>
                <Field
                  label={parameters.hasPassword ? '修改分享密码（可选）' : '分享密码（可选）'}
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  help={
                    parameters.hasPassword
                      ? '留空保留当前密码。修改后访客需要重新验证。'
                      : '设置后访客需要输入密码。'
                  }
                />
                {parameters.hasPassword && <Check name="removePassword">取消密码保护</Check>}
              </section>
            </div>
            <div className="share-settings-column">
              <section className="share-settings-section">
                <div className="share-section-heading">
                  <h3>统计页面范围</h3>
                  <p className="muted">访客只能查看已勾选的统计页面。</p>
                </div>
                <div className="share-page-options">
                  {shareSections.map(([key, label]) => (
                    <Check
                      key={key}
                      name={key}
                      defaultChecked={
                        typeof parameters[key] === 'boolean'
                          ? parameters[key]
                          : ['overview', 'events'].includes(key)
                      }
                    >
                      {label}
                    </Check>
                  ))}
                </div>
              </section>
              <section className="share-settings-section">
                <div className="share-section-heading">
                  <h3>浏览设置</h3>
                </div>
                <Switch
                  name="allowFilter"
                  label="允许访客调整筛选"
                  help="访客可在分享范围内调整统计条件。"
                  defaultChecked={parameters.allowFilter !== false}
                />
                <Select
                  label="主题"
                  name="theme"
                  defaultValue="light"
                  help="分享页面当前使用浅色主题。"
                  options={[
                    { value: 'light', label: '浅色' },
                    { value: 'dark', label: '深色（暂不支持）', disabled: true },
                    { value: 'system', label: '跟随系统（暂不支持）', disabled: true },
                  ]}
                />
              </section>
            </div>
          </div>
        </Form>
      </QueryState>
    </LiekanDialog>
  );
}
export function WebsiteSharing() {
  const c = useFeature();
  return (
    <FeatureProvider
      value={{ ...c, route: { ...c.route, page: 'sharing', context: 'website', id: undefined } }}
    >
      <Sharing />
    </FeatureProvider>
  );
}
function Sharing() {
  const c = useFeature(),
    entities = useWorkspaceEntities(),
    action = useAction(),
    [edit, setEdit] = useState<any>(undefined),
    [search, setSearch] = useListState('search', ''),
    [page, setPage] = useListState('page', 1);
  const q = useData(
    ['shares', entities.data],
    async signal => {
      const resources = Object.entries(entities.data || {}).flatMap(([kind, rows]: any) =>
        rows.map((entity: any) => ({ ...entity, kind })),
      );
      const shares = await Promise.all(
        resources.map(async entity => {
          const rows = await getAllFeatureRows<any>(
            `/${entity.kind === 'website' ? 'websites' : entity.kind === 'board' ? 'boards' : entity.kind === 'link' ? 'links' : 'pixels'}/${entity.id}/shares`,
            {},
            signal,
          );
          return rows.map(share => ({ ...share, entity }));
        }),
      );
      return shares.flat();
    },
    !!entities.data,
  );
  const allEntities = Object.entries(entities.data || {}).flatMap(([kind, rows]: any) =>
    rows.map((entity: any) => ({ ...entity, kind })),
  );
  const selectedEntity =
    c.route.context === 'website' ? c.site : allEntities.find(entity => entity.id === c.route.id);
  const creatable = selectedEntity
    ? canManageResource(c.user, selectedEntity, c.teams)
    : allEntities.some(entity => canManageResource(c.user, entity, c.teams));
  const filtered = (q.data || []).filter(
      (share: any) =>
        (!c.route.id || share.entity?.id === c.route.id) &&
        (!search ||
          `${share.name} ${share.entity?.name}`.toLowerCase().includes(search.toLowerCase())),
    ),
    rows = filtered.slice((page - 1) * 20, page * 20);
  return (
    <>
      <Panel
        title={c.route.context === 'website' ? '当前网站的分享链接' : '分享链接'}
        subtitle={
          c.route.context === 'website'
            ? `${c.site?.name || '当前网站'} · 仅管理此网站的分享链接。`
            : '网站、看板、链接和像素的分享范围与访问保护。'
        }
        actions={
          <>
            <Search
              value={search}
              onChange={value => {
                setSearch(value);
                setPage(1);
              }}
            />
            <Button primary disabled={!creatable} onClick={() => setEdit(null)}>
              <Icon name="plus" />
              创建分享链接
            </Button>
          </>
        }
      >
        <QueryState query={entities}>
          <QueryState query={q}>
            <Table
              mobile
              rowKeys={rows.map((share: any) => share.id)}
              columns={['名称', '资源类型', '页面范围', '筛选权限', '状态', '操作', '分享链接']}
              rows={rows.map((share: any) => [
                <div key="share-name">
                  {share.name}
                  <div className="muted">
                    {share.entity.name} ·{' '}
                    {share.entity.teamId
                      ? c.teams.find(team => team.id === share.entity.teamId)?.name || '团队空间'
                      : '个人空间'}
                  </div>
                </div>,
                labels[share.entity.kind],
                allowedShareSections(share.parameters)
                  .map(([, label]) => label)
                  .join('、') || '无统计页面',
                share.parameters?.allowFilter === false ? '禁止' : '允许',
                <Badge
                  key="cell-badge-21"
                  tone={share.parameters?.enabled === false ? 'gray' : 'green'}
                >
                  {share.parameters?.enabled === false ? '停用' : '启用'}
                </Badge>,
                <div key="cell-div-22" className="actions">
                  <LinkButton page="share-preview" params={{ id: share.id, slug: share.slug }}>
                    预览
                  </LinkButton>
                  <Button
                    disabled={action.busy || !canManageResource(c.user, share.entity, c.teams)}
                    onClick={() => setEdit(share)}
                  >
                    编辑
                  </Button>
                  <Button
                    disabled={action.busy || !canManageResource(c.user, share.entity, c.teams)}
                    onClick={() =>
                      action.run(
                        () =>
                          c.api.post(`/share/id/${share.id}`, {
                            name: share.name,
                            slug: share.slug,
                            parameters: {
                              ...share.parameters,
                              enabled: share.parameters?.enabled === false,
                            },
                          }),
                        '分享状态已更新',
                      )
                    }
                  >
                    {share.parameters?.enabled === false ? '启用' : '停用'}
                  </Button>
                </div>,
                share.slug ? (
                  <a
                    key="share-visit"
                    className="btn share-visit"
                    href={`${process.env.basePath || ''}/share/${encodeURIComponent(share.slug)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`访问分享链接：${share.name}（新标签页）`}
                  >
                    访问分享链接
                    <Icon name="external" />
                  </a>
                ) : (
                  <span key="share-unavailable" className="muted">
                    链接未生成
                  </span>
                ),
              ])}
              page={page}
              pages={Math.max(1, Math.ceil(filtered.length / 20))}
              onPage={setPage}
            />
          </QueryState>
        </QueryState>
      </Panel>
      <Notice>公开视角只显示分享配置允许的统计页面。</Notice>
      {edit !== undefined && (
        <ShareDrawer
          share={edit || undefined}
          entity={edit?.entity || selectedEntity}
          onClose={() => setEdit(undefined)}
        />
      )}
    </>
  );
}

async function allSharedRows(
  request: (path: string, params?: any, signal?: AbortSignal) => Promise<any>,
  path: string,
  signal?: AbortSignal,
) {
  const rows: any[] = [];
  for (let page = 1; page <= 1000; page++) {
    const data = await request(path, { page, pageSize: 100 }, signal);
    if (Array.isArray(data)) return data;
    const next = rowsOf<any>(data);
    rows.push(...next);
    if (
      !next.length ||
      rows.length >= Number(data?.count ?? Infinity) ||
      (!data?.count && next.length < 100)
    )
      return rows;
  }
  throw new Error('配置数量超过可加载范围，请缩小范围');
}
function PublicStats({
  share,
  active,
  range,
  filters,
  dateControls,
  onExpired,
}: {
  share: any;
  active: string;
  range: any;
  filters: any;
  dateControls?: ReactNode;
  onExpired: () => void;
}) {
  const id =
      share.websiteId ||
      share.linkId ||
      share.pixelId ||
      share.websiteIds?.[0] ||
      share.linkIds?.[0] ||
      share.pixelIds?.[0],
    kind = share.linkId ? 'link' : share.pixelId ? 'pixel' : 'website';
  const request = Object.assign(
    (path: string, params: any, signal?: AbortSignal) =>
      featureRequest('GET', path, params, signal, share.token, '').catch(error => {
        if ([401, 403, 404].includes(error.status)) onExpired();
        throw error;
      }),
    { shareToken: share.token },
  );
  const safeBoard = (board: any) => {
    const parameters: WorkspaceParameters = board.parameters || {},
      fixed = boardEntity(parameters, board.type);
    const allowedIds = new Set(
      [
        share.websiteId,
        share.linkId,
        share.pixelId,
        ...(share.websiteIds || []),
        ...(share.linkIds || []),
        ...(share.pixelIds || []),
      ].filter(Boolean),
    );
    const componentSection = (component: any) =>
      ['EventsChart', 'EventsMetricsBar'].includes(component?.type)
        ? 'events'
        : component?.type === 'Goal'
          ? 'goals'
          : component?.type === 'Funnel'
            ? 'funnels'
            : component?.type === 'UTM'
              ? 'utm'
              : 'overview';
    if (fixed.entityId && !allowedIds.has(fixed.entityId))
      return { ...board, parameters: { ...boardParameters(parameters, 'mixed'), rows: [] } };
    return {
      ...board,
      parameters: {
        ...parameters,
        rows: (parameters.rows || [])
          .map(row => ({
            ...row,
            columns: row.columns.filter(column => {
              const component = column.component,
                entityId = fixed.entityId || component?.entityId || component?.websiteId;
              return (
                hasShareSection(share.parameters, componentSection(component)) &&
                (!entityId || allowedIds.has(entityId))
              );
            }),
          }))
          .filter(row => row.columns.length),
      },
    };
  };
  const q = useQuery({
    queryKey: ['liekan-public', share.token, active, id, range, filters],
    queryFn: async ({ signal }) => {
      if (active === 'events')
        return request(
          `/websites/${id}/events/series`,
          { ...range, ...filters, limit: 100 },
          signal,
        );
      if (active === 'utm')
        return request(
          `/websites/${id}/utm/metrics`,
          { ...range, ...filters, type: 'utm_source' },
          signal,
        );
      if (active === 'goals') {
        const [goals, funnels] = await Promise.all([
          hasShareSection(share.parameters, 'goals')
            ? allSharedRows(request, `/websites/${id}/goals`, signal)
            : null,
          hasShareSection(share.parameters, 'funnels')
            ? allSharedRows(request, `/websites/${id}/funnels`, signal)
            : null,
        ]);
        const results = await Promise.all([
          ...rowsOf<any>(goals).map(async row => ({
            kind: '目标',
            ...row,
            stats: await request(
              `/websites/${id}/goals/${row.id}/stats`,
              { ...range, ...filters },
              signal,
            ),
          })),
          ...rowsOf<any>(funnels).map(async row => ({
            kind: '漏斗',
            ...row,
            stats: await request(
              `/websites/${id}/funnels/${row.id}/stats`,
              { ...range, ...filters },
              signal,
            ),
          })),
        ]);
        return { results };
      }
      if (share.boardId) return request(`/boards/${share.boardId}`, undefined, signal);
      return null;
    },
    enabled: (!!id && active !== 'overview') || (active === 'overview' && !!share.boardId),
    retry: false,
  });
  if (!id && !share.boardId) return <Notice>分享资源尚未提供统计数据。</Notice>;
  if (active === 'overview' && share.websiteId && !share.boardId && !share.linkId && !share.pixelId)
    return (
      <SharedWebsiteOverview
        id={id}
        token={share.token}
        range={range}
        request={request}
        dateControls={dateControls}
      />
    );
  if (active === 'overview' && !share.boardId)
    return (
      <ResourceAnalytics
        id={id}
        kind={kind}
        variant="public"
        allowGoals={hasShareSection(share.parameters, 'goals')}
        request={request}
        range={range}
        filters={filters}
      />
    );
  return (
    <QueryState query={q}>
      {active === 'overview' ? (
        q.data && (
          <BoardCanvas
            board={{
              ...safeBoard(q.data),
              _shareGoalsAllowed: hasShareSection(share.parameters, 'goals'),
            }}
            request={request}
            range={{ ...range, ...filters }}
          />
        )
      ) : active === 'goals' ? (
        <>
          <Chart
            title="目标转化"
            labels={(q.data?.results?.find((r: any) => r.kind === '目标')?.stats?.series || []).map(
              (r: any) => r.x,
            )}
            series={[
              {
                name: '转化次数',
                values: (
                  q.data?.results?.find((r: any) => r.kind === '目标')?.stats?.series || []
                ).map((r: any) => Number(r.y)),
              },
            ]}
          />
          <Panel title="目标与漏斗" subtitle="分享允许的已保存配置与转化访客。">
            <Table
              columns={['类型', '名称', '转化访客', '转化率']}
              numeric={[2, 3]}
              rows={(q.data?.results || []).map(row => {
                const first =
                    row.kind === '目标'
                      ? nativeMetric(row.stats?.total)
                      : nativeMetric(row.stats?.[0]?.visitors),
                  last =
                    row.kind === '目标'
                      ? nativeMetric(row.stats?.num)
                      : nativeMetric(row.stats?.at(-1)?.visitors);
                return [
                  row.kind,
                  row.name,
                  readable(last),
                  first != null && last != null && first > 0
                    ? `${((last / first) * 100).toFixed(2)}%`
                    : first === 0
                      ? '无入组访客'
                      : '未提供',
                ];
              })}
            />
          </Panel>
        </>
      ) : active === 'events' ? (
        <Chart title="事件趋势" type="line" {...eventChartData(rowsOf<any>(q.data))} />
      ) : (
        <Chart
          title="UTM 来源"
          type="bar"
          horizontal
          labels={rowsOf<any>(q.data).map(row => row.utm || '未提供')}
          series={[
            { name: '页面访问', values: rowsOf<any>(q.data).map(row => nativeMetric(row.views)) },
          ]}
        />
      )}
    </QueryState>
  );
}
export function ShareFeatureView({
  slug,
  initialPage = 'overview',
}: {
  slug: string;
  initialPage?: string;
}) {
  const verification = useRef<{ slug: string; controller?: AbortController }>({ slug });
  verification.current.slug = slug;
  const [verified, setVerified] = useState<any>(null),
    [passwordError, setPasswordError] = useState(''),
    [busy, setBusy] = useState(false),
    [active, setActive] = useState(initialPage),
    [filters, setFilters] = useState<any>({});
  const [range, setRange] = useState(() => sharedDateRange());
  const q = useQuery({
    queryKey: ['liekan-public-share', slug],
    queryFn: ({ signal }) =>
      featureRequest('GET', `/share/${encodeURIComponent(slug)}`, undefined, signal, undefined, ''),
    retry: false,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    verification.current.controller?.abort();
    setBusy(false);
    setVerified(null);
    setPasswordError('');
    setFilters({});
    setActive(initialPage);
  }, [slug, initialPage]);
  useEffect(() => () => verification.current.controller?.abort(), []);
  // Every data request revalidates a former token; an expired proof returns the password form.
  useEffect(() => {
    if (q.error) setVerified(null);
  }, [q.error]);
  const share = verified || q.data,
    allowed = allowedShareSections(share?.parameters),
    selected = allowed.some(([id]) => id === active) ? active : allowed[0]?.[0];
  const websiteOverview =
    selected === 'overview' &&
    !!share?.websiteId &&
    !share.boardId &&
    !share.linkId &&
    !share.pixelId;
  const dateControls = share?.token && share.parameters?.allowFilter !== false && (
    <div className={sharedStyles.filters}>
      <div className="actions" aria-label="快捷日期范围">
        {(
          [
            ['30 天', 30],
            ['7 天', 7],
            ['24h', 1],
          ] as const
        ).map(([label, days]) => (
          <Button
            key={label}
            primary={Math.abs(range.endAt - range.startAt - days * 86400000) < 1000}
            aria-pressed={Math.abs(range.endAt - range.startAt - days * 86400000) < 1000}
            onClick={() => setRange(sharedDateRange(days))}
          >
            {label}
          </Button>
        ))}
      </div>
      <Field
        label="开始日期"
        type="date"
        value={formatInTimeZone(range.startAt, range.timezone, 'yyyy-MM-dd')}
        onChange={e => {
          const time = +fromZonedTime(`${e.target.value}T00:00:00`, range.timezone);
          if (Number.isFinite(time)) setRange(current => ({ ...current, startAt: time }));
        }}
      />
      <Field
        label="结束日期"
        type="date"
        value={formatInTimeZone(range.endAt, range.timezone, 'yyyy-MM-dd')}
        onChange={e => {
          const time = +fromZonedTime(`${e.target.value}T23:59:59.999`, range.timezone);
          if (Number.isFinite(time)) setRange(current => ({ ...current, endAt: time }));
        }}
      />
      {!websiteOverview && (
        <Field
          label="页面路径"
          placeholder="输入路径筛选"
          value={filters.path?.slice(3) || ''}
          onChange={e => setFilters(e.target.value ? { path: `eq.${e.target.value}` } : {})}
        />
      )}
    </div>
  );
  const closed = q.error && (q.error as any).status === 404;
  return (
    <main className="public-shell" id="main-content" data-share-theme="light">
      <header className="public-head">
        <div className="public-brand">
          <img src={`${process.env.basePath || ''}/liekan/features/logo.svg`} alt="" />
          <div>
            <strong>猎看统计</strong>
            <small style={{ display: 'block' }}>{share?.name || '公开分享'} · 只读分享</small>
          </div>
        </div>
        <Badge>公开 · 只读</Badge>
      </header>
      <div className="public-body">
        {share?.parameters?.theme && share.parameters.theme !== 'light' && (
          <Notice tone="amber">
            {share.parameters.hasPassword
              ? '此密码保护分享当前使用浅色界面。'
              : '此分享原有主题需要兼容界面查看。当前预览使用浅色。'}
            {!share.parameters.hasPassword && (
              <a
                className="btn"
                href={`${process.env.basePath || ''}/share/${encodeURIComponent(slug)}?legacy=1`}
              >
                打开兼容界面
              </a>
            )}
          </Notice>
        )}
        {closed ? (
          <div className="state-box">
            <h2>分享已关闭</h2>
            <p>此链接目前无法查看数据，请联系分享创建者。</p>
          </div>
        ) : (
          <QueryState query={q}>
            {share?.requiresPassword && !verified ? (
              <Panel title="输入分享密码" subtitle="验证后查看允许的统计页面。">
                <Body>
                  <Form
                    busy={busy}
                    error={passwordError}
                    submitLabel="验证并查看"
                    onSubmit={async (values: any, form: HTMLFormElement) => {
                      const currentSlug = slug;
                      const controller = new AbortController();
                      verification.current.controller?.abort();
                      verification.current.controller = controller;
                      setBusy(true);
                      setPasswordError('');
                      try {
                        const result = await featureRequest(
                          'POST',
                          `/share/${encodeURIComponent(slug)}`,
                          { password: values.password },
                          controller.signal,
                          undefined,
                          '',
                        );
                        if (controller.signal.aborted || verification.current.slug !== currentSlug)
                          return;
                        setVerified(result);
                        form.reset();
                      } catch (e: any) {
                        if (controller.signal.aborted || verification.current.slug !== currentSlug)
                          return;
                        setPasswordError(e.message);
                        throw e;
                      } finally {
                        if (!controller.signal.aborted && verification.current.slug === currentSlug)
                          setBusy(false);
                      }
                    }}
                  >
                    <Field
                      label="分享密码"
                      name="password"
                      type="password"
                      required
                      autoComplete="current-password"
                    />
                  </Form>
                </Body>
              </Panel>
            ) : share?.token ? (
              <>
                {allowed.length > 1 && (
                  <Tabs items={allowed} active={selected || ''} onChange={setActive} />
                )}
                {!websiteOverview && dateControls}
                {selected ? (
                  <PublicStats
                    key={share.token}
                    share={share}
                    active={selected}
                    range={range}
                    filters={share.parameters?.allowFilter === false ? {} : filters}
                    dateControls={dateControls}
                    onExpired={() => {
                      setVerified(null);
                      void q.refetch();
                    }}
                  />
                ) : (
                  <Notice>此分享未开放统计页面。</Notice>
                )}
                <Button
                  onClick={async () => {
                    setVerified(null);
                    await q.refetch();
                  }}
                >
                  重新验证分享
                </Button>
              </>
            ) : (
              <Notice>分享数据未提供。</Notice>
            )}
          </QueryState>
        )}
      </div>
    </main>
  );
}
function SharePreview() {
  const c = useFeature(),
    q = useData(
      ['share-preview-record', c.route.id],
      signal => c.api.get(`/share/id/${c.route.id}`, undefined, signal),
      !!c.route.id,
    );
  const slug = c.query.slug || q.data?.slug;
  return slug ? (
    <ShareFeatureView slug={slug} />
  ) : (
    <QueryState query={q}>
      <Notice>
        请选择一个分享。<LinkButton page="sharing">分享管理</LinkButton>
      </Notice>
    </QueryState>
  );
}

export function WorkspacePages({ page }: { page: string }) {
  if (page === 'teams' || page === 'admin-teams') return <Teams admin={page === 'admin-teams'} />;
  if (page === 'team-detail') return <TeamDetail />;
  if (page === 'team-join') return <TeamJoin />;
  if (page === 'admin-users') return <AdminUsers />;
  if (page === 'admin-user') return <AdminUser />;
  if (page === 'admin-websites') return <AdminWebsites />;
  if (page === 'admin-security') return <AdminSecurity />;
  if (page === 'boards') return <Boards />;
  if (page.startsWith('board-')) return <BoardPage page={page} />;
  if (page === 'dashboard' || page === 'dashboard-edit')
    return <Dashboard editing={page === 'dashboard-edit'} />;
  if (page === 'sharing') return <Sharing />;
  if (page === 'share-preview') return <SharePreview />;
  return null;
}
