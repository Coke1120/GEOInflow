import { geographyAttribution } from '@/lib/detect';
export async function GET() {
  return Response.json(await geographyAttribution(), {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
}
