"use strict";
// A page-attached Seedweb: the game's real material channels, routed growth
// fields, independently shaded cable jackets, clamps and outbound signals.
// Text/photos are obstacles, not surfaces. No fixed decorative border paths.
(()=>{
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=v=>{v=clamp(v);return v*v*(3-2*v);};
const randomSeed=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let n=Math.imul(seed^seed>>>15,1|seed);n^=n+Math.imul(n^n>>>7,61|n);return((n^n>>>14)>>>0)/4294967296;};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const pageRect=el=>{const r=el.getBoundingClientRect();return{x:r.left,y:r.top+scrollY,w:r.width,h:r.height};};
const inside=(p,r,pad=14)=>p.x>r.x-pad&&p.x<r.x+r.w+pad&&p.y>r.y-pad&&p.y<r.y+r.h+pad;
function curve(a,b,bend){
 const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,m={x:(a.x+b.x)/2-dy/len*bend,y:(a.y+b.y)/2+dx/len*bend};
 const points=[];let total=0;
 for(let i=0;i<=24;i++){const t=i/24,s=1-t,wrap=Math.sin(t*Math.PI)*(Math.sin(t*11+a.x*.021)*2.5+Math.sin(t*23+b.y*.018)*.9),p={x:s*s*a.x+2*s*t*m.x+t*t*b.x-dy/len*wrap,y:s*s*a.y+2*s*t*m.y+t*t*b.y+dx/len*wrap};if(i)total+=distance(points[i-1],p);p.d=total;points.push(p);}
 return{points,length:total};
}
function prefix(edge,length){
 const result=[];
 for(let i=0;i<edge.points.length;i++){const p=edge.points[i];if(p.d<=length)result.push(p);else{const q=edge.points[i-1],t=(length-q.d)/(p.d-q.d);result.push({x:q.x+(p.x-q.x)*t,y:q.y+(p.y-q.y)*t,d:length});break;}}
 return result;
}
function path(ctx,points,shift=0){
 ctx.beginPath();points.forEach((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],l=distance(a,b)||1,x=p.x-(b.y-a.y)/l*shift,y=p.y+(b.x-a.x)/l*shift;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});
}
class Seedweb{
 constructor(){
  this.surface=document.createElement("canvas");this.surface.className="seedweb-surface";this.surface.setAttribute("aria-hidden","true");
  this.fallback=document.createElement("canvas");this.fallback.className="seedweb-surface";this.fallback.setAttribute("aria-hidden","true");this.fallback.style.display="none";this.fallbackContext=this.fallback.getContext("2d");this.coverage=document.createElement("canvas");this.coverageContext=this.coverage.getContext("2d");
  this.hardware=document.createElement("canvas");this.hardware.className="seedweb-hardware";this.hardware.setAttribute("aria-hidden","true");
  document.body.append(this.surface,this.fallback,this.hardware);
  this.detail=this.hardware.getContext("2d");this.field=document.createElement("canvas");this.fieldContext=this.field.getContext("2d");
  this.gl=this.surface.getContext("webgl",{alpha:true,antialias:false,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:"low-power"});
  this.nodes=[];this.edges=[];this.holes=[];this.level=0;this.clock=0;this.last=0;this.paused=matchMedia("(prefers-reduced-motion:reduce)").matches;this.visible=!document.hidden;this.frame=null;this.ready=false;
  this.measure();
  addEventListener("scroll",()=>this.schedule(),{passive:true});addEventListener("resize",()=>this.measure());
  this.surface.addEventListener("webglcontextlost",event=>{event.preventDefault();this.ready=false;this.fallback.style.display=this.materialReady?"block":"none";this.lastField=null;this.schedule();});
  this.load().then(()=>{this.ready=Boolean(this.program);this.fallback.style.display=this.ready?"none":"block";this.lastField=null;this.schedule();}).catch(error=>{this.error=String(error);this.surface.dataset.unavailable="true";this.fallback.style.display=this.materialReady?"block":"none";this.lastField=null;this.schedule();});
  this.schedule();
 }
 async load(){
  const gl=this.gl,image=name=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src="assets/"+name;});
  const [fragment,albedo,normal,packed]=await Promise.all([fetch("assets/seedweb-surface.frag?v=20261003-seedweb-03").then(r=>{if(!r.ok)throw Error("Seedweb shader unavailable");return r.text();}),image("seedweb-game-color.webp"),image("seedweb-game-relief.webp"),image("seedweb-game-channels.webp")]);
  // Decode the game's packed material channels once for non-WebGL browsers.
  // Alpha in the source is emission data, not image transparency.
  const tile=document.createElement("canvas");tile.width=tile.height=1024;const tc=tile.getContext("2d",{willReadFrequently:true});tc.drawImage(albedo,0,0);const colors=tc.getImageData(0,0,1024,1024);
  tc.drawImage(normal,0,0);const normals=tc.getImageData(0,0,1024,1024).data;this.heights=normals;
  for(let i=0;i<colors.data.length;i+=4){const nx=normals[i]/127.5-1,ny=1-normals[i+1]/127.5,nz=Math.sqrt(Math.max(1-nx*nx-ny*ny,.04)),len=Math.hypot(nx,ny,nz),diff=.30+.62*Math.max(0,(-nx*.46-ny*.29+nz*.84)/len);for(let channel=0;channel<3;channel++)colors.data[i+channel]=Math.min(255,colors.data[i+channel]*diff);colors.data[i+3]=255;}
  tc.putImageData(colors,0,0);this.tile=tile;this.materialReady=true;
  if(!gl)return;
  const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,"attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}"));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));this.program=program;gl.useProgram(program);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const location=gl.getAttribLocation(program,"position");gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
  this.uniforms={};for(const name of ["resolution","scroll","clock","opacity","pixelRatio"])this.uniforms[name]=gl.getUniformLocation(program,name);
  this.textures=[];for(let unit=0;unit<4;unit++){const texture=gl.createTexture();this.textures.push(texture);gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,unit?gl.REPEAT:gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,unit?gl.REPEAT:gl.CLAMP_TO_EDGE);if(unit)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,[null,albedo,normal,packed][unit]);gl.uniform1i(gl.getUniformLocation(program,["growthField","surfaceSet","normalSet","packedSet"][unit]),unit);}
 }
 measure(){
  const crew=document.querySelector(".crew-dossier"),hive=document.querySelector(".hive-heading"),guide=document.querySelector("#field-guide"),factions=document.querySelector("#factions");if(!crew||!hive||!guide||!factions)return;
  this.geometry={start:pageRect(factions).y,crew:pageRect(crew).y,hive:pageRect(hive).y,end:pageRect(guide).y};
  this.surfaces=[...document.querySelectorAll(".illustration-stage,.faction-intro")].map(pageRect).filter(r=>r.w&&r.h);
  this.holes=[...document.querySelectorAll(".dossier-copy,.actual-scene img,.illustration-stage figcaption,.dossier-toolbar,.roster-heading,.seedweb-note,.factions .section-heading,.faction-intro-copy")].map(pageRect).filter(r=>r.w&&r.h);
  const signature=[innerWidth,innerHeight,...Object.values(this.geometry),...this.holes.flatMap(r=>[r.x,r.y,r.w,r.h])].map(Math.round).join(",");
  if(signature!==this.signature){this.signature=signature;this.build();this.lastField=null;}
  this.schedule();
 }
 build(){
  const w=innerWidth,h=innerHeight;this.ratio=this.gl?Math.min(devicePixelRatio||1,1.25,Math.sqrt(2300000/(w*h))):Math.min(1,Math.sqrt(650000/(w*h)));this.ratio=Math.max(.45,this.ratio);
  for(const canvas of [this.surface,this.fallback,this.coverage,this.hardware,this.field]){canvas.width=Math.round(w*this.ratio);canvas.height=Math.round(h*this.ratio);}
  this.nodes=[];this.edges=[];const rng=randomSeed(0x5eed),step=122;
  for(let band=0;band<this.surfaces.length;band++){
   const box=this.surfaces[band],source={x:box.x+box.w*.18,y:box.y+box.h*.86,arrival:0,root:true,band,sourceY:box.y+box.h*.86};this.nodes.push(source);const settled=[source],candidates=[];
   for(let row=0;row<Math.ceil(box.h/step);row++)for(let col=0;col<Math.ceil(box.w/step);col++){
    const p={x:clamp(box.x+(col+.5)*step+(rng()-.5)*step*.55,box.x+8,box.x+box.w-8),y:clamp(box.y+row*step+(rng()-.5)*step*.5,box.y+8,box.y+box.h-8),band,sourceY:source.sourceY,size:16+rng()*22,phase:rng()*6.28};
    if((p.y<box.y+box.h*.62&&p.x>box.x+box.w*.18&&p.x<box.x+box.w*.82)||p.y>=this.geometry.end||this.holes.some(r=>inside(p,r,22)))continue;
    p.radial=distance(p,source);candidates.push(p);
   }
   candidates.sort((a,b)=>a.radial-b.radial);
   for(const node of candidates){
    const parents=settled.map(p=>({p,score:distance(p,node)+p.arrival*.035})).sort((a,b)=>a.score-b.score);let parent=parents[0]?.p;if(!parent)continue;
    const routed=curve(parent,node,(rng()-.5)*28);node.arrival=parent.arrival+routed.length;node.parent=parent;settled.push(node);this.nodes.push(node);
    this.edges.push({...routed,from:parent,to:node,arrival:parent.arrival,strands:node.arrival<250?4:node.arrival<600?3:2,band,sourceY:source.sourceY,phase:node.phase});
   }
  }
 }
 target(){
  if(!this.geometry)return 0;const g=this.geometry,y=scrollY+innerHeight*.60;
  const rise=ease((y-(g.crew-innerHeight*.65))/Math.max(1,g.hive-g.crew+innerHeight*.45));
  const retreat=ease((g.end-(scrollY+innerHeight*.65))/(innerHeight*.7));
  return rise*retreat;
 }
 growth(edge){
  const sourceY=edge.sourceY;
  const advance=380+this.level*1450-Math.max(0,sourceY-(scrollY+innerHeight*.85))*.65;
  return clamp((advance-edge.arrival)/Math.max(1,edge.length));
 }
 visibleEdges(){return this.edges.filter(e=>e.to.y>scrollY-180&&e.to.y<scrollY+innerHeight+180||e.from.y>scrollY-180&&e.from.y<scrollY+innerHeight+180);}
 drawField(edges){
  const c=this.fieldContext,r=this.ratio;c.setTransform(1,0,0,1,0,0);c.fillStyle="#000";c.fillRect(0,0,this.field.width,this.field.height);c.setTransform(r,0,0,r,0,-scrollY*r);c.lineCap="round";c.lineJoin="round";
  for(const edge of edges){const progress=this.growth(edge);if(progress<=0)continue;const points=prefix(edge,edge.length*progress),route=clamp(edge.arrival/1600),core=1-route,red=150+core*64;
   c.strokeStyle="rgb("+Math.round(red)+","+Math.round(route*255)+","+Math.round(core*255)+")";c.shadowColor=c.strokeStyle;c.shadowBlur=14*r;c.lineWidth=12+core*22;path(c,points);c.stroke();
  }
  c.shadowBlur=0;
  // Broad floor deposits underpin the finer network, as they do in Tideglass.
  for(const box of this.surfaces){if(box.y+box.h<scrollY||box.y>scrollY+innerHeight)continue;const x=box.x+box.w*.46,y=box.y+box.h*.87,radius=box.w*.76,solid=ease(this.level);if(solid<.02)continue;const gradient=c.createRadialGradient(x,y,0,x,y,radius);gradient.addColorStop(0,"rgb("+Math.round(255*solid)+",20,245)");gradient.addColorStop(.60,"rgb("+Math.round(205*solid)+",50,195)");gradient.addColorStop(1,"#000");c.save();c.translate(x,y);c.scale(1,Math.min(.55,box.h*.20/radius));c.translate(-x,-y);c.fillStyle=gradient;c.beginPath();c.arc(x,y,radius,0,Math.PI*2);c.fill();c.restore();}
  for(const node of this.nodes){if(node.root||node.y<scrollY-150||node.y>scrollY+innerHeight+150)continue;
   const arrive=380+this.level*1450-Math.max(0,node.sourceY-(scrollY+innerHeight*.85))*.65-node.arrival;
   const solid=ease((arrive-50)/160);if(solid<=0)continue;const radius=node.size*(.45+solid*.55),route=clamp(node.arrival/1600),core=1-route;
   const gradient=c.createRadialGradient(node.x,node.y,0,node.x,node.y,radius);gradient.addColorStop(0,"rgb(255,"+Math.round(route*255)+","+Math.round(core*255)+")");gradient.addColorStop(.52,"rgb("+Math.round(210*solid)+","+Math.round(route*255)+","+Math.round(core*255)+")");gradient.addColorStop(1,"#000");c.fillStyle=gradient;c.beginPath();c.ellipse(node.x,node.y,radius,radius*.58,node.phase,0,Math.PI*2);c.fill();
  }
  this.clearHoles(c,false);c.setTransform(1,0,0,1,0,0);
  if(this.ready){const gl=this.gl;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.textures[0]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.field);}
  else if(this.materialReady)this.drawFallback();
 }
 drawFallback(){
  const width=this.field.width,height=this.field.height,r=this.ratio,data=this.fieldContext.getImageData(0,0,width,height),pixels=data.data;
  const xMap=Array.from({length:width},(_,x)=>Math.floor(x/r/240*1024)%1024);
  for(let y=0;y<height;y++){const ty=((Math.floor((y/r+scrollY)/240*1024)%1024)+1024)%1024;for(let x=0;x<width;x++){const i=(y*width+x)*4,value=pixels[i]/255,h=this.heights[(ty*1024+xMap[x])*4+2]/255,bed=ease((h-.12)/.18)*(1-ease((h-.45)/.1)),plate=ease((h-.5)/.1);const alpha=ease((value+bed*.21-plate*.15-.12-.11)/.18)*this.level*.94;pixels[i]=pixels[i+1]=pixels[i+2]=255;pixels[i+3]=Math.round(alpha*255);}}
  this.coverageContext.putImageData(data,0,0);const c=this.fallbackContext;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,width,height);c.save();c.setTransform(r,0,0,r,0,-scrollY*r);const pattern=c.createPattern(this.tile,"repeat");pattern.setTransform(new DOMMatrix().scale(240/1024));c.fillStyle=pattern;c.fillRect(0,scrollY,innerWidth,innerHeight);c.restore();c.globalCompositeOperation="destination-in";c.drawImage(this.coverage,0,0);c.globalCompositeOperation="source-over";
 }
 clearHoles(c,transparent){
  c.save();c.shadowBlur=0;c.globalCompositeOperation=transparent?"destination-out":"source-over";c.fillStyle="#000";
  for(const box of this.holes){if(box.y+box.h<scrollY||box.y>scrollY+innerHeight)continue;c.beginPath();c.roundRect(box.x-12,box.y-12,box.w+24,box.h+24,12);c.fill();}c.restore();
 }
 drawHardware(edges){
  const c=this.detail,r=this.ratio;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,this.hardware.width,this.hardware.height);c.setTransform(r,0,0,r,0,-scrollY*r);c.globalAlpha=this.level*.88;c.lineCap="round";c.lineJoin="round";
  const jackets=["#918a76","#79411f","#4c5356","#949798"];
  for(const edge of edges){const progress=this.growth(edge);if(progress<=0)continue;const points=prefix(edge,edge.length*progress);if(points.length<2)continue;
   c.strokeStyle="#090e0ee8";c.lineWidth=edge.strands*3.2+4;c.shadowColor="#0009";c.shadowOffsetY=2;c.shadowBlur=3;path(c,points);c.stroke();c.shadowBlur=0;c.shadowOffsetY=0;
   for(let strand=0;strand<edge.strands;strand++){const shift=(strand-(edge.strands-1)/2)*3.2;c.strokeStyle=jackets[strand];c.lineWidth=2.7;path(c,points,shift);c.stroke();c.strokeStyle="#c4bda440";c.lineWidth=.7;path(c,points,shift-.65);c.stroke();}
   // Brass clamps lie across the bundle, inheriting its actual tangent.
   for(let d=28;d<edge.length*progress-6;d+=57){let index=edge.points.findIndex(p=>p.d>=d);if(index<1)continue;const p=edge.points[index],a=edge.points[index-1];c.save();c.translate(p.x,p.y);c.rotate(Math.atan2(p.y-a.y,p.x-a.x));c.fillStyle="#251e13";c.fillRect(-3,-edge.strands*1.6-1,6,edge.strands*3.2+2);c.fillStyle="#a88a51";c.fillRect(-2,-edge.strands*1.6,3,edge.strands*3.2);c.fillStyle="#d1b57e";c.fillRect(-2,-edge.strands*1.6,1,edge.strands*3.2);c.restore();}
   const pulse=.18+.7*Math.max(0,Math.sin(this.clock*1.3-edge.arrival*.006));c.strokeStyle="rgba(242,157,53,"+pulse.toFixed(3)+")";c.lineWidth=.85;path(c,points,-(edge.strands-1)*1.6);c.stroke();
   // A short signal packet travels out along the route, without moving the cable.
   const packet=(this.clock*58+edge.phase*37)%Math.max(1,edge.length),tail=Math.max(0,packet-11);if(packet<edge.length*progress){const segment=prefix(edge,packet).filter(p=>p.d>=tail);if(segment.length>1){c.strokeStyle="#ffd58d";c.lineWidth=1.3;path(c,segment,-(edge.strands-1)*1.6);c.stroke();}}
  }
  // Half-sunk manufactured junctions couple the cable tree to its plate bed.
  for(const node of this.nodes){
   if(node.y<scrollY-24||node.y>scrollY+innerHeight+24)continue;
   const arrive=380+this.level*1450-Math.max(0,node.sourceY-(scrollY+innerHeight*.85))*.65-node.arrival;
   const alpha=ease((arrive-35)/100);if(alpha<.01)continue;
   const radius=node.root?11:5.5;c.save();c.translate(node.x,node.y);c.rotate(node.phase||0);c.globalAlpha=this.level*alpha*.9;
   c.shadowColor="#000a";c.shadowBlur=5;c.shadowOffsetY=2;c.fillStyle="#111a19";c.beginPath();c.ellipse(0,0,radius+3,radius+2,0,0,Math.PI*2);c.fill();c.shadowBlur=0;c.shadowOffsetY=0;
   const rim=c.createLinearGradient(-radius,-radius,radius,radius);rim.addColorStop(0,"#d4c6a4");rim.addColorStop(.3,"#686c62");rim.addColorStop(.65,"#303a36");rim.addColorStop(1,"#988461");c.strokeStyle=rim;c.lineWidth=2.5;c.beginPath();c.arc(0,0,radius,0,Math.PI*2);c.stroke();
   c.fillStyle="#ae915b";for(let bolt=0;bolt<4;bolt++){const a=bolt*Math.PI*.5;c.fillRect(Math.cos(a)*radius-1,Math.sin(a)*radius-1,2,2);}
   c.fillStyle="#e6a448";c.globalAlpha*=.48+.42*Math.max(0,Math.sin(this.clock*1.3-node.arrival*.006));c.beginPath();c.ellipse(0,0,radius*.32,radius*.24,0,0,Math.PI*2);c.fill();c.restore();
  }
  this.clearHoles(c,true);c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;
 }
 render(){
  const edges=this.visibleEdges(),key=Math.round(this.level*1500)+":"+Math.round(scrollY)+":"+this.ready;
  if(key!==this.lastField){this.drawField(edges);this.lastField=key;}
  if(this.ready){const gl=this.gl,u=this.uniforms;gl.viewport(0,0,this.surface.width,this.surface.height);gl.useProgram(this.program);gl.uniform2f(u.resolution,this.surface.width,this.surface.height);gl.uniform1f(u.scroll,scrollY*this.ratio);gl.uniform1f(u.pixelRatio,this.ratio);gl.uniform1f(u.clock,this.clock);gl.uniform1f(u.opacity,this.level*.94);gl.drawArrays(gl.TRIANGLES,0,6);}
  this.drawHardware(edges);
 }
 schedule(){if(this.frame||!this.visible)return;this.frame=requestAnimationFrame(timestamp=>this.tick(timestamp));}
 tick(timestamp){
  this.frame=null;if(!this.visible)return;if(this.last&&timestamp-this.last<1000/30){this.schedule();return;}const elapsed=this.last?Math.min((timestamp-this.last)/1000,.1):1/30;this.last=timestamp;const target=this.target();this.level=this.paused?target:this.level+(target-this.level)*Math.min(1,elapsed*6);if(Math.abs(this.level-target)<.0005)this.level=target;
  if(!this.paused)this.clock+=elapsed;this.render();
  if(this.visible&&!this.paused&&(this.level>.002||Math.abs(this.level-target)>.0005))this.schedule();
 }
 setPaused(value){this.paused=value;this.last=0;this.schedule();}
 setDocumentVisible(value){this.visible=value;this.last=0;if(!value&&this.frame){cancelAnimationFrame(this.frame);this.frame=null;}else this.schedule();}
 debugSummary(){return{nodes:this.nodes.length,branches:this.edges.length,protectedRegions:this.holes.length,materialReady:Boolean(this.materialReady),renderer:this.ready?"WebGL":"Canvas material fallback",error:this.error||null,coverage:this.level,clock:this.clock,source:"Exact game Seedweb albedo/normal channels",coordinates:"document-attached",paused:this.paused};}
}
window.OriginSeedweb=new Seedweb();
})();
