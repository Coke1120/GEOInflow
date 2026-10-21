import { requestApi, api, readBody } from '@/lib/liekan/http';
import { createTeamUserAccount, readTeamUserCreation } from '@/lib/liekan/upstream/team-users';

type Context = { params: Promise<{ teamId: string }> };
export async function POST(request: Request, { params }: Context) {
  return requestApi(request, async () =>
    createTeamUserAccount(request, (await params).teamId, await readBody(request, 8192)),
  );
}
export async function GET(request: Request, { params }: Context) {
  return requestApi(request, async () =>
    readTeamUserCreation(
      request,
      (await params).teamId,
      Object.fromEntries(new URL(request.url).searchParams),
    ),
  );
}
