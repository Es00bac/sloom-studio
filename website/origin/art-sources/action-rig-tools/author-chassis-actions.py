# Source authoring recipe: read README.md before running; not a runtime build step.
import json
from pathlib import Path
P=Path(__file__).resolve().parents[2]/'rig-configs.json';d=json.loads(P.read_text())
for identity in ['scuttle','chime','skip','bastion']:
 c=d['characters'][identity]
 if not c.get('parts'):continue
 bones={b['name']:b for b in c['bones']};duration={'scuttle':9.0,'chime':10.5,'skip':9.8,'bastion':11.6}[identity];s=duration/10
 def track(frames):return [[round(t*s,4),*vals] for t,*vals in frames]
 travel={'scuttle':.085,'chime':.09,'skip':-.125,'bastion':-.085}[identity]
 name={'scuttle':'Eight-leg advance, inspect with pincers, withdraw','chime':'Unfold wings, climb, bank and tuck','skip':'Stalk, brace, cycle scythes and settle','bastion':'Heavy advance, crusher cycle, weight transfer and return'}[identity]
 clip={'name':name,'duration':duration,'fit':.83 if identity in ['scuttle','chime'] else .85,'root':[],'feet':{},'joints':{},'events':[]}
 if identity=='chime':
  clip['root']=track([[0,0,0,0],[.65,0,.017,-.035],[1.45,travel*.3,-.03,-.05],[2.5,travel*.75,-.105,.03],[3.6,travel,-.12,.075],[4.75,travel*.75,-.08,-.055],[6.0,travel*.35,-.045,-.075],[7.6,0,-.018,.025],[8.7,0,.004,0],[10,0,0,0]])
  for side,sign in [('left',1),('right',-1)]:
   for suffix,amount in [('spar',.30),('vane',.40),('lower_vane',.27)]:
    bone=f'wing_image_{side}_{suffix}'
    if bone not in bones:continue
    clip['joints'][bone]=track([[0,0],[.6,-sign*.055],[1.5,sign*amount],[2.3,-sign*amount*.7],[3.05,sign*amount*.9],[3.75,-sign*amount*.8],[4.4,sign*amount*.8],[5.1,-sign*amount*.6],[5.85,sign*amount*.7],[6.6,-sign*amount*.45],[7.55,sign*amount*.4],[8.6,0],[10,0]])
  for bone in bones:
   if bone.startswith('image_'):clip['joints'][bone]=track([[0,0],[1.5,.14],[2.5,.2],[5.5,.17],[7.7,.05],[9,0],[10,0]])
  clip['events']=[{'at':0,'phase':'anticipate wing extension'},{'at':1.5*s,'phase':'unfold and climb'},{'at':3.05*s,'phase':'bank / wingbeat'},{'at':6.6*s,'phase':'descend and tuck'},{'at':8.7*s,'phase':'settle'}]
 else:
  dip=.025 if identity=='bastion' else .02
  clip['root']=track([[0,0,0,0],[.5,-travel*.07,dip*.7,.025],[1.2,travel*.30,dip*.45,-.015],[2.2,travel*.73,dip,-.025],[2.75,travel,.009,-.03],[3.3,travel,dip,.035],[4.0,travel,dip*.65,-.028],[4.7,travel,.015,.027],[5.35,travel,.006,0],[6.15,travel*.75,dip*.5,.02],[7.15,travel*.25,dip,-.02],[8.0,0,.006,.01],[9.0,0,.003,0],[10,0,0,0]])
  for i,leg in enumerate(c['contacts']):
   cohort=i%2 if identity=='scuttle' else (i+(1 if 'rear' in leg['name'] else 0))%2
   first=.55+cohort*.65;offset=travel*(1.07 if cohort else .91);lift=.036 if identity!='skip' else .065
   if identity=='scuttle' and 'inner' in leg['name']:lift=.025
   ret=5.85+(1-cohort)*.72
   clip['feet'][leg['name']]=track([[0,0,0,0],[first,0,0,0],[first+.36,offset*.64,-lift,.08],[first+.8,offset,0,0],[ret,offset,0,0],[ret+.35,offset*.36,-lift*.85,-.06],[ret+.78,0,0,0],[10,0,0,0]])
  if identity=='scuttle':
   for side,sign in [('left',1),('right',-1)]:
    clip['joints']['pincer_image_'+side]=track([[0,0],[2.4,0],[2.95,-sign*.22],[3.35,sign*.25],[3.8,-sign*.18],[4.3,sign*.18],[4.9,0],[10,0]])
   clip['events']=[{'at':0,'phase':'load first four contacts'},{'at':.7*s,'phase':'alternating eight-leg advance'},{'at':2.95*s,'phase':'open and inspect with pincers'},{'at':5.85*s,'phase':'withdraw in alternating phases'},{'at':8.0*s,'phase':'settle'}]
  elif identity=='skip':
   for side,sign in [('left',1),('right',-1)]:
    for part,amount in [('upper',.18),('lower',.40),('tip',.23)]:
     clip['joints'][f'scythe_image_{side}_{part}']=track([[0,0],[2.3,-sign*.10],[2.9,-sign*amount],[3.55,sign*amount*.6],[4.1,-sign*amount*.45],[4.75,0],[10,0]])
    for part in ['upper','lower','tip']:
     bone=f'claw_image_{side}_{part}'
     if bone in bones:clip['joints'][bone]=track([[0,0],[2.4,sign*.10],[3.0,-sign*.24],[3.6,sign*.15],[4.5,0],[10,0]])
   clip['events']=[{'at':0,'phase':'low anticipation'},{'at':.7*s,'phase':'stalk and plant'},{'at':2.9*s,'phase':'raise / cycle scythes and small claws'},{'at':5.85*s,'phase':'step back into guard'},{'at':8.0*s,'phase':'settle'}]
  else:
   clip['joints']['crusher_jaw']=track([[0,0],[2.3,0],[2.95,-.22],[3.5,.20],[3.9,-.18],[4.45,.15],[5.1,0],[10,0]])
   clip['events']=[{'at':0,'phase':'load heavy frame'},{'at':.7*s,'phase':'advance with four contact phases'},{'at':2.95*s,'phase':'open crusher'},{'at':3.5*s,'phase':'close and brace'},{'at':5.85*s,'phase':'withdraw and transfer weight'},{'at':8.0*s,'phase':'settle'}]
 for bone in bones:
  if 'cable' in bone:clip['joints'][bone]=track([[0,0],[1.45,-.06],[2.8,.09],[4.3,-.05],[5.4,0],[6.8,.07],[8.5,0],[10,0]])
 clip['description']='Authored illustrated machine action. Rigid pieces retain material shape; visible limbs have individual swing/plant phases. Flight has no fictitious ground contacts.'
 c['action']=clip;c['bodyAngle']=.0015;c['shift']=[.0004,.0005]
 for b in c['bones']:
  if not b.get('_authoredIdleReduced'):b['amplitude']*=.3;b['_authoredIdleReduced']=True
P.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
