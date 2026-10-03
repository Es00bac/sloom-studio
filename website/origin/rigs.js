"use strict";
// Authored Canvas 2D action rigs: rigid painted atlas parts on parented bones,
// wrist targets and individual swing/plant contacts with two-link IK.
// A weighted textured mesh remains available for configurations without parts.
(()=>{
const I=()=>[1,0,0,1,0,0];
const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const transform=(m,p)=>[m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]];
const rotation=(p,a)=>{const c=Math.cos(a),s=Math.sin(a);return[c,s,-s,c,p[0]-c*p[0]+s*p[1],p[1]-s*p[0]-c*p[1]];};
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const rigidMap=(a,b,c,d)=>{const angle=Math.atan2(d[1]-c[1],d[0]-c[0])-Math.atan2(b[1]-a[1],b[0]-a[0]);const cosine=Math.cos(angle),sine=Math.sin(angle);return[cosine,sine,-sine,cosine,c[0]-cosine*a[0]+sine*a[1],c[1]-sine*a[0]-cosine*a[1]];};
function segmentDistance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],n=dx*dx+dy*dy;const t=n?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/n)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
function solveLeg(hip,knee,foot,posedHip,posedFoot=foot){
  const l1=distance(hip,knee),l2=distance(knee,foot),length=distance(posedHip,posedFoot);
  const reach=Math.max(.001,Math.min(l1+l2-.001,length));
  const direction=Math.atan2(posedFoot[1]-posedHip[1],posedFoot[0]-posedHip[0]);
  const cos=Math.max(-1,Math.min(1,(l1*l1+reach*reach-l2*l2)/(2*l1*reach)));
  const side=((foot[0]-hip[0])*(knee[1]-hip[1])-(foot[1]-hip[1])*(knee[0]-hip[0]))>=0?1:-1;
  const angle=direction+side*Math.acos(cos),posedKnee=[posedHip[0]+Math.cos(angle)*l1,posedHip[1]+Math.sin(angle)*l1];
  return {upper:rigidMap(hip,knee,posedHip,posedKnee),lower:rigidMap(knee,foot,posedKnee,posedFoot),knee:posedKnee,foot:posedFoot};
}
function sampleTrack(frames,time){
  if(!frames?.length)return[];
  if(time<=frames[0][0])return frames[0].slice(1);
  for(let index=1;index<frames.length;index++)if(time<=frames[index][0]){
    const from=frames[index-1],to=frames[index],u=(time-from[0])/(to[0]-from[0]),ease=u*u*(3-2*u);
    return from.slice(1).map((value,column)=>value+((to[column+1]??value)-value)*ease);
  }
  return frames.at(-1).slice(1);
}
function affine(source,destination){
  const [p0,p1,p2]=source,[q0,q1,q2]=destination;
  const sx1=p1[0]-p0[0],sy1=p1[1]-p0[1],sx2=p2[0]-p0[0],sy2=p2[1]-p0[1],det=sx1*sy2-sx2*sy1;
  const dx1=q1[0]-q0[0],dy1=q1[1]-q0[1],dx2=q2[0]-q0[0],dy2=q2[1]-q0[1];
  const a=(dx1*sy2-dx2*sy1)/det,b=(dy1*sy2-dy2*sy1)/det,c=(dx2*sx1-dx1*sx2)/det,d=(dy2*sx1-dy1*sx2)/det;
  return[a,b,c,d,q0[0]-a*p0[0]-c*p0[1],q0[1]-b*p0[0]-d*p0[1]];
}
class OriginPortraitRig{
 constructor(canvas,config){
  this.canvas=canvas;this.context=canvas.getContext("2d");this.config=config;this.paused=false;this.active=false;this.inView=false;this.documentVisible=!document.hidden;this.frameId=null;this.lastFrame=0;this.clock=0;this.epoch=performance.now();this.loaded=false;
  this.ready=new Promise((resolve,reject)=>{
   const finish=()=>{this.buildMesh();this.loaded=true;canvas.dataset.boneCount=this.bones.length;canvas.dataset.triangleCount=this.triangles.length;this.resize();this.draw(0);this.manage();resolve(this);};
   const texture=new Image();texture.onload=()=>{this.texture=texture;if(config.parts?.image){const atlas=new Image();atlas.onload=()=>{this.atlas=atlas;finish();};atlas.onerror=()=>reject(Error(`Missing articulated atlas: ${config.parts.image}`));atlas.src=config.parts.image;}else finish();};texture.onerror=()=>reject(Error(`Missing illustrated rig texture: ${config.image}`));texture.src=config.image;
  });
  if("IntersectionObserver" in window)this.visibilityObserver=new IntersectionObserver(entries=>{this.inView=entries[0].isIntersecting;this.manage();},{rootMargin:"80px",threshold:0});
  if(this.visibilityObserver)this.visibilityObserver.observe(canvas);else this.inView=true;
  if("ResizeObserver" in window){this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);}
 }
 buildMesh(){
  const w=this.texture.naturalWidth,h=this.texture.naturalHeight,point=p=>[p[0]*w,p[1]*h];this.imageWidth=w;this.imageHeight=h;
  this.bones=this.config.bones.map(b=>({...b,pivot:point(b.pivot),end:point(b.end),radius:b.radius*Math.min(w,h)}));
  this.boneIndex=Object.fromEntries(this.bones.map((bone,index)=>[bone.name,index]));
  this.legs=(this.config.contacts||[]).map(leg=>({...leg,hip:point(leg.hip),knee:point(leg.knee),foot:point(leg.foot),ankle:point(leg.ankle||leg.foot)}));
  this.columns=18;this.rows=26;this.vertices=[];this.triangles=[];
  if(this.atlas)return;
  for(let row=0;row<=this.rows;row++)for(let column=0;column<=this.columns;column++){
   const p=[w*column/this.columns,h*row/this.rows];
   let influences=this.bones.map((bone,index)=>({bone:index,value:Math.exp(-Math.pow(segmentDistance(p,bone.pivot,bone.end)/bone.radius,2)*3)})).sort((a,b)=>b.value-a.value).slice(0,3);
   const contact=this.legs.find(leg=>distance(p,leg.foot)<Math.min(w,h)*.045);
   if(contact)influences=[{bone:this.boneIndex[contact.lower],value:1}];
   const sum=influences.reduce((total,item)=>total+item.value,0)||1;
   const contactIndex=this.legs.map((leg,index)=>({leg,index})).filter(({leg})=>p[1]>=leg.ankle[1]-h*.01&&Math.abs(p[0]-leg.foot[0])<w*(leg.pinWidth||.08)).sort((a,b)=>distance(p,a.leg.foot)-distance(p,b.leg.foot))[0]?.index;
   this.vertices.push({bind:p,pinned:contactIndex!==undefined,contactIndex,weights:influences.map(item=>({bone:item.bone,weight:item.value/sum}))});
  }
  const mask=document.createElement("canvas");mask.width=this.columns*4;mask.height=this.rows*4;const maskContext=mask.getContext("2d",{willReadFrequently:true});maskContext.drawImage(this.texture,0,0,mask.width,mask.height);const pixels=maskContext.getImageData(0,0,mask.width,mask.height).data;
  for(let row=0;row<this.rows;row++)for(let col=0;col<this.columns;col++){
   let occupied=false;for(let y=0;y<4;y++)for(let x=0;x<4;x++)if(pixels[((row*4+y)*mask.width+col*4+x)*4+3]>2)occupied=true;
   if(!occupied)continue;const a=row*(this.columns+1)+col,b=a+1,c=a+this.columns+1,d=c+1;this.triangles.push([a,b,d],[a,d,c]);
  }
 }
 pose(time){
  const phase=time*2*Math.PI/this.config.cycle,w=this.imageWidth,h=this.imageHeight;
  const clip=this.config.action,clipTime=clip?time%clip.duration:time,authored=sampleTrack(clip?.root,clipTime);
  const rootBone=this.bones[0],rootMatrix=rotation(rootBone.pivot,Math.sin(phase)*this.config.bodyAngle+(authored[2]||0));
  rootMatrix[4]+=(Math.sin(phase)*this.config.shift[0]+(authored[0]||0))*w;rootMatrix[5]+=((1+Math.sin(phase))*.5*this.config.shift[1]+(authored[1]||0))*h;
  const matrices=[];
  this.bones.forEach((bone,index)=>{
   if(index===0){matrices.push(rootMatrix);return;}
   const parent=matrices[this.boneIndex[bone.parent]]||rootMatrix;
   const angle=Math.sin(phase*(bone.frequency||1)+(bone.phase||0))*bone.amplitude+(sampleTrack(clip?.joints?.[bone.name],clipTime)[0]||0);
   matrices.push(multiply(parent,rotation(bone.pivot,angle)));
  });
  for(const side of ["L","R"]){
   const hand=sampleTrack(clip?.hands?.[side],clipTime),upper=this.bones[this.boneIndex["upper-arm-"+side]],lower=this.bones[this.boneIndex["forearm-"+side]];
   if(!hand.length||!upper||!lower)continue;
   const parent=matrices[this.boneIndex[upper.parent]],shoulder=transform(parent,upper.pivot),target=transform(parent,[hand[0]*w,hand[1]*h]);
   const solved=solveLeg(upper.pivot,lower.pivot,lower.end,shoulder,target);
   matrices[this.boneIndex[upper.name]]=solved.upper;matrices[this.boneIndex[lower.name]]=solved.lower;
  }
  this.bones.forEach((bone,index)=>{if(bone.name.startsWith("hand-")){const parent=matrices[this.boneIndex[bone.parent]],angle=sampleTrack(clip?.joints?.[bone.name],clipTime)[0]||0;matrices[index]=multiply(parent,rotation(bone.pivot,angle));}});
  const contacts=[],footMatrices=[];
  this.legs.forEach(leg=>{
   const step=sampleTrack(clip?.feet?.[leg.name],clipTime),foot=[leg.foot[0]+(step[0]||0)*w,leg.foot[1]+(step[1]||0)*h];
   const footMatrix=rotation(leg.foot,step[2]||0);footMatrix[4]+=foot[0]-leg.foot[0];footMatrix[5]+=foot[1]-leg.foot[1];footMatrices.push(footMatrix);
   const endpoint=this.atlas?leg.ankle:leg.foot,targetEndpoint=this.atlas?transform(footMatrix,leg.ankle):foot;
   const hip=transform(matrices[this.boneIndex[leg.parent]]||rootMatrix,leg.hip),solved=solveLeg(leg.hip,leg.knee,endpoint,hip,targetEndpoint);
   matrices[this.boneIndex[leg.upper]]=solved.upper;matrices[this.boneIndex[leg.lower]]=solved.lower;
   contacts.push({name:leg.name,foot,planted:Math.abs(step[1]||0)<.001});
  });
  return {matrices,footMatrices,contacts,clipTime,vertices:this.vertices.map(vertex=>vertex.pinned?transform(footMatrices[vertex.contactIndex],vertex.bind):vertex.weights.reduce((position,influence)=>{const p=transform(matrices[influence.bone],vertex.bind);position[0]+=p[0]*influence.weight;position[1]+=p[1]*influence.weight;return position;},[0,0]))};
 }
 resize(){
  if(!this.loaded)return;const rect=this.canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,1.5);this.pixelRatio=ratio;
  this.canvas.width=Math.max(1,Math.round(rect.width*ratio));this.canvas.height=Math.max(1,Math.round(rect.height*ratio));this.draw(this.clock);
 }
 draw(time){
  if(!this.loaded||this.canvas.width<2)return;this.clock=time;
  const context=this.context,width=this.canvas.width,height=this.canvas.height,fit=Math.min(width/this.imageWidth,height/this.imageHeight)*(this.config.action?.fit||.94),ox=(width-this.imageWidth*fit)*.5,oy=height-this.imageHeight*fit;
  const posed=this.pose(time);context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,width,height);context.imageSmoothingEnabled=true;context.imageSmoothingQuality="high";
  if(this.atlas&&this.config.parts?.layers){
   for(const layer of [...this.config.parts.layers].sort((a,b)=>(a.order||0)-(b.order||0))){
    const matrix=layer.contact?posed.footMatrices[this.legs.findIndex(leg=>leg.name===layer.contact)]:posed.matrices[this.boneIndex[layer.bone]];
    if(!matrix)continue;
    const [sx,sy,sw,sh]=layer.rect,[localX,localY]=layer.pivot||[.5,.5],size=layer.size;let[targetW,targetH]=[size[0]*this.imageWidth,size[1]*this.imageHeight];
    const bind=layer.bindPivot||this.config.bones[this.boneIndex[layer.bone]]?.pivot||this.config.contacts.find(leg=>leg.name===layer.contact)?.foot;
    const bone=this.bones[this.boneIndex[layer.bone]],bindEnd=layer.bindEnd?[layer.bindEnd[0]*this.imageWidth,layer.bindEnd[1]*this.imageHeight]:bone?.end;
    let aligned=matrix;
    if(layer.end&&bindEnd&&!layer.contact&&layer.alignAxis!==false){
     const deltaX=layer.end[0]-localX,deltaY=layer.end[1]-localY,bindPoint=[bind[0]*this.imageWidth,bind[1]*this.imageHeight],length=distance(bindPoint,bindEnd);
     if(layer.fitUniform){const scale=length/Math.hypot(deltaX*targetW,deltaY*targetH);targetW*=scale;targetH*=scale;}
     else if(layer.fitToBone&&Math.abs(deltaY)>.05)targetH=Math.sqrt(Math.max(1,length*length-Math.pow(deltaX*targetW,2)))/Math.abs(deltaY);
     const angle=Math.atan2(bindEnd[1]-bindPoint[1],bindEnd[0]-bindPoint[0])-Math.atan2(deltaY*targetH,deltaX*targetW);
     aligned=multiply(matrix,rotation(bindPoint,angle));
    }
    const targetX=bind[0]*this.imageWidth-localX*targetW,targetY=bind[1]*this.imageHeight-localY*targetH;
    context.save();context.setTransform(aligned[0]*fit,aligned[1]*fit,aligned[2]*fit,aligned[3]*fit,aligned[4]*fit+ox,aligned[5]*fit+oy);context.drawImage(this.atlas,sx,sy,sw,sh,targetX,targetY,targetW,targetH);context.restore();
   }
   return;
  }
  const deformed=posed.vertices.map(p=>[p[0]*fit+ox,p[1]*fit+oy]);
  for(const indices of this.triangles){
   const source=indices.map(index=>this.vertices[index].bind),dest=indices.map(index=>deformed[index]),matrix=affine(source,dest);
   const center=[(dest[0][0]+dest[1][0]+dest[2][0])/3,(dest[0][1]+dest[1][1]+dest[2][1])/3];
   // A subpixel overlap closes raster antialiasing seams without stretching the art.
   const clip=dest.map(p=>{const dx=p[0]-center[0],dy=p[1]-center[1],length=Math.hypot(dx,dy)||1;return[p[0]+dx/length*.45,p[1]+dy/length*.45];});
   context.save();context.beginPath();context.moveTo(...clip[0]);context.lineTo(...clip[1]);context.lineTo(...clip[2]);context.closePath();context.clip();context.setTransform(...matrix);context.drawImage(this.texture,0,0);context.restore();
  }
 }
 manage(){
  const run=this.loaded&&this.active&&this.inView&&this.documentVisible&&!this.paused;
  if(!run){if(this.frameId)cancelAnimationFrame(this.frameId);this.frameId=null;if(this.loaded)this.draw(this.clock);return;}
  if(this.frameId)return;this.lastFrame=performance.now();const tick=timestamp=>{this.frameId=null;if(!this.active||!this.inView||!this.documentVisible||this.paused)return;
   const elapsed=timestamp-this.lastFrame;
   if(elapsed>1000/24){this.lastFrame=timestamp;this.draw(this.clock+Math.min(elapsed/1000,.1));}this.frameId=requestAnimationFrame(tick);
  };this.frameId=requestAnimationFrame(tick);
 }
 setActive(active){this.active=active;this.manage();}
 setPaused(paused){this.paused=paused;this.manage();}
 setDocumentVisible(visible){this.documentVisible=visible;this.manage();}
 // A deterministic clock supports one compact motion study without engine captures.
 renderAt(seconds){this.draw(seconds);}
 debugSummary(){return {bones:this.bones.map(b=>b.name),rigidParts:this.config.parts?.layers?.length||0,action:this.config.action?.name||null,duration:this.config.action?.duration||null,vertices:this.vertices.length,pinnedVertices:this.vertices.filter(v=>v.pinned).length,triangles:this.triangles.length,pinnedContacts:this.legs.map(leg=>({name:leg.name,foot:leg.foot})),texture:[this.imageWidth,this.imageHeight]};}
}
window.OriginPortraitRig=OriginPortraitRig;
})();
