import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const head = '54ba7e1955b7ee7bbba2ce410e1b173805024dd0';
const upstream = JSON.parse(fs.readFileSync('config/liekan/upstream.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('config/liekan/migrations.json', 'utf8'));
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;

// Exercise the real CLI in a disposable cwd. Built-in child-process mocks keep every
// Docker/Git operation local to this fixture and prevent loading the private .env.
function fixture(fault: string) {
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const cwd = fs.mkdtempSync(path.join(root, 'tmp/liekan-acceptance-test-'));
  fs.mkdirSync(path.join(cwd, 'outputs'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'config/liekan'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'prisma/migrations/26_add_api_key'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'prisma/migrations/26_add_api_key/migration.sql'), 'SELECT 1;\n');
  fs.writeFileSync(
    path.join(cwd, 'outputs/verification.json'),
    JSON.stringify({ head, passed: true, finalized: true, mode: 'release' }),
  );
  fs.writeFileSync(path.join(cwd, 'config/liekan/upstream.json'), JSON.stringify(upstream));
  fs.writeFileSync(path.join(cwd, 'config/liekan/migrations.json'), JSON.stringify(lock));
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ version, type: 'module' }));
  const preload = path.join(cwd, 'mock-process.mjs');
  fs.writeFileSync(
    preload,
    `
import cp from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
const head=${JSON.stringify(head)}, upstream=${JSON.stringify(upstream)}, lock=${JSON.stringify(lock)}, version=${JSON.stringify(version)}, fault=${JSON.stringify(fault)};
let keepAlive, restoreStarted=false;
const ledger=Object.entries(lock).map(([name,checksum])=>({name,checksum,appliedAt:'fixture'}));
const official=[{migration_name:'26_add_api_key',checksum:createHash('sha256').update('SELECT 1;\\n').digest('hex'),finished_at:'fixture',rolled_back_at:null}];
if(fault==='official-checksum')official[0].checksum='modified';
if(fault==='official-missing')official[0].migration_name='deleted_official_migration';
if(fault==='official-unfinished')official[0].finished_at=null;
cp.execFileSync=(command,args,options={})=>{
 if(command==='git')return args[0]==='rev-parse'?head:'';
 const verb=args[0];
 if(verb==='create'&&options.env?.DATABASE_URL?.endsWith('/liekan_restore'))restoreStarted=true;
 if(verb==='image')return args.at(-1)==='{{.Id}}'?'sha256:fixture':JSON.stringify({'org.opencontainers.image.revision':head,'org.opencontainers.image.version':version,'io.liekan.ui.sha256':upstream.uiManifestSha256,'io.liekan.feature-ui.sha256':fault==='feature-ui-label'?'wrong':upstream.featureUiManifestSha256,'io.liekan.upstream.revision':upstream.commit,'io.liekan.migration':String(upstream.liekanMigration)});
 if(verb==='compose')return 'fixture-source';
 if(verb==='inspect')return JSON.stringify({'com.docker.compose.project':'liekan','com.docker.compose.service':'db'});
 if(verb==='network'&&args[1]==='ls')return 'fixture-network';
 if(verb==='network'&&args[1]==='inspect')return JSON.stringify([{IPAM:{Config:[{Subnet:'10.253.30.0/24'}]}}]);
 if(verb==='rm'||(verb==='network'&&args[1]==='rm')){
  console.log('fixture-cleaned');
  if(verb==='network'){
   clearInterval(keepAlive);
   if(fault==='cleanup-error')throw new Error('fixture cleanup failure');
   if(fault==='cleanup-cancel')process.emit('SIGTERM');
  }
 }
 if(verb==='exec'&&args.includes('psql')){
  const sql=args.at(-1);
  if(sql.includes('information_schema'))return JSON.stringify([{exists:true}]);
  if(sql.includes('_prisma_migrations'))return JSON.stringify(fault==='pending-upgrade'&&args.includes('liekan_restore')&&!restoreStarted?[]:official);
  if(sql.includes('to_regclass'))return fault==='installation-missing'||(fault==='installation-upgrade'&&args.includes('liekan_restore')&&!restoreStarted)?'':'liekan_installation';
  if(sql==='SELECT count(*) FROM liekan_installation')return String(fault==='installation-upgrade'||(fault==='installation-lost'&&restoreStarted)?0:3);
  if(sql==='SELECT count(*) FROM liekan_migration')return String(upstream.liekanMigration);
  if(sql.startsWith('SELECT json_build_object'))return JSON.stringify({user:2,website:1,session:3,website_event:5,report:1,liekan_log:1,liekan_import:1,liekan_catalog:1,liekan_setting:1,liekan_migration:upstream.liekanMigration});
  if(sql.startsWith('SELECT json_agg'))return JSON.stringify(ledger.map(row=>sql.includes('appliedAt')?row:{name:row.name,checksum:row.checksum}));
 }
 return 'ok';
};
cp.spawnSync=(command,args,options={})=>{
 const backup=args.includes('pg_dump'), restore=args.includes('psql')&&args.includes('-i');
 if(backup)fs.writeSync(options.stdio[1],'fixture SQL');
 if((backup&&fault.startsWith('backup'))||(restore&&fault.startsWith('restore'))){
  if(fault.endsWith('error'))return {status:0,error:new Error('fixture spawn failure')};
  return {status:null,signal:'SIGKILL'};
 }
 if(args.includes('scripts/liekan-data-regression.mjs')){
  if(fault==='data-regression-failed')return {status:1};
  fs.writeSync(options.stdio[1],JSON.stringify({passed:true,sourceHash:'a'.repeat(64),checks:Array.from({length:8},(_,i)=>'fixture '+i),readOnly:true,fixture:'synthetic-relations'})+'\\n');
 }
 if(args.includes('playwright.api.config.ts')){fs.mkdirSync('tests/api/.runtime/127.0.0.1-3302/coverage',{recursive:true});fs.writeFileSync('tests/api/.runtime/127.0.0.1-3302/coverage/summary.json','{}');}
 if(args.includes('scripts/liekan-restored-check.mjs'))fs.writeSync(options.stdio[1],JSON.stringify({passed:true,enabledTwoFactorRecords:0,roles:[],teams:[],definitions:[]})+'\\n');
 if(args.includes('scripts/liekan-feature-flows.mjs')){if(fault==='feature-flows-failed')return {status:1};fs.mkdirSync('test-results/liekan-feature-flows',{recursive:true});fs.writeFileSync('test-results/liekan-feature-flows/report.json',JSON.stringify({passed:true,head:fault==='feature-flows-head'?'other':head,checks:Array.from({length:fault==='feature-flows-count'?1:16},()=>({passed:fault!=='feature-flows-check'})),errors:fault==='feature-flows-errors'?['fixture error']:[]}));}
 if(args.includes('scripts/liekan-feature-visual.mjs')){if(fault==='feature-visual-failed')return {status:1};fs.mkdirSync('test-results/liekan-features',{recursive:true});fs.writeFileSync('test-results/liekan-features/report.json',JSON.stringify({passed:true,head:fault==='feature-visual-head'?'other':head,checks:Array.from({length:fault==='feature-visual-count'?1:68*4},()=>({passed:true})),loadingChecks:Array.from({length:fault==='loading-count'?1:68},()=>({passed:fault!=='loading-check'})),refreshChecks:Array.from({length:fault==='refresh-count'?1:10},()=>({passed:fault!=='refresh-check'})),transitionChecks:Array.from({length:fault==='transition-count'?1:10},()=>({passed:fault!=='transition-check'}))}));}
 if(args.includes('scripts/liekan-visual.mjs')){fs.mkdirSync('test-results/liekan-visual',{recursive:true});fs.writeFileSync('test-results/liekan-visual/geometry.json',JSON.stringify({passed:true,head}));}
 return {status:0};
};
cp.spawn=(command,args,options={})=>{
 const child=new EventEmitter();
 child.kill=()=>true;
 setImmediate(()=>{
  const result=cp.spawnSync(command,args,options);
  if(result.error)child.emit('error',result.error);
  child.emit('close',result.status,result.signal||null);
 });
 return child;
};
net.createServer=()=>({once(){},listen(_port,_host,callback){callback();},close(callback){callback();}});
syncBuiltinESMExports();
globalThis.fetch=async(_url,options={})=>{
 if(fault!=='cancel')return {ok:true};
 keepAlive=setInterval(()=>{},1000);
 console.log('fixture-ready');
 return new Promise((_resolve,reject)=>options.signal?.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
};
`,
  );
  return {
    cwd,
    args: ['--import', preload, path.join(root, 'scripts/liekan-acceptance.mjs')],
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test' as const,
      APP_SECRET: 'fixture-secret',
      TWO_FACTOR_ENCRYPTION_KEY: 'a'.repeat(64),
    },
  };
}

describe('isolated acceptance CLI failure paths', () => {
  it('accepts a complete isolated fixture', () => {
    const setup = fixture('none');
    try {
      const result = spawnSync(process.execPath, setup.args, {
        cwd: setup.cwd,
        env: setup.env,
        encoding: 'utf8',
        timeout: 20000,
      });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
      expect(fs.existsSync(path.join(setup.cwd, 'outputs/acceptance.json'))).toBe(true);
      const report = JSON.parse(
        fs.readFileSync(path.join(setup.cwd, 'outputs/acceptance.json'), 'utf8'),
      );
      expect(report.dataRegression.readOnly).toBe(true);
      expect(report.dataRegression.checks).toHaveLength(8);
    } finally {
      fs.rmSync(setup.cwd, { recursive: true, force: true });
    }
  });
  it('allows the restored pending official migration before upgrade and requires it afterwards', () => {
    const setup = fixture('pending-upgrade');
    try {
      const result = spawnSync(process.execPath, setup.args, {
        cwd: setup.cwd,
        env: setup.env,
        encoding: 'utf8',
        timeout: 20000,
      });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
      const report = JSON.parse(
        fs.readFileSync(path.join(setup.cwd, 'outputs/acceptance.json'), 'utf8'),
      );
      expect(report.restoredUpstreamBefore.pending).toEqual(['26_add_api_key']);
      expect(report.restoredUpstreamAfter.pending).toEqual([]);
      expect(report.restoredUpstreamAfter.applied).toBe(1);
    } finally {
      fs.rmSync(setup.cwd, { recursive: true, force: true });
    }
  });
  it('upgrades a backup without installation progress and counts the new table after migration', () => {
    const setup = fixture('installation-upgrade');
    try {
      const result = spawnSync(process.execPath, setup.args, {
        cwd: setup.cwd,
        env: setup.env,
        encoding: 'utf8',
        timeout: 20000,
      });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
      const report = JSON.parse(
        fs.readFileSync(path.join(setup.cwd, 'outputs/acceptance.json'), 'utf8'),
      );
      expect(report.before.liekan_installation).toBe(0);
      expect(report.after.liekan_installation).toBe(0);
    } finally {
      fs.rmSync(setup.cwd, { recursive: true, force: true });
    }
  });
  it.each([
    'installation-missing',
    'installation-lost',
    'backup-signal',
    'backup-error',
    'restore-signal',
    'restore-error',
    'data-regression-failed',
    'feature-ui-label',
    'feature-flows-failed',
    'feature-flows-head',
    'feature-flows-count',
    'feature-flows-check',
    'feature-flows-errors',
    'feature-visual-failed',
    'feature-visual-head',
    'feature-visual-count',
    'loading-count',
    'loading-check',
    'refresh-count',
    'refresh-check',
    'transition-count',
    'transition-check',
  ])('rejects %s instead of publishing a full acceptance', fault => {
    const setup = fixture(fault);
    try {
      const result = spawnSync(process.execPath, setup.args, {
        cwd: setup.cwd,
        env: setup.env,
        encoding: 'utf8',
        timeout: 20000,
      });
      expect(result.status).not.toBe(0);
      expect(fs.existsSync(path.join(setup.cwd, 'outputs/acceptance.json'))).toBe(false);
    } finally {
      fs.rmSync(setup.cwd, { recursive: true, force: true });
    }
  });
  it.each(['official-checksum', 'official-missing', 'official-unfinished'])(
    'rejects %s before publishing a full acceptance',
    fault => {
      const setup = fixture(fault);
      try {
        const result = spawnSync(process.execPath, setup.args, {
          cwd: setup.cwd,
          env: setup.env,
          encoding: 'utf8',
          timeout: 20000,
        });
        expect(result.status).not.toBe(0);
        expect(fs.existsSync(path.join(setup.cwd, 'outputs/acceptance.json'))).toBe(false);
      } finally {
        fs.rmSync(setup.cwd, { recursive: true, force: true });
      }
    },
  );
  it.each(['cleanup-error', 'cleanup-cancel'])(
    'rejects %s after completing the candidate checks',
    fault => {
      const setup = fixture(fault);
      try {
        const result = spawnSync(process.execPath, setup.args, {
          cwd: setup.cwd,
          env: setup.env,
          encoding: 'utf8',
          timeout: 20000,
        });
        expect(result.status).not.toBe(0);
        expect(fs.existsSync(path.join(setup.cwd, 'outputs/acceptance.json'))).toBe(false);
        const directory = fs
          .readdirSync(path.join(setup.cwd, 'outputs'))
          .find(name => name.startsWith('acceptance-'));
        if (!directory) throw new Error('Acceptance did not save its failure report');
        const report = JSON.parse(
          fs.readFileSync(path.join(setup.cwd, 'outputs', directory, 'report.json'), 'utf8'),
        );
        expect(report.passed).toBe(false);
        expect(report.finalized).toBe(false);
        expect(report.error).toMatch(/cleanup failed|cancelled/);
      } finally {
        fs.rmSync(setup.cwd, { recursive: true, force: true });
      }
    },
  );
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'cleans registered resources on %s and exits without success',
    async signal => {
      const setup = fixture('cancel');
      const child = spawn(process.execPath, setup.args, {
        cwd: setup.cwd,
        env: setup.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('CLI did not reach isolated app readiness')),
            10000,
          );
          child.once('error', reject);
          if (!child.stdout) throw new Error('Child stdout was not piped');
          child.stdout.on('data', chunk => {
            stdout += chunk.toString();
            if (stdout.includes('fixture-ready')) {
              clearTimeout(timeout);
              resolve();
            }
          });
        });
        const completed = new Promise<{ code: number | null; signal: string | null }>(resolve =>
          child.once('exit', (code, signal) => resolve({ code, signal })),
        );
        child.kill(signal);
        const result = await completed;
        expect(result.signal).toBeNull();
        expect(result.code).not.toBe(0);
        expect(stdout.match(/fixture-cleaned/g)).toHaveLength(3);
        expect(fs.existsSync(path.join(setup.cwd, 'outputs/acceptance.json'))).toBe(false);
      } finally {
        child.kill('SIGKILL');
        fs.rmSync(setup.cwd, { recursive: true, force: true });
      }
    },
    20000,
  );
});
