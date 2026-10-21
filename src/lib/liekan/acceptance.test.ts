import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const head = '54ba7e1955b7ee7bbba2ce410e1b173805024dd0';
const upstream = JSON.parse(fs.readFileSync('config/liekan/upstream.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('config/liekan/migrations.json', 'utf8'));
const featureContract = JSON.parse(
  fs.readFileSync('src/lib/liekan/contracts/feature-pages.json', 'utf8'),
);
const navigationContract = JSON.parse(fs.readFileSync('config/liekan/navigation-ui.json', 'utf8'));
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;

// Exercise the real CLI in a disposable cwd. Built-in child-process mocks keep every
// Docker/Git operation local to this fixture and prevent loading the private .env.
function fixture(fault: string) {
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const cwd = fs.mkdtempSync(path.join(root, 'tmp/liekan-acceptance-test-'));
  fs.mkdirSync(path.join(cwd, 'outputs'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'config/liekan'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'src/lib/liekan/contracts'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, 'src/lib/liekan/contracts/feature-pages.json'),
    JSON.stringify(featureContract),
  );
  fs.mkdirSync(path.join(cwd, 'prisma/migrations/26_add_api_key'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'prisma/migrations/26_add_api_key/migration.sql'), 'SELECT 1;\n');
  fs.writeFileSync(
    path.join(cwd, 'outputs/verification.json'),
    JSON.stringify({ head, passed: true, finalized: true, mode: 'release' }),
  );
  fs.writeFileSync(
    path.join(cwd, 'config/liekan/navigation-ui.json'),
    JSON.stringify(navigationContract),
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
const head=${JSON.stringify(head)}, upstream=${JSON.stringify(upstream)}, lock=${JSON.stringify(lock)}, version=${JSON.stringify(version)}, fault=${JSON.stringify(fault)}, featureIds=${JSON.stringify(featureContract.pages.map((page: { id: string }) => page.id))}, incrementalVisualPages=${JSON.stringify(navigationContract.incrementalVisualPages)};
const port=fault==='default-http-port'?80:fault==='custom-port'?3346:3302, baseUrl='http://127.0.0.1:'+port;
let keepAlive, restoreStarted=false;
const ledger=Object.entries(lock).map(([name,checksum])=>({name,checksum,appliedAt:'fixture'}));
if(fault==='installation-checksum')ledger.find(row=>row.name==='006_website_installation.sql').checksum='changed';
const official=[{migration_name:'26_add_api_key',checksum:createHash('sha256').update('SELECT 1;\\n').digest('hex'),finished_at:'fixture',rolled_back_at:null}];
if(fault==='official-checksum')official[0].checksum='modified';
if(fault==='official-missing')official[0].migration_name='deleted_official_migration';
if(fault==='official-unfinished')official[0].finished_at=null;
cp.execFileSync=(command,args,options={})=>{
 if(command==='git')return args[0]==='rev-parse'?head:'';
 const verb=args[0];
 if(verb==='create'&&args.includes('-p')&&args[args.indexOf('-p')+1]!=='127.0.0.1:'+port+':3000')throw Error('Docker port mismatch');
 if(verb==='create'&&options.env?.DATABASE_URL?.endsWith('/liekan_restore'))restoreStarted=true;
 if(verb==='image')return args.at(-1)==='{{.Id}}'?'sha256:fixture':JSON.stringify({'org.opencontainers.image.revision':head,'org.opencontainers.image.version':version,'io.liekan.ui.sha256':upstream.uiManifestSha256,'io.liekan.feature-ui.sha256':fault==='feature-ui-label'?'wrong':upstream.featureUiManifestSha256,'io.liekan.upstream.revision':upstream.commit,'io.liekan.migration':String(upstream.liekanMigration),'io.liekan.ai-ui.sha256':fault==='ai-ui-label'?'wrong':upstream.aiUiManifestSha256});
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
  if(sql==="SELECT to_regclass('liekan_installation') IS NOT NULL")return args.includes('liekan_restore')&&((fault==='installation-old-backup'&&!restoreStarted)||(fault==='installation-missing'&&restoreStarted))?'f':'t';
  if(sql.includes('FROM liekan_installation'))return JSON.stringify(!args.includes('liekan_restore')||fault==='installation-old-backup'?[]:[{websiteId:'fixture-website',method:'cloudflare',lastStep:fault==='installation-state'&&restoreStarted?'finish':'logs',browserCheckDeferred:true,logCheckDeferred:false,completedAt:null,updatedAt:'2026-10-04T00:00:00Z'}]);
  if(sql.includes('information_schema'))return JSON.stringify([{exists:true}]);
  if(sql.includes('_prisma_migrations'))return JSON.stringify(fault==='pending-upgrade'&&args.includes('liekan_restore')&&!restoreStarted?[]:official);
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
 if(args.includes('playwright.api.config.ts')){if(options.env.PLAYWRIGHT_BASE_URL!==baseUrl)throw Error('API origin mismatch');const coverage='tests/api/.runtime/'+new URL(baseUrl).host.replace(/[^a-z0-9.-]+/gi,'-')+'/coverage';fs.mkdirSync(coverage,{recursive:true});fs.writeFileSync(coverage+'/summary.json','{}');}
 if(args.some(arg=>['scripts/liekan-evidence-visual.mjs','scripts/liekan-feature-flows.mjs','scripts/liekan-feature-visual.mjs','scripts/liekan-manual-refresh.mjs','scripts/liekan-ai-visual.mjs','scripts/liekan-ai-home-visual.mjs','scripts/liekan-keyword-visual.mjs','scripts/liekan-search-engine-visual.mjs','scripts/liekan-visual.mjs'].includes(arg))&&options.env.LIEKAN_URL!==baseUrl)throw Error('Browser origin mismatch');
 if(args.includes('scripts/liekan-restored-check.mjs'))fs.writeSync(options.stdio[1],JSON.stringify({passed:true,enabledTwoFactorRecords:0,roles:[],teams:[],definitions:[]})+'\\n');
 if(args.includes('scripts/liekan-team-user-acceptance.mjs')){
  if(options.env.LIEKAN_URL!==baseUrl||!/^liekan-verify-[a-f0-9]{12}-[0-9]+-db$/.test(options.env.LIEKAN_TEAM_TEST_DB_CONTAINER))throw Error('Team user isolated origin mismatch');
  if(fault==='team-user-failed')return {status:1};
  fs.mkdirSync('test-results/liekan-team-users',{recursive:true});
  fs.writeFileSync('test-results/liekan-team-users/report.json',JSON.stringify({passed:fault!=='team-user-passed',head:fault==='team-user-head'?'other':head,checks:Array.from({length:fault==='team-user-count'?0:3},()=>({passed:fault!=='team-user-check'})),responsive:Array.from({length:fault==='team-user-responsive-count'?0:3},()=>({passed:fault!=='team-user-responsive-check'})),cleanup:fault!=='team-user-cleanup',errors:fault==='team-user-errors'?['fixture error']:[]}));
 }
 if(args.includes('scripts/liekan-evidence-visual.mjs')){if(fault==='evidence-visual-failed')return {status:1};fs.mkdirSync('test-results/liekan-evidence',{recursive:true});fs.writeFileSync('test-results/liekan-evidence/result.json',JSON.stringify({passed:fault!=='evidence-visual-passed',head:fault==='evidence-visual-head'?'other':head,checks:Array.from({length:fault==='evidence-visual-count'?0:24},()=>({})),errors:fault==='evidence-visual-errors'?['fixture error']:[]}));}
 if(args.includes('scripts/liekan-keyword-visual.mjs')){if(fault==='keyword-visual-failed')return {status:1};fs.mkdirSync('test-results/liekan-keywords',{recursive:true});fs.writeFileSync('test-results/liekan-keywords/report.json',JSON.stringify({passed:fault!=='keyword-visual-passed',head:fault==='keyword-visual-head'?'other':head,checks:Array.from({length:fault==='keyword-visual-count'?1:3},()=>({})),cleanup:fault!=='keyword-visual-cleanup'}));}
 if(args.includes('scripts/liekan-search-engine-visual.mjs')){if(fault==='search-engine-visual-failed')return {status:1};fs.mkdirSync('test-results/liekan-search-engines',{recursive:true});fs.writeFileSync('test-results/liekan-search-engines/report.json',JSON.stringify({passed:fault!=='search-engine-visual-passed',head:fault==='search-engine-visual-head'?'other':head,checks:Array.from({length:fault==='search-engine-visual-count'?1:3},()=>({})),cleanup:fault!=='search-engine-visual-cleanup'}));}
 if(args.includes('scripts/liekan-feature-flows.mjs')){if(fault==='feature-flows-failed')return {status:1};fs.mkdirSync('test-results/liekan-feature-flows',{recursive:true});fs.writeFileSync('test-results/liekan-feature-flows/report.json',JSON.stringify({passed:true,head:fault==='feature-flows-head'?'other':head,checks:Array.from({length:fault==='feature-flows-count'?1:14},()=>({passed:fault!=='feature-flows-check'})),errors:fault==='feature-flows-errors'?['fixture error']:[]}));}
 if(args.includes('scripts/liekan-feature-visual.mjs')){if(fault==='feature-visual-failed')return {status:1};fs.mkdirSync('test-results/liekan-features',{recursive:true});fs.writeFileSync('test-results/liekan-features/report.json',JSON.stringify({passed:true,head:fault==='feature-visual-head'?'other':head,checks:Array.from({length:fault==='feature-visual-count'?1:66*4},()=>({passed:true})),incrementalChecks:fault==='incremental-visual-missing'?undefined:[1440,1280,375,320].flatMap(width=>incrementalVisualPages.map(id=>({id:fault==='incremental-visual-ids'?'unknown-feature':id,width,passed:fault!=='incremental-visual-failed'}))),mobile:{head:fault==='mobile-visual-head'?'other':head,passed:fault!=='mobile-visual-failed',checks:fault==='mobile-visual-count'?1:(77+incrementalVisualPages.length)*4*2,incrementalPageIds:fault==='mobile-visual-incremental-ids'?[]:incrementalVisualPages}}));}
 if(args.includes('scripts/liekan-manual-refresh.mjs')){if(fault==='manual-refresh-failed')return {status:1};fs.mkdirSync('test-results/liekan-manual-refresh',{recursive:true});fs.writeFileSync('test-results/liekan-manual-refresh/report.json',JSON.stringify({passed:fault!=='manual-refresh-passed',finalized:fault!=='manual-refresh-finalized',head:fault==='manual-refresh-head'?'other':head,featureIds:fault==='manual-refresh-count'?featureIds.slice(0,1):fault==='manual-refresh-ids'?featureIds.map((id,index)=>index===0?'unknown-feature':id):featureIds,realIdle:Array.from({length:fault==='manual-refresh-idle'?1:4},()=>({idleDelta:0})),cachedHistory:{passed:fault!=='manual-refresh-cached-history'},noStoreHistory:fault==='manual-refresh-no-store-missing'?undefined:{passed:fault!=='manual-refresh-no-store-history'},errors:[]}));}
 if(args.includes('scripts/liekan-ai-visual.mjs')){if(fault==='ai-visual-failed')return {status:1};fs.mkdirSync('test-results/liekan-ai',{recursive:true});fs.writeFileSync('test-results/liekan-ai/report.json',JSON.stringify({passed:true,head:fault==='ai-visual-head'?'other':head,checks:Array.from({length:fault==='ai-visual-count'?1:8},()=>({passed:fault!=='ai-visual-check'})),errors:fault==='ai-visual-errors'?['fixture error']:[]}));}
 if(args.includes('scripts/liekan-ai-home-visual.mjs')){if(fault==='ai-home-failed')return {status:1};fs.mkdirSync('test-results/liekan-ai-home-v3',{recursive:true});const widths=fault==='ai-home-empty'?[]:fault==='ai-home-count'?[1440]:fault==='ai-home-extra'?[1440,1280,375,320,500]:[1440,1280,375,320];fs.writeFileSync('test-results/liekan-ai-home-v3/report.json',JSON.stringify({passed:fault!=='ai-home-passed',head:fault==='ai-home-head'?'other':head,checks:widths.map(width=>({width,focus:true,reference:true,keyboard:true,overflow:0})),errors:fault==='ai-home-errors'?['fixture error']:[]}));}

 if(args.includes('scripts/liekan-dialog-visual.mjs')){if(fault==='dialog-visual-failed')return {status:1};fs.mkdirSync('test-results/liekan-dialogs',{recursive:true});fs.writeFileSync('test-results/liekan-dialogs/report.json',JSON.stringify({passed:fault!=='dialog-visual-passed',head:fault==='dialog-visual-head'?'other':head,checks:Array.from({length:fault==='dialog-visual-count'?1:50},()=>({})),duplicates:fault==='dialog-visual-duplicates-missing'?undefined:(fault==='dialog-visual-duplicates-count'?[1]:[1,1,2,3,4,5,16]).map(id=>({id})),responsive:Array.from({length:fault==='dialog-visual-responsive'?1:15},()=>({})),supplementalResponsive:fault==='dialog-visual-supplemental-missing'?undefined:Array.from({length:fault==='dialog-visual-supplemental-count'?1:8},()=>({})),websiteDeletionSuccess:fault==='dialog-visual-delete-missing'?undefined:Array.from({length:fault==='dialog-visual-delete-count'?1:6},()=>({passed:fault!=='dialog-visual-delete-check'})),errors:fault==='dialog-visual-errors'?['fixture error']:[],cleanup:{passed:fault!=='dialog-visual-cleanup'}}));}
 if(args.includes('scripts/liekan-help-visual.mjs')){if(fault==='help-visual-failed')return {status:1};fs.mkdirSync('test-results/liekan-help',{recursive:true});fs.writeFileSync('test-results/liekan-help/report.json',JSON.stringify({passed:fault!=='help-visual-passed',head:fault==='help-visual-head'?'other':head,checks:Array.from({length:fault==='help-visual-count'?9:12},()=>({passed:fault!=='help-visual-check'})),errors:fault==='help-visual-errors'?['fixture error']:[]}));}
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
net.createServer=()=>({once(){},listen(_port,_host,callback){if(_port!==port||_host!=='127.0.0.1')throw Error('Port reservation mismatch');callback();},close(callback){callback();}});
syncBuiltinESMExports();
globalThis.fetch=async(_url,options={})=>{
 if(_url!==baseUrl+'/api/heartbeat')throw Error('Heartbeat origin mismatch');
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
      ...(fault === 'custom-port'
        ? { LIEKAN_ACCEPTANCE_PORT: '3346' }
        : fault === 'default-http-port'
          ? { LIEKAN_ACCEPTANCE_PORT: '80' }
          : {}),
      NODE_ENV: 'test' as const,
      APP_SECRET: 'fixture-secret',
      TWO_FACTOR_ENCRYPTION_KEY: 'a'.repeat(64),
    },
  };
}

describe('isolated acceptance CLI failure paths', () => {
  it.each(['none', 'custom-port', 'default-http-port'])(
    'accepts a complete isolated fixture with %s',
    fault => {
      const setup = fixture(fault);
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
        expect(report.url).toBe(
          `http://127.0.0.1:${fault === 'default-http-port' ? 80 : fault === 'custom-port' ? 3346 : 3302}`,
        );
        expect(report.dataRegression.readOnly).toBe(true);
        expect(report.dataRegression.checks).toHaveLength(8);
        expect(report.teamUsers.checks).toHaveLength(3);
        expect(report.teamUsers.responsive).toHaveLength(3);
        expect(report.teamUsers.cleanup).toBe(true);
        expect(report.searchEngineVisual.checks).toHaveLength(3);
        expect(report.searchEngineVisual.cleanup).toBe(true);
        expect(report.aiHomeVisual.checks.map((check: { width: number }) => check.width)).toEqual([
          1440, 1280, 375, 320,
        ]);
        expect(report.dialogVisual.websiteDeletionSuccess).toHaveLength(6);
        expect(report.manualRefresh.cachedHistory.passed).toBe(true);
        expect(report.manualRefresh.noStoreHistory.passed).toBe(true);
      } finally {
        fs.rmSync(setup.cwd, { recursive: true, force: true });
      }
    },
  );
  it.each(['', '0', '-1', '65536', '3346x', '127.0.0.1:3346', ' 3346'])(
    'rejects an invalid acceptance port %j before Docker work',
    port => {
      const setup = fixture('none');
      try {
        const result = spawnSync(process.execPath, setup.args, {
          cwd: setup.cwd,
          env: { ...setup.env, LIEKAN_ACCEPTANCE_PORT: port },
          encoding: 'utf8',
          timeout: 20000,
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('LIEKAN_ACCEPTANCE_PORT');
        expect(fs.readdirSync(path.join(setup.cwd, 'outputs'))).toEqual(['verification.json']);
      } finally {
        fs.rmSync(setup.cwd, { recursive: true, force: true });
      }
    },
  );
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
  it('upgrades a backup predating website installation without losing the empty state', () => {
    const setup = fixture('installation-old-backup');
    try {
      const result = spawnSync(process.execPath, setup.args, {
        cwd: setup.cwd,
        env: setup.env,
        encoding: 'utf8',
        timeout: 20000,
      });
      expect(result.status).toBe(0);
      const report = JSON.parse(
        fs.readFileSync(path.join(setup.cwd, 'outputs/acceptance.json'), 'utf8'),
      );
      expect(report.installationBefore).toEqual({ present: false });
      expect(report.installationAfter).toMatchObject({ present: true, count: 0 });
    } finally {
      fs.rmSync(setup.cwd, { recursive: true, force: true });
    }
  });
  it.each([
    'installation-checksum',
    'installation-state',
    'installation-missing',
    'backup-signal',
    'backup-error',
    'restore-signal',
    'restore-error',
    'data-regression-failed',
    'feature-ui-label',
    'ai-ui-label',
    'ai-visual-failed',
    'ai-visual-head',
    'ai-visual-count',
    'ai-visual-check',
    'ai-visual-errors',
    'ai-home-failed',
    'ai-home-head',
    'ai-home-empty',
    'ai-home-count',
    'ai-home-extra',
    'ai-home-passed',
    'ai-home-errors',
    'evidence-visual-failed',
    'evidence-visual-passed',
    'evidence-visual-head',
    'evidence-visual-count',
    'evidence-visual-errors',
    'keyword-visual-failed',
    'keyword-visual-passed',
    'keyword-visual-head',
    'keyword-visual-count',
    'keyword-visual-cleanup',
    'team-user-failed',
    'team-user-passed',
    'team-user-head',
    'team-user-count',
    'team-user-check',
    'team-user-responsive-count',
    'team-user-responsive-check',
    'team-user-cleanup',
    'team-user-errors',
    'search-engine-visual-failed',
    'search-engine-visual-passed',
    'search-engine-visual-head',
    'search-engine-visual-count',
    'search-engine-visual-cleanup',
    'feature-flows-failed',
    'feature-flows-head',
    'feature-flows-count',
    'feature-flows-check',
    'feature-flows-errors',
    'dialog-visual-failed',
    'dialog-visual-passed',
    'dialog-visual-head',
    'dialog-visual-count',
    'dialog-visual-duplicates-missing',
    'dialog-visual-duplicates-count',
    'dialog-visual-responsive',
    'dialog-visual-supplemental-missing',
    'dialog-visual-supplemental-count',
    'dialog-visual-delete-missing',
    'dialog-visual-delete-count',
    'dialog-visual-delete-check',
    'dialog-visual-errors',
    'dialog-visual-cleanup',
    'feature-visual-failed',
    'feature-visual-head',
    'feature-visual-count',
    'manual-refresh-failed',
    'manual-refresh-passed',
    'manual-refresh-finalized',
    'manual-refresh-head',
    'manual-refresh-count',
    'manual-refresh-ids',
    'incremental-visual-missing',
    'incremental-visual-ids',
    'incremental-visual-failed',
    'mobile-visual-incremental-ids',
    'manual-refresh-idle',
    'manual-refresh-cached-history',
    'manual-refresh-no-store-history',
    'manual-refresh-no-store-missing',
    'mobile-visual-head',
    'mobile-visual-count',
    'mobile-visual-failed',

    'help-visual-failed',
    'help-visual-passed',
    'help-visual-head',
    'help-visual-count',
    'help-visual-check',
    'help-visual-errors',
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

describe('dialog visual replay fixture snapshot', () => {
  async function capture(api: (method: string, url: string, body?: any) => Promise<any>) {
    const source = fs.readFileSync(path.join(root, 'scripts/liekan-dialog-visual.mjs'), 'utf8');
    const start = source.search(/  const (?:savedReplays|replayStatus) = await api\(/);
    const end = source.indexOf("  await buttons('replay-player', [[45", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return runInNewContext(
      `(async () => { let replayOriginal; ${source.slice(start, end)}; return replayOriginal; })()`,
      { api, seed: { website: { id: 'site' }, data: { replayVisitId: 'visit' } } },
    );
  }

  it('captures the original saved replay beyond the first page before changing it', async () => {
    const calls: string[] = [];
    const record = { visitId: 'visit', name: 'original replay' };
    const original = await capture(async (method, url) => {
      calls.push(`${method} ${url}`);
      if (method === 'POST') return { ok: true };
      if (url.endsWith('/saved/visit')) return { isSaved: true };
      const page = new URL(url, 'http://fixture').searchParams.get('page') || '1';
      return {
        count: 201,
        data:
          page === '2'
            ? [record]
            : Array.from({ length: 200 }, (_, i) => ({ visitId: `other-${i}` })),
      };
    });
    expect(original.record).toEqual(record);
    expect(calls[0]).toBe('GET /websites/site/replays/saved/visit');
    expect(calls.at(-1)).toBe('POST /websites/site/replays/saved/visit');
  });

  it('stops before changing the replay when its saved record cannot be captured', async () => {
    const changes: any[] = [];
    await expect(
      capture(async (method, url, body) => {
        if (method === 'POST') changes.push(body);
        return url.endsWith('/saved/visit') ? { isSaved: true } : { count: 1, data: [] };
      }),
    ).rejects.toThrow(/saved replay/i);
    expect(changes).toEqual([]);
  });
});
