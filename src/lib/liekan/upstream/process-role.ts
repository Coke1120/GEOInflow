const ROLE = Symbol.for('liekan.internal-process-role');
export function setInternalProcessRole(role: 'analytics-worker') { globalThis[ROLE] = role; }
export function isAnalyticsWorker() { return globalThis[ROLE] === 'analytics-worker'; }
