from pathlib import Path
import json,collections
R=Path(__file__).resolve().parents[2]; C=R/'.replay/analisis';C.mkdir(parents=True,exist_ok=True)
D=json.loads(((C/'analisis-30.json') if (C/'analisis-30.json').exists() else R/'resultados/analisis-30.json').read_text(encoding='utf-8')); out={'pairs':[],'openingGroups':[],'openingSummary':[],'recoveryCensored':[]}
for rep in [1,2,3]:
 a,b=[next(r for r in D['runs'] if r['caseId']==case and r['repetition']==rep) for case in ['E05','E09']]
 x,y=[json.loads((R/'.replay'/r['runId']/'run.json').read_text()) for r in [a,b]]
 out['pairs'].append({'repetition':rep,'gapEndE05ToStartE09Seconds':(b['start']-a['end'])/1000,'sourceHashSame':x['sourceHash']==y['sourceHash'],'differentRunFields':{k:[v,y['run'].get(k)] for k,v in x['run'].items() if v!=y['run'].get(k)},'differentConfigFields':{k:[v,y.get(k)] for k,v in x.items() if k not in ['run','networkBaseline','sourceStatus'] and v!=y.get(k)}})
 rows=json.loads((R/'.replay'/a['runId']/'server-events.json').read_text()); gs=collections.defaultdict(list)
 for row in rows:
  if row['kind']=='api':
   e=json.loads(row['body']);gs[e['instanceId'],e['operation']].append(e)
 for (inst,op),es in gs.items():
  after=[e for e in es if e['startedAt']>=a['begin']]
  if not after:continue
  opens=sorted(v['at'] for e in es for v in e.get('breakerEvents',[]) if v['event']=='open' and v['at']>=a['begin'])
  first=min(e['startedAt'] for e in after); last=max(e['startedAt'] for e in after)
  out['openingGroups'].append({'repetition':rep,'instanceId':inst,'operation':op,'seenBeforeFailure':any(e['startedAt']<a['begin'] for e in es),'firstMeasuredRequestS':(first-a['begin'])/1000,'lastMeasuredRequestS':(last-a['begin'])/1000,'firstOpenS':(opens[0]-a['begin'])/1000 if opens else None,'firstOpenAfterFirstRequestS':(opens[0]-first)/1000 if opens else None,'firstState':min(after,key=lambda e:e['startedAt']).get('breakerBefore'),'requests':len(after)})
 for op in ['quote','profile']:
  g=[v for v in out['openingGroups'] if v['repetition']==rep and v['operation']==op]; established=[v for v in g if v['seenBeforeFailure']]; opened=[v for v in established if v['firstOpenS'] is not None]
  out['openingSummary'].append({'repetition':rep,'operation':op,'groups':len(g),'established':len(established),'establishedOpened':len(opened),'establishedOpenedWithin30':sum(v['firstOpenS']<=30 for v in opened),'establishedMaxOpenS':max((v['firstOpenS'] for v in opened),default=None),'newGroups':len(g)-len(established),'newOpenedLateAbsolute':sum(not v['seenBeforeFailure'] and v['firstOpenS'] is not None and v['firstOpenS']>30 for v in g),'withoutOpen':sum(v['firstOpenS'] is None for v in g)})
for g in D['recoveryGroups']:
 if g['openedInConditioning'] and not g['closes']:
  r=next(r for r in D['runs'] if r['runId']==g['runId']);out['recoveryCensored'].append({k:g[k] for k in ['label','instanceId','operation','requestsAfter']}|{'lastObservedS':(g['lastAt']-r['begin'])/1000,'lastEvents':g['events'][-8:]})
(C/'verificacion-ventanas.json').write_text(json.dumps(out,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps({k:v for k,v in out.items() if k not in ['openingGroups','recoveryCensored']},indent=2))
