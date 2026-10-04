// Geometry-only audit of the actual runtime pose solver. Source-mask cache
// creation is omitted; joints, authored tracks and contact solving are unchanged.
// node check-source-constraints.js CONFIG.json SITE_DIRECTORY [OUTPUT.json]
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const input=process.argv[2],site=process.argv[3];
if(!input||!site)throw Error('Provide configuration file and runtime site directory');
const sandbox={window:{},Math};
vm.runInNewContext(fs.readFileSync(path.join(site,'rigs.js'),'utf8'),sandbox);
const source=JSON.parse(fs.readFileSync(input,'utf8'));
const result={method:'Actual OriginPortraitRig.pose sampled at 24 Hz through each complete authored cycle. Mask cache allocation omitted for this geometry-only diagnostic.',sampleRate:24,characters:{}};
for(const [identity,original] of Object.entries(source.characters)){
 const rig=Object.create(sandbox.window.OriginPortraitRig.prototype),config=JSON.parse(JSON.stringify(original));
 config.parts.layers.forEach(layer=>delete layer.excludeMasks);
 rig.config=config;rig.texture={naturalWidth:1024,naturalHeight:config.kind==='crew'?1536:1024};rig.atlas={};rig.buildMesh();
 const contacts=Object.fromEntries(rig.legs.map(leg=>[leg.name,{maxReachErrorPixels:0,maxRequestedPlantErrorPixels:0,maxErrorAt:0,unreachableRequestedPlantSamples:0,requestedPlantSamples:0}]));
 let minimumSupport=rig.legs.length,maximumHand=0,frames=0;
 const handConstraints={};
 for(let clock=0;clock<config.action.duration;clock+=1/24){
  const pose=rig.pose(clock);frames++;minimumSupport=Math.min(minimumSupport,pose.contacts.filter(contact=>contact.planted).length);
  for(const contact of pose.contacts){
   const record=contacts[contact.name],leg=rig.legs.find(leg=>leg.name===contact.name);
   if(contact.reachError>record.maxReachErrorPixels){record.maxReachErrorPixels=contact.reachError;record.maxErrorAt=clock;}
   const requestedPlant=Math.abs(contact.requestedFoot[1]-leg.foot[1])<.001*rig.imageHeight;
   if(requestedPlant){record.requestedPlantSamples++;record.maxRequestedPlantErrorPixels=Math.max(record.maxRequestedPlantErrorPixels,contact.reachError);if(contact.reachError>=.25)record.unreachableRequestedPlantSamples++;}
  }
  for(const hand of pose.handConstraints){
   maximumHand=Math.max(maximumHand,hand.reachError);
   handConstraints[hand.side]=Math.max(handConstraints[hand.side]||0,hand.reachError);
  }
 }
 result.characters[identity]={action:config.action.name,durationSeconds:config.action.duration,fit:config.action.fit,samples:frames,contactCount:rig.legs.length,minimumPlantedSupport:minimumSupport,contacts,maxHandReachErrorPixels:maximumHand,handConstraints,handMethod:config.action.hands&&Object.keys(config.action.hands).length?'Two-link target solving':'Authored parented forward-kinematic joints; no external hand target',layers:config.parts.layers.length,sourceImage:config.image};
}
const output=JSON.stringify(result,null,2)+'\n';
if(process.argv[4])fs.writeFileSync(process.argv[4],output);else process.stdout.write(output);
const bad=Object.values(result.characters).some(character=>character.maxHandReachErrorPixels>=.25||Object.values(character.contacts).some(contact=>contact.unreachableRequestedPlantSamples));
if(bad)process.exitCode=1;
