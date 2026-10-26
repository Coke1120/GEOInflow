import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: { user: { id: '11111111-1111-4111-8111-111111111111' } },
  capture: vi.fn(),
  create: vi.fn(),
  permission: vi.fn(),
}));
vi.mock('@/lib/liekan/upstream/share-calendar', () => ({ captureShareCalendar: state.capture }));
vi.mock('@/queries/prisma', () => ({ createShare: state.create }));
vi.mock('@/permissions', () => ({ canUpdateEntity: state.permission }));
vi.mock('@/lib/request', () => ({
  parseRequest: async (request: Request, schema: any) => {
    const parsed = schema.safeParse(await request.json());
    return parsed.success
      ? { auth: state.auth, body: parsed.data }
      : { error: () => Response.json({}, { status: 400 }) };
  },
}));
import { POST } from './route';

const body = {
  entityId: '22222222-2222-4222-8222-222222222222',
  shareType: 1,
  name: 'Public',
  parameters: { overview: true, timezone: 'Asia/Tokyo', range: '0day' },
};
const request = (parameters = body.parameters) =>
  new Request('http://localhost/api/share', {
    method: 'POST',
    body: JSON.stringify({ ...body, parameters }),
    headers: { 'Content-Type': 'application/json' },
  });
beforeEach(() => {
  vi.clearAllMocks();
  state.permission.mockResolvedValue(true);
  state.capture.mockResolvedValue({ overview: true, timezone: 'Europe/London', range: '0day' });
  state.create.mockImplementation(async value => value);
});

it('retains date and timezone parameters through request validation and captures the publisher calendar before creating a share', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(state.capture).toHaveBeenCalledWith(state.auth, body.parameters);
  expect(state.create).toHaveBeenCalledWith(
    expect.objectContaining({
      entityId: body.entityId,
      parameters: { overview: true, timezone: 'Europe/London', range: '0day' },
    }),
  );
});

it('uses the validated publisher calendar even when a caller supplies an invalid timezone', async () => {
  const response = await POST(request({ ...body.parameters, timezone: 'invalid' }));
  expect(response.status).toBe(200);
  expect(state.create).toHaveBeenCalledWith(
    expect.objectContaining({
      parameters: { overview: true, timezone: 'Europe/London', range: '0day' },
    }),
  );
});

it('checks resource authority before capturing account preferences', async () => {
  state.permission.mockResolvedValue(false);
  expect((await POST(request())).status).toBe(401);
  expect(state.capture).not.toHaveBeenCalled();
});
