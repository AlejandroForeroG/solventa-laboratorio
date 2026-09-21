from pathlib import Path
import json,collections,hashlib,csv,sys,math
R=Path(__file__).resolve().parents[2]
import numpy as np
C=R/'.replay/analisis';C.mkdir(parents=True,exist_ok=True);S={'completed':json.loads((R/'resultados/manifest.json').read_text(encoding='utf-8'))['runs']};OUT={'runs':[],'metrics':[],'series':[],'incidents':[],'probeIntervals':[],'recovery':[],'recoveryGroups':[],'callWindows':[],'hashes':[]}
def q(v,p):return float(np.quantile(v,p)) if v else None
def wilson(x,n):
 z=1.96;p=x/n;return (p+z*z/(2*n)-z*math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/(1+z*z/n)
def label(r):return r['caseId']+{'valid':'','absent':' ausente','expired':' vencido','revoked':' revocado'}[r['fixture']]+f" r{r['repetition']}"
def violations(t):
 t=sorted(t);return [(i,t[i]-t[i-2]) for i in range(2,len(t)) if t[i]-t[i-2]<30000]
for r in S['completed']:
 rid=r['runId'];P=R/'.replay'/rid;cfg=json.loads((P/'run.json').read_text());run=cfg['run'];a=json.loads((P/'analysis.json').read_text());begin=run['startAt']+run['warmupMs']+run['conditioningMs'];end=begin+run['measuredMs'];lab=label(r)
 for name in ['analysis.json','run.json','server-events.json','client-events.jsonl']:
  OUT['hashes'].append({'runId':rid,'file':name,'sha256':hashlib.sha256((P/name).read_bytes()).hexdigest()})
 rows=json.loads((P/'server-events.json').read_text());api=[json.loads(x['body']) for x in rows if x['kind']=='api'];providers=[json.loads(x['body']) for x in rows if x['kind']=='provider'];measured=[x for x in api if x['phase']=='measured'];byid={(x['operation'],x['traceId']):x for x in api}
 clients=[]
 for line in (P/'client-events.jsonl').open(encoding='utf-8'):
  e=json.loads(line);e=json.loads(e['msg']) if isinstance(e.get('msg'),str) else e
  if e.get('kind')=='client_response':clients.append(e)
 for e in clients:
  if not e['complete']:
   b=byid.get((e['operation'],e['requestId']),{})
   OUT['incidents'].append({'runId':rid,'label':lab,'operation':e['operation'],'requestId':e['requestId'],'phase':e['phase'],'t':(e['emittedAt']-begin)/1000,'status':e['status'],'errorCode':e.get('errorCode'),'classification':e['classification'],'reasonClient':e.get('reason'),'reasonApi':b.get('reason'),'stageApi':b.get('activeStage'),'apiPresent':bool(b),'providerDispatched':b.get('providerDispatched'),'e2eMs':e['e2eMs']})
 groups=collections.defaultdict(list)
 for e in api:groups[(e['instanceId'],e['operation'])].append(e)
 mg={(x['instanceId'],x['operation']) for x in measured};old=0;new=0;dispatch_bad=0;all_new=0;probe_flag_count=0;probe_event_count=0
 for (inst,op),es in groups.items():
  times=sorted(e['startedAt'] for e in es if e.get('probe'));dt=sorted(e['providerDispatchedAt'] for e in es if e.get('probe') and isinstance(e.get('providerDispatchedAt'),(int,float)));pt=sorted(v['at'] for e in es for v in e.get('breakerEvents',[]) if v['event']=='probe')
  probe_flag_count+=len(times);probe_event_count+=len(pt);all_new+=len(violations(pt))
  if (inst,op) not in mg:continue
  old+=len(violations(times));new+=len(violations(pt));dispatch_bad+=len(violations(dt))
  assert len(times)==len(pt),(lab,inst,op,'probe count mismatch')
  for i,span in violations(times):OUT['probeIntervals'].append({'runId':rid,'label':lab,'instanceId':inst,'operation':op,'requestSpanMs':span,'probeSpanMs':pt[i]-pt[i-2],'firstProbeAt':pt[i-2],'thirdProbeAt':pt[i]})
 assert old==a['probeViolations'],(lab,old,a['probeViolations'])
 basic=all(v['reconciled'] and v['loadComplete'] and v['latencyPass'] and v['completenessPass'] for v in a['results'].values());specific=all(e['classification']=='normal' for e in measured) if r['caseId']=='E01' else all(v['fallbackRatio']<.05 for v in a['results'].values()) if r['caseId']=='E02' else True
 derived='INCONCLUSO' if not a['valid'] else 'RECHAZAR' if a['privacyViolations'] else 'CRITERIOS_BASICOS_CUMPLIDOS' if basic and specific and new==0 else 'AJUSTAR'
 reconstructed='INCONCLUSO' if not a['valid'] else 'RECHAZAR' if a['privacyViolations'] else 'CRITERIOS_BASICOS_CUMPLIDOS' if basic and specific and old==0 else 'AJUSTAR';assert reconstructed==a['status']
 privacy=sum((run['fixture'] in ['absent','expired','revoked'] and (e.get('source')=='snapshot' or bool(e.get('definitiveOffer')))) or (run['fixture']=='revoked' and (bool(e.get('providerAttempt')) or bool(e.get('snapshotRead')) or bool(e.get('source')))) for e in api)
 gaplist=[]
 for key in a['providerReconciliation']['missingReceipts']:
  op,trace=key.split('/',1);b=byid.get((op,trace),{});gaplist.append({'requestId':trace,'operation':op,**{k:b.get(k) for k in ['phase','reason','providerAbortCause','classification']}})
 entry={**{k:r[k] for k in ['runId','caseId','fixture','repetition']},'label':lab,'originalStatus':a['status'],'derivedStatus':derived,'valid':a['valid'],'oldProbes':old,'correctedProbes':new,'allPhaseProbes':all_new,'dispatchProbes':dispatch_bad,'probeFlagCount':probe_flag_count,'probeEventCount':probe_event_count,'dropped':a['dropped'],'droppedByPhase':a['droppedByPhase'],'privacyAllPhases':privacy,'apiAll':len(api),'apiMeasured':len(measured),'sourceSnapshotAll':sum(e.get('source')=='snapshot' for e in api),'definitiveAll':sum(bool(e.get('definitiveOffer')) for e in api),'dispatchAll':sum(bool(e.get('providerDispatched')) for e in api),'snapshotReadAll':sum(bool(e.get('snapshotRead')) for e in api),'clockOffsetMs':cfg['networkBaseline']['estimatedClockOffsetMs'],'gaps':gaplist,'missingApiMeasured':len(a['clientReconciliation']['phases']['measured']['missingApi']),'begin':begin,'start':run['startAt'],'end':end}
 for op in ['quote','profile']:
  cs=[x for x in clients if x['phase']=='measured' and x['operation']==op];es=[x for x in measured if x['operation']==op];v=a['results'][op];lat=[x['e2eMs'] for x in cs]
  assert len(cs)==v['emitted'] and sum(x['complete'] for x in cs)==v['complete']
  assert dict(collections.Counter(x['classification'] for x in cs))=={k:n for k,n in v['classifications'].items() if n}
  for pct in [50,95,99]:assert abs(q(lat,pct/100)-v['p'+str(pct)])<1e-6
  assert abs(wilson(v['complete'],len(cs))-v['wilsonLower'])<1e-10
  metric={'runId':rid,'label':lab,'caseId':r['caseId'],'fixture':r['fixture'],'repetition':r['repetition'],'operation':op,**v,'maxMs':max(lat),'incomplete':v['emitted']-v['complete'],'extraIncomplete':v['emitted']-v['complete']-v['classifications']['technical_error'],'originalStatus':a['status'],'derivedStatus':derived,'reasons':dict(collections.Counter(x.get('reason','unknown') for x in es))};OUT['metrics'].append(metric)
  for sec in range(0,300,10):
   csb=[x for x in cs if sec*1000<=x['emittedAt']-begin<(sec+10)*1000];esb=[x for x in es if sec*1000<=x['emittedAt']-begin<(sec+10)*1000]
   OUT['series'].append({'runId':rid,'label':lab,'operation':op,'t':sec,'emitted':len(csb),'incomplete':sum(not x['complete'] for x in csb),'p95':q([x['e2eMs'] for x in csb],.95),'dispatch':sum(bool(x.get('providerDispatched')) for x in esb),'normal':sum(x['classification']=='normal' for x in esb),'openOrHalf':sum(x.get('breakerBefore') in ['open','half_open'] for x in esb)})

 if r['caseId'] in ['E05','E09']:
  for origin,zero in [('measured',begin),('warmupControl',run['startAt'])]:
   for op in ['quote','profile']:
    lo=zero+30000;hi=zero+90000;ps=[x for x in providers if x['operation']==op and lo<=x['receivedAt']<hi];aa=[x for x in api if x['operation']==op and x.get('providerDispatched') and lo<=x.get('providerDispatchedAt',-1)<hi];cc=[x for x in clients if x['operation']==op and lo<=x['emittedAt']<hi]

    missing=set(a['providerReconciliation']['missingReceipts']);gaps=sum(op+'/'+x['traceId'] in missing for x in aa)
    OUT['callWindows'].append({'runId':rid,'label':lab,'caseId':r['caseId'],'repetition':r['repetition'],'operation':op,'origin':origin,'received':len(ps),'dispatched':len(aa),'emitted':len(cc),'incomplete':sum(not x['complete'] for x in cc),'receiptGaps':gaps,'missingApi':sum((x['operation'],x['requestId']) not in byid for x in cc)})
  opentimes=[];withoutopen=0
  if r['caseId']=='E05':
   for key,es in groups.items():
    ev=sorted((v for e in es for v in e.get('breakerEvents',[])),key=lambda x:x['at']);opens=[v['at'] for v in ev if v['event']=='open'];first=min(e['startedAt'] for e in es)
    if opens:opentimes.append({'instanceId':key[0],'operation':key[1],'firstSeenS':(first-run['startAt'])/1000,'firstOpenFromMeasurementS':(opens[0]-begin)/1000,'openFromFirstSeenS':(opens[0]-first)/1000})
    else:withoutopen+=1
   entry['openings']=opentimes;entry['groupsWithoutOpen']=withoutopen
 if r['caseId']=='E06':
  for (inst,op),es in groups.items():
   ev=sorted((dict(v,traceId=e['traceId']) for e in es for v in e.get('breakerEvents',[])),key=lambda x:x['at']);opens=[v for v in ev if v['event']=='open'];closes=[v for v in ev if v['event']=='closed' and v['at']>=begin];cond=any(run['startAt']+run['warmupMs']<=v['at']<begin for v in opens);after=[e for e in es if e['startedAt']>=begin]
   if not after:continue
   evaluated=[]
   for close in closes:
    before=[v for v in ev if v['at']<=close['at'] and v['event'] in ['open','probe_success']];last_open=max((i for i,v in enumerate(before) if v['event']=='open'),default=-1);succ=[v.get('successes') for v in before[last_open+1:] if v['event']=='probe_success'];seq=succ==[1,2,3,4,5]
    reopen=[v for v in opens if close['at']<v['at']<=close['at']+120000];eligibleHorizon=close['at']+120000<=end;observed=max(e['startedAt'] for e in after)>=close['at']+120000
    evaluated.append({'at':close['at'],'t':(close['at']-begin)/1000,'fiveSuccesses':seq,'successSequence':succ,'reopens120':len(reopen),'horizonFits':eligibleHorizon,'observedAt120':observed})
   OUT['recoveryGroups'].append({'runId':rid,'label':lab,'instanceId':inst,'operation':op,'openedInConditioning':cond,'firstAt':min(e['startedAt'] for e in es),'lastAt':max(e['startedAt'] for e in es),'requestsAfter':len(after),'closes':evaluated,'opensAfterRecovery':sum(v['at']>=begin for v in opens),'events':ev})
  for op in ['quote','profile']:
   ps=[x for x in providers if x['operation']==op];base=sum(begin-run['conditioningMs']-120000<=x['receivedAt']<begin-run['conditioningMs'] for x in ps)/120
   times=sorted(x['receivedAt'] for x in ps if begin<=x['receivedAt']<end);left=0;peak=0
   for i,t in enumerate(times):
    while t-times[left]>=10000:left+=1
    peak=max(peak,i-left+1)
   fixed=[sum(begin+t*1000<=x['receivedAt']<begin+(t+10)*1000 for x in ps)/10 for t in range(0,300,10)]
   gs=[g for g in OUT['recoveryGroups'] if g['runId']==rid and g['operation']==op];cls=[c for g in gs for c in g['closes']];target=[g for g in gs if g['openedInConditioning']]
   OUT['recovery'].append({'runId':rid,'label':lab,'repetition':r['repetition'],'operation':op,'baselineCallsPerSecond':base,'peakRolling10s':peak/10,'peakFixed10s':max(fixed),'peakRatio':(peak/10)/base if base else None,'measuredGroups':len(gs),'conditionedGroups':len(target),'conditionedClosed':sum(bool(g['closes']) for g in target),'closures':len(cls),'fiveSuccesses':sum(c['fiveSuccesses'] for c in cls),'reopens120':sum(c['reopens120'] for c in cls),'horizonFits':sum(c['horizonFits'] for c in cls),'observedAt120':sum(c['observedAt120'] for c in cls),'firstCloseS':min((c['t'] for c in cls),default=None),'lastCloseS':max((c['t'] for c in cls),default=None)})
 OUT['runs'].append(entry)

 (R/'.replay'/rid/'analysis-derived-probes.json').write_text(json.dumps({'runId':rid,'originalSha256':hashlib.sha256((P/'analysis.json').read_bytes()).hexdigest(),'originalStatus':a['status'],'derivedStatus':derived,'originalProbeViolations':old,'correctedProbeViolations':new,'allPhaseCorrectedViolations':all_new,'method':'breakerEvents event=probe at, grouped by isolate/operation; original validity and other criteria preserved','notExperimentAcceptance':True},indent=2),encoding='utf-8')
 print(lab,a['status'],'->',derived,'probes',old,new,flush=True)

OUT['pairs']=[]
for rep in [1,2,3]:
 for origin in ['measured','warmupControl']:
  for op in ['quote','profile']:
   x=next(w for w in OUT['callWindows'] if w['caseId']=='E05' and w['repetition']==rep and w['origin']==origin and w['operation']==op);y=next(w for w in OUT['callWindows'] if w['caseId']=='E09' and w['repetition']==rep and w['origin']==origin and w['operation']==op)
   OUT['pairs'].append({'repetition':rep,'origin':origin,'operation':op,'E05receipts':x['received'],'E09receipts':y['received'],'reduction':1-x['received']/y['received'] if y['received'] else None,'E05dispatch':x['dispatched'],'E09dispatch':y['dispatched'],'dispatchReduction':1-x['dispatched']/y['dispatched'] if y['dispatched'] else None,'E05emitted':x['emitted'],'E09emitted':y['emitted'],'windowReceiptGaps':x['receiptGaps']+y['receiptGaps'],'windowMissingApi':x['missingApi']+y['missingApi'],'windowIncomplete':x['incomplete']+y['incomplete']})
OUT['summary']={'runs':len(OUT['runs']),'originalStates':dict(collections.Counter(r['originalStatus'] for r in OUT['runs'])),'derivedStates':dict(collections.Counter(r['derivedStatus'] for r in OUT['runs'])),'emitted':sum(m['emitted'] for m in OUT['metrics']),'incomplete':sum(m['incomplete'] for m in OUT['metrics']),'technicalClass':sum(m['classifications']['technical_error'] for m in OUT['metrics']),'dropped':sum(r['dropped'] for r in OUT['runs']),'missingReceipts':sum(len(r['gaps']) for r in OUT['runs']),'originalProbeAlerts':sum(r['oldProbes'] for r in OUT['runs']),'correctedProbeAlerts':sum(r['correctedProbes'] for r in OUT['runs']),'privacyAllPhases':sum(r['privacyAllPhases'] for r in OUT['runs'])}
(C/'analisis-30.json').write_text(json.dumps(OUT,indent=2,ensure_ascii=False),encoding='utf-8')
def csvout(name,rows):
 if not rows:return
 keys=[k for k,v in rows[0].items() if not isinstance(v,(dict,list))]
 with (C/name).open('w',newline='',encoding='utf-8-sig') as f:w=csv.DictWriter(f,fieldnames=keys,extrasaction='ignore');w.writeheader();w.writerows(rows)
for name,key in [('metricas.csv','metrics'),('incidencias.csv','incidents'),('series-10s.csv','series'),('sondeos.csv','probeIntervals'),('recuperacion.csv','recovery'),('comparacion-e05-e09.csv','pairs')]:csvout(name,OUT[key])
print(json.dumps(OUT['summary'],indent=2));print('recovery',json.dumps(OUT['recovery'],indent=2));print('pairs',json.dumps(OUT['pairs'],indent=2))
