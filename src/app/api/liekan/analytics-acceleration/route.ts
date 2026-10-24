import { requestApi } from '@/lib/liekan/http';
import { listAnalysisWebsites } from '@/lib/liekan/upstream/analysis-acceleration-api';
export async function GET(request:Request){return requestApi(request,()=>listAnalysisWebsites(request));}
