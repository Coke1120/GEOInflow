import { z } from 'zod';
import { parseRequest } from '@/lib/request';
import { badRequest, json, unauthorized } from '@/lib/response';
import { canTransferWebsiteToTeam, canTransferWebsiteToUser } from '@/permissions';
import { transferWebsiteWithAi } from '@/lib/liekan/upstream/ai-lifecycle';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const schema = z.object({
    userId: z.uuid().optional(),
    teamId: z.uuid().optional(),
  });

  const { auth, body, error } = await parseRequest(request, schema);

  if (error) {
    return error();
  }

  const { websiteId } = await params;
  const { userId, teamId } = body;

  if (userId) {
    if (!(await canTransferWebsiteToUser(auth, websiteId, userId))) {
      return unauthorized();
    }

    const website = await transferWebsiteWithAi(websiteId, { userId: auth.user.id }, {
      userId,
      teamId: null,
    });

    return json(website);
  } else if (teamId) {
    if (!(await canTransferWebsiteToTeam(auth, websiteId, teamId))) {
      return unauthorized();
    }

    const website = await transferWebsiteWithAi(websiteId, { userId: auth.user.id }, {
      userId: null,
      teamId,
    });

    return json(website);
  }

  return badRequest();
}
