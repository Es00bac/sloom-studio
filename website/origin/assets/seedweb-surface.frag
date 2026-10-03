precision highp float;
uniform vec2 resolution;
uniform float scroll;
uniform float clock;
uniform float opacity;
uniform float pixelRatio;
uniform sampler2D growthField;
uniform sampler2D surfaceSet;
uniform sampler2D normalSet;
uniform sampler2D packedSet;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
void main(){
 vec2 pixel=vec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y);
 vec2 screenUV=pixel/resolution;
 vec4 field=texture2D(growthField,screenUV);
 if(field.r<.012||opacity<.002){gl_FragColor=vec4(0.);return;}
 vec2 page=vec2(pixel.x,pixel.y+scroll)/pixelRatio;
 vec2 uv=page/240.;
 vec4 a=texture2D(surfaceSet,uv);
 vec4 nr=texture2D(normalSet,uv);
 vec3 materialChannels=texture2D(packedSet,uv).rgb;
 float broad=noise(page/235.)*.65+noise(page/79.)*.25+noise(page/21.)*.1;
 float cable=smoothstep(.12,.30,nr.b)*(1.-smoothstep(.45,.55,nr.b));
 float plate=smoothstep(.50,.60,nr.b);
 // Cables arrive first; ceramic accretes behind their advancing front.
 float edge=field.r+ cable*.21-plate*.15-(1.-broad)*.12;
 float cover=smoothstep(.11,.29,edge)*opacity;
 vec2 tangent=nr.rg*2.-1.;
 vec3 n=normalize(vec3(tangent.x,-tangent.y,sqrt(max(1.-dot(tangent,tangent),.04))));
 vec3 light=normalize(vec3(-.50,-.32,.91));
 float diffuse=.30+.62*max(dot(n,light),0.);
 vec3 material=a.rgb*(diffuse+plate*.07);
 vec3 secondary=texture2D(surfaceSet,uv*.31+vec2(.37,.11)).rgb;
 material*=mix(vec3(1.),secondary*1.30+.28,.23);
 material*=mix(1.,.65,field.b*field.b);
 float rough=materialChannels.g;
 float specular=pow(max(dot(n,normalize(light+vec3(0.,0.,1.))),0.),mix(34.,9.,rough))*.15;
 material+=vec3(.68,.58,.39)*specular;
 float wave=.25+.75*max(sin(clock*1.3-field.g*18.),0.);
 float veins=materialChannels.r*wave*(.35+.65*field.b);
 float front=(1.-smoothstep(.25,.65,field.r))*cable*(.60+.40*sin(clock*3.1-field.g*14.));
 material+=vec3(1.,.46,.065)*(veins*1.1+front*.24);
 // Fine directional surface occlusion, preserving the real game's plate/cable relief.
 float neighbor=texture2D(normalSet,uv+vec2(-.003,-.003)).b;
 material*=1.-max(neighbor-nr.b,0.)*.26;
 gl_FragColor=vec4(material,cover);
}
