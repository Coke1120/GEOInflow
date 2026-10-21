import argparse, json, os
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect
parser=argparse.ArgumentParser(description='Verify historical repair UI using explicit local browser fixtures.')
parser.add_argument('--base',default=os.environ.get('HISTORY_REPAIR_UI_BASE','http://localhost:3312'))
base=parser.parse_args().base
parsed=urlparse(base)
if parsed.hostname not in ['localhost','127.0.0.1'] or parsed.scheme!='http' or not parsed.port or not 3300<=parsed.port<=3399:
 raise ValueError('Use an isolated local UI test server on port 3300–3399')
Path('outputs/history-repair-ui').mkdir(parents=True,exist_ok=True)
Path('.local').mkdir(exist_ok=True)

site='11111111-1111-4111-8111-111111111111'; runid='22222222-2222-4222-8222-222222222222'; gen='33333333-3333-4333-8333-333333333333'
counts={key:'0' for key in ['events','undatedEvents','logs','processed','changedEvents','changedLogs','browserEvidence','logEvidence','missingQuality','conflicts','beforePV','afterPV','beforeUV','afterUV']}
counts.update(events='100',logs='250',processed='350',beforePV='100',afterPV='80',beforeUV='60',afterUV='48',changedEvents='20',changedLogs='45',browserEvidence='80',logEvidence='250')
preview=dict(generation=gen,revision=2,digest='a'*64,complete=True,counts=counts,browserCoverage=.8,logCoverage=1,partial=True,limitations=['browser-input-incomplete'],excludedBatches=[],timezone='Asia/Shanghai',policy={'mode':'standard','allowedHostnames':[],'revision':'1'},rulepack={'engine':'history-repair-v1.1','matcher':'test','detector':'test','botCheckDisabled':False,'catalogVersion':gen,'rulesRevision':1,'hash':'b'*64},logImpact={'categories':[{'category':'search','beforeRequests':'20','afterRequests':'65'}],'beforeIdentities':'2','afterIdentities':'4','beforeAiPages':'10','afterAiPages':'25'})
run=dict(id=runid,websiteId=site,campaignId='traffic-quality-repair-20261022-v1',status='ready',revision=2,inputRevision=0,generation=gen,activeGeneration=None,previousGeneration=None,progress=95,phase='preview',counts=counts,frozenAt='2026-10-22T03:00:00Z',scopeId=gen,scopeChanged=False,errorCode=None,updatedAt='2026-10-22T03:10:00Z',completedAt=None,preview=preview)
listing=dict(campaignId=run['campaignId'],engineVersion='history-repair-v1.1',supported=True,dismissed=True,unreadCompletion=False,hasEligibleData=True,websites=[dict(id=site,name='【界面验收】历史修复测试站',domain='repair-test.example',eligible=True,hasData=True,status='ready',run=run)],nextCursor=None)
upload=dict(id=gen,source='【界面验收】不完整文件',finalized=False,discarded=False,rows='2',accepted='1',rejected='1',chunks=1,errors=[{'sequence':0,'row':2,'code':'event-not-resolved'}],moreErrors=False)
detail=dict(campaignId=run['campaignId'],eligible=True,hasData=True,run=run,uploads=[])
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='chrome')
 try:
  for locale in ['zh-CN','en-US']:
   for width in [1440,390]:
    context=browser.new_context(locale=locale,viewport={'width':width,'height':1000},reduced_motion='reduce')
    try:
     context.add_cookies([{'name':'liekan.locale','value':locale,'url':base}])
     context.add_init_script("localStorage.setItem('umami.auth',JSON.stringify('isolated-ui-fixture'))")
     page=context.new_page();page.set_default_timeout(30000); errors=[];calls=[]
     page.on('pageerror',lambda e:errors.append(str(e)))
     def api(route):
      req=route.request;path=urlparse(req.url).path;calls.append((req.method,path));data=[]
      if path.endswith('/auth/verify'):data={'id':'44444444-4444-4444-8444-444444444444','username':'ui-test','role':'admin','isAdmin':True}
      elif path.endswith('/config'):data={'cloudMode':False,'privateMode':False,'sessionDeletionEnabled':False,'telemetryDisabled':True,'updatesDisabled':True}
      elif path.endswith('/2fa/status'):data={'isEnabled':False,'isRequired':False,'isConfigured':True,'globalRequired':False,'requiredReason':None}
      elif path=='/api/liekan/history-repair':data=listing
      elif path==f'/api/liekan/websites/{site}/history-repair':data=detail
      elif path.endswith('/history-repair/confirm'):
       body=req.post_data_json;assert body['runId']==runid and body['partialConfirmed'] is True;data=run
      elif path.endswith('/me/teams'):data={'data':[],'count':0}
      elif path.endswith('/crawler-registry'):data={'version':gen}
      route.fulfill(status=200,content_type='application/json',body=json.dumps(data),headers={'Cache-Control':'no-store'})
     page.route('**/api/**',api)
     page.goto(f'{base}/settings/data-repair?websiteId={site}',wait_until='networkidle')
     page.screenshot(path=f'outputs/history-repair-ui/recon-{locale}-{width}.png',full_page=True)
     text=page.locator('body').inner_text()
     zh=locale=='zh-CN'
     expect(page.get_by_role('heading',name='历史数据修复' if zh else 'Historical data repair',exact=True)).to_be_visible()
     expect(page.get_by_text('80',exact=True).first).to_be_visible()
     source_input=page.get_by_label('来源说明' if zh else 'Source description',exact=True)
     source_input.fill('isolated evidence source')
     evidence_input=page.locator('input[type=file]')
     evidence_input.set_input_files({'name':'isolated-evidence.jsonl','mimeType':'application/x-ndjson','buffer':b'{}\n'})
     with page.expect_response(lambda response: urlparse(response.url).path=='/api/liekan/history-repair',timeout=5000):
      with page.expect_response(lambda response: urlparse(response.url).path==f'/api/liekan/websites/{site}/history-repair',timeout=5000):
       page.locator('[data-manual-refresh]').first.click()
     expect(source_input).to_have_value('isolated evidence source')
     assert evidence_input.evaluate('(input)=>input.files.length')==1, 'refresh cleared an unsubmitted file'
     page.get_by_role('button',name='确认并生效' if zh else 'Confirm and apply',exact=True).click()
     dialog=page.get_by_role('dialog');expect(dialog).to_be_visible()
     confirm=dialog.get_by_role('button',name='确认并生效' if zh else 'Confirm and apply',exact=True)
     expect(confirm).to_be_disabled()
     dialog.get_by_role('checkbox').check();expect(confirm).to_be_enabled()
     page.screenshot(path=f'outputs/history-repair-ui/confirm-{locale}-{width}.png',full_page=True)
     confirm.click();expect(dialog).to_have_count(0)
     assert sum(1 for method,path in calls if method=='POST' and path.endswith('/confirm'))==1
     assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'horizontal page overflow'
     assert not errors,errors
     print(f'{locale} {width}: page, preview, partial confirmation, run fencing and layout passed')
    finally:context.close()
 finally:browser.close()
