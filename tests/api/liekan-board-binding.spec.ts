import { getBoardEntityIds, getResolvedComponentEntity } from '../../src/lib/boards';
import { boardParameters } from '../../src/lib/liekan/contracts/workspace';
import { expect, test } from './fixtures';
import { SHARE_CONTEXT_HEADER, SHARE_TOKEN_HEADER } from './helpers/constants';
import { createWebsite, uniqueName } from './helpers/entities';

test('fixed-board rebinding revokes the former source and stays editable after its ownership changes', async ({
  user,
  admin,
  api,
  seed,
}) => {
  const sites: string[] = [];
  let boardId = '';
  let shareId = '';
  try {
    const a = await createWebsite(user);
    sites.push(a.id);
    const b = await createWebsite(user);
    sites.push(b.id);
    const created = await user.post('/api/boards', {
      name: uniqueName('binding-board'),
      description: '',
      type: 'website',
      parameters: {
        websiteId: a.id,
        extension: { retain: true },
        rows: [
          {
            id: 'row',
            columns: [
              {
                id: 'column',
                component: {
                  type: 'WebsiteChart',
                  title: 'Traffic',
                  entityType: 'website',
                  entityId: a.id,
                  websiteId: a.id,
                  props: { retain: true },
                },
              },
            ],
          },
        ],
      },
    });
    expect(created.status, created.text).toBe(200);
    boardId = created.body.id;
    const parameters = boardParameters(created.body.parameters, 'website', b.id, created.body.type);
    const rebound = await user.post(`/api/boards/${boardId}`, { type: 'website', parameters });
    expect(rebound.status, rebound.text).toBe(200);
    expect(getBoardEntityIds(rebound.body)).toEqual({
      websiteIds: [b.id],
      linkIds: [],
      pixelIds: [],
    });
    expect(rebound.body.parameters.rows).toHaveLength(1);
    expect(rebound.body.parameters.rows[0].columns[0].component.props).toEqual({ retain: true });

    const shared = await user.post(`/api/boards/${boardId}/shares`, {
      name: uniqueName('binding-share'),
      parameters: { overview: true },
    });
    expect(shared.status, shared.text).toBe(200);
    shareId = shared.body.id;
    const publicView = await api.get(`/api/share/${shared.body.slug}`);
    expect(publicView.status, publicView.text).toBe(200);
    expect(publicView.body.websiteIds).toEqual([b.id]);
    const visitor = api.with({
      [SHARE_TOKEN_HEADER]: publicView.body.token,
      [SHARE_CONTEXT_HEADER]: '1',
    });
    const range = { startAt: Date.now() - 60000, endAt: Date.now() };
    expect((await visitor.get(`/api/websites/${a.id}/stats`, { params: range })).status).toBe(401);
    expect((await visitor.get(`/api/websites/${b.id}/stats`, { params: range })).status).toBe(200);

    const transfer = await admin.post(`/api/websites/${a.id}/transfer`, { userId: seed.admin.id });
    expect(transfer.status, transfer.text).toBe(200);
    expect((await user.get(`/api/websites/${a.id}`)).status).toBe(401);
    const save = await user.post(`/api/boards/${boardId}`, {
      name: uniqueName('binding-renamed'),
      parameters: rebound.body.parameters,
    });
    expect(save.status, save.text).toBe(200);
    expect(getBoardEntityIds(save.body).websiteIds).toEqual([b.id]);
  } finally {
    if (shareId) await admin.del(`/api/share/id/${shareId}`);
    if (boardId) await admin.del(`/api/boards/${boardId}`);
    for (const id of sites) await admin.del(`/api/websites/${id}`);
  }
});

test('a raw upgraded fixed board narrows new and existing share tokens without rewriting its saved bindings', async ({
  user,
  admin,
  api,
  seed,
}) => {
  const sites: string[] = [];
  let boardId = '';
  let shareId = '';
  try {
    const a = await createWebsite(user);
    sites.push(a.id);
    const b = await createWebsite(user);
    sites.push(b.id);
    const rows = [
      {
        id: 'row',
        columns: [
          {
            id: 'former-source',
            component: {
              type: 'WebsiteChart',
              entityType: 'website',
              entityId: a.id,
              websiteId: a.id,
              props: { retain: true },
            },
          },
          {
            id: 'current-source',
            component: { type: 'WebsiteChart', entityType: 'website', entityId: b.id },
          },
        ],
      },
    ];
    const created = await user.post('/api/boards', {
      name: uniqueName('legacy-binding'),
      type: 'mixed',
      parameters: { rows },
    });
    expect(created.status, created.text).toBe(200);
    boardId = created.body.id;
    const shared = await user.post(`/api/boards/${boardId}/shares`, {
      name: uniqueName('legacy-share'),
      parameters: { overview: true },
    });
    expect(shared.status, shared.text).toBe(200);
    shareId = shared.body.id;
    const before = await api.get(`/api/share/${shared.body.slug}`);
    expect(before.status, before.text).toBe(200);
    expect(before.body.websiteIds).toEqual([a.id, b.id]);
    const previousVisitor = api.with({
      [SHARE_TOKEN_HEADER]: before.body.token,
      [SHARE_CONTEXT_HEADER]: '1',
    });
    const range = { startAt: Date.now() - 60000, endAt: Date.now() };
    expect(
      (await previousVisitor.get(`/api/websites/${a.id}/stats`, { params: range })).status,
    ).toBe(200);

    // This raw layout matches a 0.2.0 fixed board after its global source changed to B.
    const rawParameters = { websiteId: b.id, extension: { retain: true }, rows };
    const legacy = await user.post(`/api/boards/${boardId}`, {
      type: 'website',
      parameters: rawParameters,
    });
    expect(legacy.status, legacy.text).toBe(200);
    const native = await user.get(`/api/boards/${boardId}`);
    expect(native.status, native.text).toBe(200);
    expect(native.body.parameters).toEqual(rawParameters);
    expect(
      getResolvedComponentEntity(native.body, native.body.parameters.rows[0].columns[0].component),
    ).toEqual({
      entityType: 'website',
      entityId: b.id,
    });

    const after = await api.get(`/api/share/${shared.body.slug}`);
    expect(after.status, after.text).toBe(200);
    expect(after.body.websiteIds).toEqual([b.id]);
    const visitor = api.with({
      [SHARE_TOKEN_HEADER]: after.body.token,
      [SHARE_CONTEXT_HEADER]: '1',
    });
    for (const client of [previousVisitor, visitor]) {
      expect((await client.get(`/api/websites/${a.id}/stats`, { params: range })).status).toBe(401);
      expect((await client.get(`/api/websites/${b.id}/stats`, { params: range })).status).toBe(200);
    }

    const transfer = await admin.post(`/api/websites/${a.id}/transfer`, { userId: seed.admin.id });
    expect(transfer.status, transfer.text).toBe(200);
    expect((await user.get(`/api/websites/${a.id}`)).status).toBe(401);
    const save = await user.post(`/api/boards/${boardId}`, {
      name: uniqueName('legacy-renamed'),
      parameters: rawParameters,
    });
    expect(save.status, save.text).toBe(200);
    expect(save.body.parameters).toEqual(rawParameters);
    expect(getBoardEntityIds(save.body)).toEqual({ websiteIds: [b.id], pixelIds: [], linkIds: [] });
    expect(
      (await previousVisitor.get(`/api/websites/${b.id}/stats`, { params: range })).status,
    ).toBe(200);
  } finally {
    if (shareId) await admin.del(`/api/share/id/${shareId}`);
    if (boardId) await admin.del(`/api/boards/${boardId}`);
    for (const id of sites) await admin.del(`/api/websites/${id}`);
  }
});
