# Source authoring recipe: read README.md before running; not a runtime build step.
import json,copy,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
P=ROOT/'rig-configs.json';data=json.loads(P.read_text());base=json.loads(subprocess.check_output(['git','show','246fdba:website/origin/rig-configs.json'],cwd=ROOT.parent.parent).decode())
for identity in ['cyberpengu','ducke','cache','mochi','hex','patches','axi']:
 side=ROOT/f'assets/illustrated/crew-{identity}-atlas-parts.json'
 if not side.exists():continue
 manifest=json.loads(side.read_text());c=data['characters'][identity];c['bones']=copy.deepcopy(base['characters'][identity]['bones']);c['contacts']=copy.deepcopy(base['characters'][identity]['contacts']);layers=copy.deepcopy(manifest['layers']);bones={b['name']:b for b in c['bones']}
 fitpaths=[ROOT/f'art-sources/crew-{identity}-fit.json']
 fit=next((json.loads(f.read_text()) for f in fitpaths if f.exists()),{})
 for layer in layers:
  key=layer.get('part',layer.get('id'));layer['alignAxis']=False if key in ['head','torso','pelvis'] or layer.get('contact') else True
  layer.update(fit.get('layers',{}).get(key,{}))
  if key.endswith('-hand'):layer['bone']='hand-'+('R' if key.startswith('left-') else 'L')
  if key=='tail-tuft':layer['bone']='tail-short'
  name=layer['bone']
  if name not in bones and not name.startswith(('hand-','tail-')):
   parent=layer.get('parent','head' if name.startswith(('ear','gill','tuft')) else 'pelvis');q=layer['bindPivot'];b={'name':name,'parent':parent,'pivot':q,'end':layer.get('bindEnd',[q[0],q[1]+.06]),'radius':.1,'amplitude':.014,'phase':1,'frequency':1};c['bones'].append(b);bones[name]=b
  if name.startswith(('upper-arm-','forearm-','thigh-','shin-')):
   layer['fitToBone']=True
   if layer.get('bindEnd'):bones[name]['end']=layer['bindEnd'][:]
   if layer.get('bindPivot'):bones[name]['pivot']=layer['bindPivot'][:]
   if name.startswith('thigh-'):layer['order']=4
  if name.startswith('hand-'):
   layer['fitUniform']=True
   sideid=name[-1];wrist=layer['bindPivot'];forearm=bones['forearm-'+sideid];forearm['end']=wrist[:]
   if name not in bones:
    b={'name':name,'parent':forearm['name'],'pivot':wrist[:],'end':layer.get('bindEnd',[wrist[0]+(-.014 if sideid=='L' else .014),wrist[1]+.07]),'radius':.07,'amplitude':.005,'phase':.2,'frequency':1};c['bones'].append(b);bones[name]=b
   else:bones[name]['pivot']=wrist[:]
  if layer.get('contact'):
   leg=next(l for l in c['contacts'] if l['name']==layer['contact']);leg['ankle']=layer['bindPivot'][:];bones[leg['lower']]['end']=leg['ankle'][:]
  if name.startswith('tail-'):
   layer['fitUniform']=name!='tail-short'
   if name=='tail-short':layer['alignAxis']=False
   if name not in bones:
    parent='tail-root' if name=='tail-middle' else 'pelvis';b={'name':name,'parent':parent,'pivot':layer['bindPivot'],'end':layer.get('bindEnd',[layer['bindPivot'][0]-.12,layer['bindPivot'][1]+.045]),'radius':.12,'amplitude':.02,'phase':1.2,'frequency':1};c['bones'].append(b);bones[name]=b
   bones[name]['pivot']=layer['bindPivot'][:]
   if layer.get('bindEnd'):bones[name]['end']=layer['bindEnd'][:]
   if name=='tail-short':bones[name]['end']=[layer['bindPivot'][0],layer['bindPivot'][1]+.08]
   if name=='tail-middle' and 'tail-tip' in bones:bones['tail-tip']['parent']='tail-middle'
 ordered=[];visited=set()
 def visit(b):
  if b['name'] in visited:return
  if b.get('parent') in bones:visit(bones[b['parent']])
  visited.add(b['name']);ordered.append(b)
 for b in c['bones']:visit(b)
 c['bones']=ordered
 keys=['part','id','bone','rect','pivot','end','anchorEnd','bindPivot','bindEnd','size','order','contact','alignAxis','fitToBone','fitUniform']
 layers=[{key:value for key,value in layer.items() if key in keys} for layer in layers]
 c['parts']={'image':manifest['image'],'layers':layers,'source':str(side.relative_to(ROOT))}
 print('assembled',identity,len(layers),'parts')
P.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
