#!/usr/bin/env python3
"""Read atlas alpha and write source rect/socket and original bind fit sidecars.

Pixels are never modified. Rects and socket stations are visually selected;
alpha bounds and socket cross-section centers are measured from the selected PNG.
"""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPECS = json.loads((ROOT / 'art-sources/crew-atlas-measurement-specs.json').read_text())
SPECS.update(json.loads((ROOT / 'art-sources/crew-atlas-measurement-specs-extra.json').read_text()))
LANDMARKS = json.loads((ROOT / 'assets/illustrated/crew-rig-landmarks.json').read_text())['characters']
TMP = Path('/tmp/origin-actions')
TMP.mkdir(exist_ok=True)

def socket_center(alpha, x_fraction, y_fraction):
    """Measured alpha-weighted socket center in a narrow horizontal strip."""
    width, height = alpha.size
    if not 0 <= y_fraction <= 1:
        return [x_fraction, y_fraction]
    y = max(0, min(height - 1, round(y_fraction * height)))
    for radius in (2, 5, 10):
        y0, y1 = max(0, y-radius), min(height, y+radius+1)
        strip = alpha.crop((0, y0, width, y1))
        weights = [0] * width
        for i, value in enumerate(strip.get_flattened_data()):
            if value > 64:
                weights[i % width] += value
        total = sum(weights)
        if total:
            x = sum(i*value for i, value in enumerate(weights)) / total / width
            return [round(x, 6), round(y / height, 6)]
    return [x_fraction, y_fraction]

def mid(a, b):
    return [(a[0]+b[0])*.5, (a[1]+b[1])*.5]

def export(character):
    spec = SPECS[character]
    ref = LANDMARKS[character]['landmarks']
    png_rel = f'art-sources/crew-{character}-rig-atlas.png'
    png = ROOT / png_rel
    image = Image.open(png)
    alpha = image.getchannel('A')
    foot = spec.get('footKind', 'boot')
    names = ['head','torso','pelvis','left-upper-arm','left-forearm','left-hand',
             'right-upper-arm','right-forearm','right-hand','left-thigh','left-shin',
             f'left-{foot}','right-thigh','right-shin',f'right-{foot}']
    if spec['tailMode'] == 'short':
        names += ['tail-tuft']
    else:
        names += ['tail-base','tail-middle','tail-tip']
    names += spec.get('extraParts', [])
    layers = []
    fits = {}
    for index, (part, rect) in enumerate(zip(names, spec['rects'])):
        x,y,width,height = rect
        crop = alpha.crop((x,y,x+width,y+height))
        bounds = crop.getbbox()
        visible = crop.point(lambda value: 255 if value > 64 else 0).getbbox()
        pivot, end, bind, bind_end = [.5,.13], [.5,.88], None, None
        order, contact, align = 4, None, True
        if part == 'head':
            bone='head'; pivot=[spec.get('headX',.5),spec.get('headPivot',.95)]
            end=[.5,.45]; bind=ref['neck']; bind_end=ref['head']
            size=spec['head']; order=5; align=False
        elif part == 'torso':
            bone='spine'; pivot=[.5,spec['torsoPivot']]; end=[.5,.13]
            bind=ref['hips']; bind_end=ref['neck']; size=spec['torso']; order=2; align=False
        elif part == 'pelvis':
            bone='pelvis'; pivot=[.5,spec['pelvisPivot']]; end=[.5,.80]
            bind=[ref['hips'][0],ref['hips'][1]-.028]; size=spec['pelvis']; order=3; align=False
        elif part == 'tail-tuft':
            bone='pelvis'; pivot=[.5,.18]; end=[.5,.82]
            bind=[ref['hips'][0],ref['hips'][1]+.025]; size=[.10,.055]; order=0; align=False
        elif part.startswith('tail-'):
            tail_index=['tail-base','tail-middle','tail-tip'].index(part)
            joints=[ref['tailRoot'],mid(ref['tailRoot'],ref['tailMid']),ref['tailMid'],ref['tailTip']]
            bone=['tail-root','tail-middle','tail-tip'][tail_index]
            pivot,end=spec['tailAxes'][tail_index]; bind,bind_end=joints[tail_index:tail_index+2]
            size=[.23,.20]; order=0
        elif part.endswith('-ear'):
            side=spec['extraBoneSides'][part]
            bone=f'ear-{side}'; pivot,end=spec['extraAxes'][part]
            bind=ref[f'ear{side}Root']; bind_end=ref[f'ear{side}Tip']
            size=[.15,.23]; order=4
        elif 'gill' in part:
            side,number=spec['extraBoneSides'][part]
            bone=f'gill-{side}-{number}'; pivot,end=spec['extraAxes'][part]
            bind=ref[f'gill{side}{number}Root']; bind_end=ref[f'gill{side}{number}Tip']
            size=[.16,.13]; order=4
        else:
            side='R' if part.startswith('left-') else 'L'
            if 'upper-arm' in part:
                bone=f'upper-arm-{side}'; bind=ref[f'shoulder{side}']; bind_end=ref[f'elbow{side}']
                size=[.16,.17]; pivot=[.5,.16]; end=[.5,.87]
            elif 'forearm' in part:
                bone=f'forearm-{side}'; bind=ref[f'elbow{side}']; bind_end=spec['wrist'][side]
                size=[.11,.16]; pivot=[.5,.12]; end=[.5,.86]; order=6
            elif 'hand' in part:
                bone=f'forearm-{side}'; bind=spec['wrist'][side]; bind_end=ref[f'hand{side}']
                size=[.10,.11]; pivot=[.5,.19]; end=[.5,.78]; order=7
            elif 'thigh' in part:
                bone=f'thigh-{side}'; bind=ref[f'hip{side}']; bind_end=ref[f'knee{side}']
                size=[.18,.19]; pivot=[.5,.13]; end=[.5,.88]; order=4
            elif 'shin' in part:
                bone=f'shin-{side}'; bind=ref[f'knee{side}']; bind_end=ref[f'ankle{side}']
                size=[.13,.18]; pivot=[.5,.13]; end=[.5,.88]; order=4
            else:
                bone=f'shin-{side}'; bind=ref[f'ankle{side}']; bind_end=ref[f'foot{side}']
                size=spec['boot']; pivot=[.5,.20]; end=[.5,.89]
                contact=f'foot-{side}'; order=5; align=False
        if part not in spec.get('fixedAxes', []) and not part.startswith('tail-') and not part.endswith('-ear') and 'gill' not in part:
            pivot=socket_center(crop,*pivot)
            end=socket_center(crop,*end)
        layer=dict(part=part,row=index//3,column=index%3,bone=bone,rect=rect,
                   pivot=pivot,end=end,bindPivot=bind,size=size,order=order,alignAxis=align,
                   alphaBoundsLocalPixels=list(bounds) if bounds else None,
                   alphaBoundsVisibleLocalPixels=list(visible) if visible else None,
                   alphaBoundsAtlasPixels=[x+bounds[0],y+bounds[1],x+bounds[2],y+bounds[3]] if bounds else None,
                   socketAxisAtlasPixels=[[round(x+pivot[0]*width,2),round(y+pivot[1]*height,2)],
                                          [round(x+end[0]*width,2),round(y+end[1]*height,2)]])
        if bind_end:
            layer['bindEnd']=bind_end
        if contact:
            layer['contact']=contact
        if align:
            layer['fitToBone']=True
        if part.startswith('tail-') and part != 'tail-tuft' or part.endswith('-ear') or 'gill' in part:
            layer['fitUniform']=True
            layer.pop('fitToBone',None)
        layers.append(layer)
        if not align:
            keys=['size','pivot','bindPivot','alignAxis','order','contact']
            fits[part]={key:layer[key] for key in keys if key in layer}
    manifest=dict(schemaVersion=1,character=character,image=f'assets/illustrated/crew-{character}-rig-atlas.webp',
                  sourcePng=png_rel,dimensions=list(image.size),layout=dict(columns=3,rows=spec['rows']),
                  coordinateSpace=dict(rect='Atlas pixels [x,y,width,height]',pivot='Normalized within source rect',
                                       bindPivot='Normalized original1024x1536 reference',sideConvention='Anatomical left maps existing image-side R, right maps L'),
                  method='Actual visually selected part rects; measured alpha bounds and socket cross-section centers. Tail/ear/gill axes individually visually estimated.',
                  notes=spec.get('notes',[])+['Boot/foot proximal pivot is the upper ankle/cuff; separate contact transform follows ground pose.',
                                            'Forearm bindEnd is actual wrist, shin bindEnd actual ankle, not hand/foot helper end.',
                                            'Head/torso/pelvis use original proportion overrides and never fit to short helper bone vectors.'],
                  layers=layers)
    path=ROOT/f'assets/illustrated/crew-{character}-atlas-parts.json'
    path.write_text(json.dumps(manifest,indent=2)+'\n')
    fit=dict(schemaVersion=1,character=character,coordinateSpace='Normalized original1024x1536 reference; pivots local to atlas source rect.',
             nonSegmentParts=['head','torso','pelvis'],layers=fits,
             notes=['Reference-proportion fit overrides. Retain fixed body/head sizes rather than scaling to helper bone length.',
                    'Initial bind fit; website owns reconstructed action and silhouette inspection.'])
    source_fit=ROOT/f'art-sources/crew-{character}-fit.json'
    source_fit.write_text(json.dumps(fit,indent=2)+'\n')
    shutil.copyfile(source_fit,TMP/f'{character}-fit.json')
    print(json.dumps(dict(character=character,parts=len(layers),manifest=str(path),fit=str(TMP/f'{character}-fit.json'))),flush=True)

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('characters',nargs='*')
    args=parser.parse_args()
    for character in args.characters or SPECS:
        export(character)
