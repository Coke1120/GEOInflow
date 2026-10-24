import { requestApi, readBody } from '@/lib/liekan/http';
import { analysisManagementAction } from '@/lib/liekan/upstream/analysis-acceleration-api';
export async function POST(request:Request,{params}:{params:Promise<{websiteId:string}>}) {
 return requestApi(request,async()=>analysisManagementAction(request,(await params).websiteId,await readBody(request,8192)));
}
