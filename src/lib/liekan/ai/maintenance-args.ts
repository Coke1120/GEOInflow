export type AiMaintenanceOperation = 'check' | 'cleanup' | 'rotate-key' | 'restore-reset';
export function parseAiMaintenanceArgs(args: string[]): {
  operation: AiMaintenanceOperation;
  apply: boolean;
  help?: boolean;
  database?: string;
  oldKeyFile?: string;
  newKeyFile?: string;
} {
  if (args.length === 1 && args[0] === '--help')
    return { help: true, operation: 'check' as const, apply: false };
  const operation = (args[0] ?? 'check') as AiMaintenanceOperation;
  if (!['check', 'cleanup', 'rotate-key', 'restore-reset'].includes(operation))
    throw Error('维护操作无效');
  const values = new Map<string, string>(),
    seen = new Set<string>();
  let apply = false,
    help = false;
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw Error('维护参数不能重复');
    seen.add(flag);
    if (flag === '--apply') {
      apply = true;
      continue;
    }
    if (flag === '--help') {
      help = true;
      continue;
    }
    if (!['--database', '--old-key-file', '--new-key-file'].includes(flag))
      throw Error('维护参数无效');
    const value = args[++i];
    if (!value || value.startsWith('--')) throw Error('维护参数缺少值');
    values.set(flag, value);
  }
  if (operation === 'check' && apply) throw Error('check 为只读操作');
  if (operation !== 'rotate-key' && (values.has('--old-key-file') || values.has('--new-key-file')))
    throw Error('密钥文件仅用于轮换');
  if (apply && !values.has('--database')) throw Error('修改需明确数据库名称');
  if (
    apply &&
    operation === 'rotate-key' &&
    (!values.has('--old-key-file') || !values.has('--new-key-file'))
  )
    throw Error('轮换需提供旧、新密钥文件');
  return {
    operation,
    apply,
    help,
    database: values.get('--database'),
    oldKeyFile: values.get('--old-key-file'),
    newKeyFile: values.get('--new-key-file'),
  };
}
