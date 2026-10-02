export function encodeCursor(row: { time: string | Date; recordId: string }) {
  if (!row?.recordId) return '';
  return Buffer.from(JSON.stringify([new Date(row.time).toISOString(), row.recordId])).toString(
    'base64url',
  );
}
export function decodeCursor(cursor: string): [Date, string] {
  const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value[1]) ||
    !Number.isFinite(Date.parse(value[0]))
  )
    throw new Error('日志游标无效');
  return [new Date(value[0]), value[1]];
}
