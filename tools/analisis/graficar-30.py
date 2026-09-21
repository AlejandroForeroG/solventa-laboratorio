from pathlib import Path
import json,sys
R=Path(__file__).resolve().parents[2]
import numpy as np,matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter
C=R/'.replay/analisis';C.mkdir(parents=True,exist_ok=True);a=json.loads(((C/'analisis-30.json') if (C/'analisis-30.json').exists() else R/'resultados/analisis-30.json').read_text(encoding='utf-8'));O=C/'graficas';O.mkdir(exist_ok=True)
plt.rcParams.update({'font.family':'serif','font.serif':['Times New Roman'],'font.size':11,'axes.spines.top':False,'axes.spines.right':False,'figure.facecolor':'white','savefig.facecolor':'white'})
runs=sorted(a['runs'],key=lambda x:(x['caseId'],x['fixture'],x['repetition']));figures=[]
def save(fig,name,title,caption):
 fig.savefig(O/(name+'.png'),dpi=180,bbox_inches='tight');fig.savefig(O/(name+'.pdf'),bbox_inches='tight');plt.close(fig);figures.append({'file':f'graficas/{name}.png','title':title,'caption':caption,'kind':'Gráfica derivada de registros reales'})
def metric(r,op):return next(m for m in a['metrics'] if m['runId']==r['runId'] and m['operation']==op)
for n,cases in enumerate([['E01','E02','E03'],['E04','E05','E06'],['E07','E08','E09']],1):
 rs=[r for r in runs if r['caseId'] in cases];fig,axs=plt.subplots(1,2,figsize=(12,6.5),sharey=True)
 for ax,op,title,lim95,lim99 in zip(axs,['quote','profile'],['Cotización','Perfilamiento'],[250,400],[500,800]):
  ms=[metric(r,op) for r in rs];y=np.arange(len(rs));ax.scatter([m['p95'] for m in ms],y-.12,color='black',label='p95');ax.scatter([m['p99'] for m in ms],y+.12,facecolors='white',edgecolors='black',marker='D',label='p99')
  ax.axvline(lim95,color='black',ls='--',label=f'Límite p95: {lim95} ms');ax.axvline(lim99,color='.5',ls=':',label=f'Límite p99: {lim99} ms');ax.set_xlim(0,max(lim99*1.12,max(m['p99'] for m in ms)*1.15));ax.set_yticks(y,[r['label'] for r in rs]);ax.set_xlabel('Latencia de extremo a extremo (ms)');ax.set_title(title);ax.grid(axis='y',alpha=.18);ax.legend(fontsize=9,loc='lower right')
  for i,m in enumerate(ms):ax.text(max(m['p95'],m['p99'])+8,i,f"{m['p95']:.0f} / {m['p99']:.0f}",fontsize=9,va='center')
 axs[0].invert_yaxis();fig.suptitle('Latencia por repetición: '+', '.join(cases),fontsize=17);fig.tight_layout(rect=[0,0,1,.96]);save(fig,f'0{n}-latencia','Latencia: '+', '.join(cases),'Valores recalculados desde el cliente. Se muestran también las corridas inconclusas; la comparación numérica con un límite no subsana su invalidez.')

conds=sorted(set((r['caseId'],r['fixture']) for r in runs));matrix=np.array([[100*next(m['wilsonLower'] for m in a['metrics'] if (m['caseId'],m['fixture'])==co and m['operation']==op and m['repetition']==rep) for op in ['quote','profile'] for rep in [1,2,3]] for co in conds]);fig,ax=plt.subplots(figsize=(12,6))
ax.imshow(matrix<99.9,cmap=matplotlib.colors.ListedColormap(['white','.78']),vmin=0,vmax=1,aspect='auto');ax.set_xticks(range(6),['Cotización r1','Cotización r2','Cotización r3','Perfil r1','Perfil r2','Perfil r3']);ax.set_yticks(range(len(conds)),[co[0]+{'valid':'','absent':' ausente','expired':' vencido','revoked':' revocado'}[co[1]] for co in conds]);ax.set_xticks(np.arange(-.5,6,1),minor=True);ax.set_yticks(np.arange(-.5,len(conds),1),minor=True);ax.grid(which='minor',color='black',lw=.5);ax.tick_params(which='minor',bottom=False,left=False)
for i in range(len(conds)):
 for j in range(6):ax.text(j,i,f'{matrix[i,j]:.4f} %'+(' ×' if matrix[i,j]<99.9 else ''),ha='center',va='center')
ax.set_title('Límite inferior de Wilson al 95 %: × indica menos de 99,9 %',fontsize=17,pad=15);fig.tight_layout();save(fig,'04-wilson','Completitud técnica por operación y repetición','Cada celda usa su propio numerador y denominador. El gris marca incumplimiento de 99,9 %; no se agregan corridas para superar el umbral.')

rs=[r for r in runs if sum(metric(r,op)['incomplete'] for op in ['quote','profile'])];fig,ax=plt.subplots(figsize=(12,6));y=np.arange(len(rs));ct=[sum(metric(r,op)['classifications']['technical_error'] for op in ['quote','profile']) for r in rs];extra=[sum(metric(r,op)['extraIncomplete'] for op in ['quote','profile']) for r in rs];ax.barh(y,ct,color='.6',edgecolor='black',label='Clasificación error técnico');ax.barh(y,extra,left=ct,color='white',edgecolor='black',hatch='///',label='Otra clasificación, pero no completa')
for i,(v,w) in enumerate(zip(ct,extra)):ax.text(v+w+2,i,str(v+w),va='center',fontsize=9)
ax.set_yticks(y,[r['label'] for r in rs]);ax.invert_yaxis();ax.set_xlabel('Solicitudes medidas no completas');ax.set_title('Fallos de completitud: el conteo incluye toda respuesta no completa',fontsize=16);ax.legend(loc='lower right');fig.tight_layout();save(fig,'05-incidencias','Respuestas no completas por corrida','La clasificación y la completitud son campos distintos. Las nueve respuestas adicionales de E09 r2 mantienen su clasificación original y se excluyen del numerador de completitud.')
rs=[r for r in runs if r['oldProbes'] or r['correctedProbes']];fig,ax=plt.subplots(figsize=(12,4.5));x=np.arange(len(rs));ax.bar(x-.18,[r['oldProbes'] for r in rs],width=.36,color='.65',edgecolor='black',label='Inicio de API (original)');ax.bar(x+.18,[r['correctedProbes'] for r in rs],width=.36,color='white',edgecolor='black',label='Instante de sondeo (corregido)')
for i,r in enumerate(rs):ax.text(i-.18,r['oldProbes']+.2,str(r['oldProbes']),ha='center');ax.text(i+.18,.2,str(r['correctedProbes']),ha='center')
ax.set_xticks(x,[r['label'] for r in rs]);ax.set_ylabel('Ventanas de tres sondeos en menos de 30 s');ax.set_ylim(0,max(r['oldProbes'] for r in rs)+4);ax.legend();ax.set_title('Auditoría del instante utilizado para contar sondeos',fontsize=17);fig.tight_layout();save(fig,'06-sondeos','Revisión de alertas de sondeos','Se cambia únicamente el instante de referencia en el análisis derivado. Los archivos originales y el resto de los criterios permanecen intactos.')
fig,axs=plt.subplots(1,2,figsize=(12,5),sharey=True)
for ax,op,title in zip(axs,['quote','profile'],['Cotización','Perfilamiento']):
 vals=[next(p['reduction']*100 for p in a['pairs'] if p['operation']==op and p['repetition']==rep and p['origin']=='measured') for rep in [1,2,3]];bars=ax.bar(np.arange(3),vals,width=.6,color='.65',edgecolor='black',label='T = inicio de caída y medición')
 for b in bars:ax.text(b.get_x()+b.get_width()/2,b.get_height()+.8,f'{b.get_height():.2f} %',ha='center',fontsize=10)
 ax.axhline(80,color='black',ls='--');ax.set_xticks(range(3),['Par r1','Par r2','Par r3']);ax.set_ylim(0,108);ax.set_title(title);ax.legend(fontsize=9,loc='lower right')
axs[0].set_ylabel('Reducción observada de recibos del proveedor (%)');fig.suptitle('E05 frente a E09: ventana [T+30 s, T+90 s)',fontsize=17);fig.tight_layout(rect=[0,0,1,.95]);save(fig,'07-comparacion','Comparación descriptiva E05/E09','La caída comienza después del calentamiento sano. Ningún par acredita aceptación formal: todas las E09 son inconclusas; se conservan sus fallos fuera y dentro de la ventana.')
fig,axs=plt.subplots(1,2,figsize=(12,5),sharey=True)
for ax,op,title in zip(axs,['quote','profile'],['Cotización','Perfilamiento']):
 for rep,ls in zip([1,2,3],['-','--',':']):
  gs=[g for g in a['recoveryGroups'] if g['label']==f'E06 r{rep}' and g['operation']==op and g['openedInConditioning']];ts=sorted(g['closes'][0]['t'] for g in gs if g['closes']);ax.step([0]+ts+[300],[0]+[(i+1)/len(gs)*100 for i in range(len(ts))]+[len(ts)/len(gs)*100],where='post',color='black',ls=ls,label=f'r{rep}: {len(ts)}/{len(gs)} grupos')
 ax.set_xlim(0,300);ax.set_ylim(0,105);ax.set_xlabel('Segundos desde restaurar el proveedor');ax.set_title(title);ax.legend(loc='lower right');ax.grid(alpha=.15)
axs[0].set_ylabel('Grupos acondicionados con cierre observado (%)');fig.suptitle('E06: cierre por isolate y operación',fontsize=17);fig.tight_layout(rect=[0,0,1,.95]);save(fig,'08-recuperacion','Cierre del circuito tras recuperación','El denominador contiene grupos con apertura registrada durante acondicionamiento y tráfico posterior. Ausencia de cierre observado no prueba por sí sola un circuito permanentemente abierto: puede cesar el tráfico del isolate.')
fig,ax=plt.subplots(figsize=(12,4.5));rows=sorted(a['recovery'],key=lambda x:(x['repetition'],x['operation']));labels=[x['label']+' '+('cot.' if x['operation']=='quote' else 'perf.') for x in rows];vals=[100*x['peakRatio'] for x in rows];bars=ax.bar(range(6),vals,color='.65',edgecolor='black');ax.axhline(110,color='black',ls='--',label='Límite 110 %');ax.set_xticks(range(6),labels);ax.set_ylabel('Pico / tasa previa observada (%)');ax.set_ylim(0,max(120,max(vals)+7));ax.set_title('E06: pico de recibos en ventanas móviles de 10 segundos',fontsize=17)
for b in bars:ax.text(b.get_x()+b.get_width()/2,b.get_height()+1,f'{b.get_height():.2f} %',ha='center')
ax.legend();fig.tight_layout();save(fig,'09-pico','Pico de llamadas durante recuperación','La tasa previa se mide en los 120 segundos sanos anteriores al acondicionamiento. La resolución de 10 segundos consta en run.json; se revisan ventanas móviles para evitar ocultar un pico entre bordes.')

for f in sorted((R/'resultados/capturas').glob('*.jpg')):
 figures.append({'file':str(f.relative_to(R)), 'kind':'Captura original de Cloudflare', 'title':f.stem})
(C/'figuras.json').write_text(json.dumps(figures,indent=2,ensure_ascii=False),encoding='utf-8');print('Figuras',len(figures))
