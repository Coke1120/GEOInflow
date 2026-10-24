import { requestApi } from '@/lib/liekan/http';
import { analysisJobResponse } from '@/lib/liekan/upstream/analysis-query-api';
export async function GET(request:Request,{params}:{params:Promise<{websiteId:string;jobId:string}>}) {
 return requestApi(request,async()=>{const {websiteId,jobId}=await params;return analysisJobResponse(request,websiteId,jobId,false);});
}
