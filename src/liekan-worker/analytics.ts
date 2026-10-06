import 'dotenv/config';
import { setInternalProcessRole } from '../lib/liekan/upstream/process-role';
setInternalProcessRole('analytics-worker');
await import('./analytics-main');
