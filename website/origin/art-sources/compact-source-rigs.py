import json,math,sys
from pathlib import Path

def compact_config(config):
 width,height=(1024,1536) if config['kind']=='crew' else (1024,1024)
 for layer in config.get('parts',{}).get('layers',[]):
  if layer.get('sourceCrop') or not layer.get('mask') or layer['rect']!=[0,0,width,height] or layer['size']!=[1,1]:continue
  poly=layer['mask'];x0=max(0,math.floor(min(p[0] for p in poly)*width)-2);y0=max(0,math.floor(min(p[1] for p in poly)*height)-2);x1=min(width,math.ceil(max(p[0] for p in poly)*width)+2);y1=min(height,math.ceil(max(p[1] for p in poly)*height)+2)
  sw=x1-x0;sh=y1-y0
  if sw<1 or sh<1:raise ValueError('Empty source layer '+layer['part'])
  remap=lambda p:[(p[0]*width-x0)/sw,(p[1]*height-y0)/sh]
  layer['rect']=[x0,y0,sw,sh];layer['pivot']=remap(layer['pivot']);layer['size']=[sw/width,sh/height];layer['mask']=[remap(p) for p in poly]
  layer['excludeMasks']=[[remap(p) for p in polygon] for polygon in layer.get('excludeMasks',[])];layer['sourceCrop']={'method':'Exact bounding crop of original normalized mask + 2px antialias margin; source image unchanged','originalImageSize':[width,height]}
 return config
if __name__=='__main__':
 source=Path(sys.argv[1]);target=Path(sys.argv[2]) if len(sys.argv)>2 else source;data=json.loads(source.read_text());ids=sys.argv[3].split(',') if len(sys.argv)>3 else list(data['characters'])
 for identity in ids:compact_config(data['characters'][identity])
 target.write_text(json.dumps(data,indent=2)+'\n');print('Compacted exact source layers for',','.join(ids))
