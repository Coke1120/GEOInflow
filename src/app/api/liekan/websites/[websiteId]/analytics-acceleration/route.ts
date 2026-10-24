import { requestApi, readBody } from '@/lib/liekan/http';
import { analysisManagementState } from '@/lib/liekan/upstream/analysis-acceleration-api';
export async function GET(request:Request,{params}:{params:Promise<{websiteId:string}>}) {
 return requestApi(request,async()=>analysisManagementState(request,(await params).websiteId));
}
