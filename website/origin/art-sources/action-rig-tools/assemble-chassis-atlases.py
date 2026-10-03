# Source authoring recipe: read README.md before running; not a runtime build step.
import json,copy,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];P=ROOT/'rig-configs.json';D=json.loads(P.read_text());B=json.loads(subprocess.check_output(['git','show','246fdba:website/origin/rig-configs.json'],cwd=ROOT.parent.parent).decode())
for identity in ['scuttle','chime','skip','bastion']:
 source=ROOT/f'art-sources/{identity}-layered-atlas.json'
 if not source.exists():continue
 manifest=json.loads(source.read_text());c=D['characters'][identity];layers=copy.deepcopy(manifest['layers']);c['bones']=copy.deepcopy(B['characters'][identity]['bones']);c['contacts']=copy.deepcopy(B['characters'][identity]['contacts']);bones={b['name']:b for b in c['bones']}
 for layer in layers:
  name=layer['bone'];part=layer.get('id',layer.get('part',''));
  if 'claw_tip' in part:
   name=name.replace('_lower','_tip');layer['bone']=name
  isFoot=part.endswith('_foot');layer['end']=layer.get('anchorEnd',layer.get('end'));isCore=part=='core' or name=='chassis' and not layer.get('contact');layer['alignAxis']=False if isCore or layer.get('contact') or layer.get('alignAxis') is False else True
  if name not in bones:
   parent=layer.get('parent') or name.rsplit('_',1)[0]+'_lower' if name.endswith(('_tip','_foot')) else 'chassis'
   if parent not in bones:parent='chassis'
   q=layer['bindPivot'];b={'name':name,'parent':parent,'pivot':q[:],'end':layer.get('bindEnd',[q[0],q[1]+.06]),'radius':.08,'amplitude':.01,'phase':.5,'frequency':1};c['bones'].append(b);bones[name]=b
  if not isCore and not isFoot and not layer.get('contact'):
   bones[name]['pivot']=layer['bindPivot'][:]
   if layer.get('bindEnd'):bones[name]['end']=layer['bindEnd'][:]
  if layer.get('contact'):
   leg=next((l for l in c['contacts'] if l['name']==layer['contact']),None)
   if leg:
    # Machine toe layers use the artist's sole-contact pivot; ankle is separate.
    leg['foot']=layer['bindPivot'][:]
    if layer.get('bindAnkle'):leg['ankle']=layer['bindAnkle'][:]
  layer['fitUniform']=not isCore and not bool(layer.get('contact')) and layer['alignAxis'] is not False
 for leg in c['contacts']:
  leg['hip']=bones[leg['upper']]['pivot'][:];leg['knee']=bones[leg['lower']]['pivot'][:]
  leg['ankle']=bones[leg['lower']]['end'][:]
 ordered=[];visited=set()
 def visit(b):
  if b['name'] in visited:return
  if b.get('parent') in bones:visit(bones[b['parent']])
  visited.add(b['name']);ordered.append(b)
 for b in c['bones']:visit(b)
 c['bones']=ordered
 keys=['part','id','bone','rect','pivot','end','bindPivot','bindEnd','size','order','contact','alignAxis','fitToBone','fitUniform']
 c['parts']={'image':manifest.get('image',f'assets/illustrated/chassis-{identity}-atlas.webp'),'layers':[{k:v for k,v in l.items() if k in keys} for l in layers],'source':str(source.relative_to(ROOT))}
 print('assembled',identity,len(layers),'parts')
P.write_text(json.dumps(D,ensure_ascii=False,indent=2)+'\n')
