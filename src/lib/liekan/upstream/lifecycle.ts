import { lockWritableWebsite, type WriteIdentity } from './server';
export async function resetLiekanStatistics(tx: any, websiteId: string, identity?: WriteIdentity) {
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid database schema');
  await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
  await lockWritableWebsite(tx, websiteId, identity);
  await tx.$executeRawUnsafe('DELETE FROM liekan_log WHERE website_id=$1::uuid', websiteId);
  await tx.$executeRawUnsafe('DELETE FROM liekan_import WHERE website_id=$1::uuid', websiteId);
}
