# Source authoring recipe: read README.md before running; not a runtime build step.
import json, math
from pathlib import Path
P=Path(__file__).resolve().parents[2]/'rig-configs.json'
data=json.loads(P.read_text())
profiles={
 'cyberpengu': dict(name='Advance, check shoulder strap, acknowledge',duration=10.2,travel=.10,first='R',lift=.038,style='signal'),
 'ducke': dict(name='Listen, acknowledge, step into ready stance',duration=10.8,travel=.105,first='L',lift=.037,style='listen'),
 'cache': dict(name='Plant, check belt pouch and shoulder strap',duration=11.1,travel=.075,first='R',lift=.035,style='pouch'),
 'mochi': dict(name='Quick sidestep, scan, protective ready stance',duration=9.6,travel=-.11,first='L',lift=.046,style='brace'),
 'hex': dict(name='Low sidestep, look back, check gauntlet',duration=10.0,travel=-.12,first='L',lift=.043,style='look'),
 'patches': dict(name='Widen stance, inspect gauntlet, settle',duration=11.8,travel=.035,first='R',lift=.034,style='gauntlet'),
 'axi': dict(name='Careful sidestep, glove check, survey',duration=11.2,travel=-.085,first='L',lift=.039,style='glove'),
}
for identity,p in profiles.items():
 c=data['characters'][identity]
 if not c.get('parts'):continue
 bones={b['name']:b for b in c['bones']};neck=bones['head']['pivot'];hip=bones['pelvis']['pivot'];duration=p['duration'];scale=duration/10
 def track(frames):return [[round(t*scale,4),*values] for t,*values in frames]
 travel=p['travel'];style=p['style'];dip=.025 if style in ['pouch','gauntlet','look'] else .012
 c['action']={'name':p['name'],'duration':duration,'fit':.88,'events':[
  {'at':0,'phase':'anticipate'},{'at':round(.75*scale,3),'phase':'first foot swing'},
  {'at':round(1.45*scale,3),'phase':'transfer weight and follow'},
  {'at':round(2.8*scale,3),'phase':style+' gesture'},
  {'at':round(5.0*scale,3),'phase':'release gesture'},
  {'at':round(6.2*scale,3),'phase':'return foot placements'},
  {'at':round(8.6*scale,3),'phase':'ready and settle'}],
 'root':track([[0,0,0,0],[.45,-travel*.07,dip*.55,-.018],[.8,0,dip*.8,-.022],[1.35,travel*.46,.009,-.025],[2.1,travel,dip,-.025],[2.5,travel,.009,0],[3.25,travel,dip,.028 if style=='listen' else -.027],[4.2,travel,dip*.85,.016],[5.35,travel,.006,0],[6.0,travel*.75,.009,.019],[6.85,travel*.33,.007,.015],[7.65,0,.014,0],[8.65,0,.003,0],[10,0,0,0]]),
 'feet':{},'joints':{},'hands':{}}
 for leg in c['contacts']:
  side=leg['name'].split('-')[-1];first=side==p['first'];start=.68 if first else 1.28;end=start+.72
  reach=travel*(.96 if first else 1.12)
  if style=='gauntlet':reach= -.05 if side=='L' else .074
  back=6.08 if not first else 6.85
  c['action']['feet'][leg['name']]=track([[0,0,0,0],[start,0,0,0],[start+.34,reach*.62,-p['lift'],.09 if first else -.07],[end,reach,0,0],[back,reach,0,0],[back+.34,reach*.3,-p['lift']*.9,-.08 if first else .06],[back+.72,0,0,0],[10,0,0,0]])
 rest={side:bones['forearm-'+side]['end'][:] for side in ['L','R']}
 nx,ny=neck;hx,hy=hip
 if style=='signal': targets={'R':[(nx+.13,ny+.035),(nx+.21,ny+.025),(nx+.13,ny+.055)],'L':[(hx-.13,hy-.05),(hx-.12,hy-.035),(hx-.13,hy-.05)]}
 elif style=='listen': targets={'R':[(nx+.15,ny+.005),(nx+.15,ny-.008),(nx+.23,ny+.045)],'L':[(hx-.19,hy-.025),(hx-.17,hy-.01),(hx-.18,hy-.03)]}
 elif style=='pouch': targets={'L':[(hx-.15,hy-.005),(hx-.17,hy+.015),(hx-.12,hy-.012)],'R':[(hx+.06,hy-.10),(nx+.10,ny+.11),(nx+.08,ny+.12)]}
 elif style=='brace': targets={'L':[(nx-.12,ny+.13),(nx-.15,ny+.105),(nx-.14,ny+.12)],'R':[(nx+.18,ny+.12),(nx+.21,ny+.10),(nx+.19,ny+.14)]}
 elif style=='look': targets={'L':[(hx-.035,hy-.11),(hx-.06,hy-.12),(hx-.035,hy-.10)],'R':[(hx-.015,hy-.20),(hx+.005,hy-.18),(hx-.02,hy-.18)]}
 elif style=='gauntlet': targets={'L':[(hx-.12,hy-.08),(hx-.13,hy-.09),(hx-.12,hy-.08)],'R':[(hx-.095,hy-.17),(hx-.12,hy-.15),(hx-.10,hy-.16)]}
 else: targets={'L':[(hx-.04,hy-.06),(hx-.045,hy-.065),(hx-.03,hy-.06)],'R':[(hx-.015,hy-.125),(hx-.025,hy-.13),(hx-.015,hy-.125)]}
 for side in ['L','R']:
  a,b,d=targets[side];x,y=rest[side]
  c['action']['hands'][side]=track([[0,x,y],[2.45,x,y],[3.2,*a],[3.85,*b],[4.45,*d],[5.35,x,y],[10,x,y]])
 c['action']['joints']['head']=track([[0,0],[.55,-.09],[1.8,-.04],[2.7,.11 if style in ['listen','look'] else .05],[3.4,.12 if style=='listen' else .085],[4.3,-.06],[5.35,0],[7.5,-.025],[8.8,0],[10,0]])
 c['action']['joints']['spine']=track([[0,0],[.6,-.026],[2.1,.015],[3.25,.025],[4.35,-.018],[5.35,0],[6.5,.025],[8.7,0],[10,0]])
 for side in ['L','R']:
  if 'hand-'+side in bones:c['action']['joints']['hand-'+side]=track([[0,0],[2.4,0],[3.25,.11 if side=='L' else -.15],[3.85,-.08 if side=='L' else .10],[4.45,.05],[5.35,0],[10,0]])
 for name in bones:
  if name.startswith(('tail-','ear-','gill-')):
   order=2 if name.endswith(('tip','lower')) else 1;sign=-1 if name.endswith('R') else 1;amplitude=.08 if name.startswith('gill') else .12
   c['action']['joints'][name]=track([[0,0],[.9,sign*amplitude*.7],[2.2,0],[3.3+order*.14,-sign*amplitude],[4.45+order*.14,sign*amplitude*.65],[5.6,0],[6.9,sign*amplitude],[8.7,0],[10,0]])
 c['action']['description']='Authored illustrated-cast choreography, not a demonstration of gameplay abilities. Empty-handed gear checks and gestures; individual foot swing/plant phases.'
 c['bodyAngle']=.0015;c['shift']=[.0004,.0005]
 for b in c['bones']:
  if not b.get('_authoredIdleReduced'):
   b['amplitude']*=.35;b['_authoredIdleReduced']=True
# Structural flags are removed from runtime after final assembly.
P.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
