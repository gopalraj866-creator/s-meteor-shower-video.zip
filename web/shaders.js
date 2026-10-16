// All GLSL lives here. Written in GLSL ES 1.0 style; three.js converts it for WebGL2.

export const NOISE = /* glsl */`
float hash13(vec3 p3){ p3 = fract(p3*0.1031); p3 += dot(p3, p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec3 x){
  vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x), mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x), mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y), f.z);
}
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s/0.96875; }
float ridge(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ float n=1.0-abs(2.0*vnoise(p)-1.0); s+=a*n*n; p=p*2.1+vec3(5.3,1.1,7.7); a*=0.5; } return s/0.9375; }
`;

export const SKYBASE = /* glsl */`
uniform float uPollution; uniform float uPollAz; uniform float uAirglow; uniform float uFlash; uniform vec3 uFlashTint;
vec3 skyBase(vec3 d){
  float alt = clamp(d.y, -0.2, 1.0);
  float az = atan(d.x, -d.z);
  vec3 col = mix(vec3(0.0030,0.0050,0.0115), vec3(0.0012,0.0021,0.0050), smoothstep(0.0,0.9,alt));
  col += vec3(0.0035,0.0048,0.0075) * pow(1.0-max(alt,0.0), 8.0);
  float ag = exp(-pow((alt-0.14)/0.11, 2.0));
  float band = 0.65 + 0.7*vnoise(vec3(az*7.0, alt*22.0, 3.3));
  col += vec3(0.0030,0.0085,0.0050) * ag * band * uAirglow;
  float w = pow(max(0.5+0.5*cos(az-uPollAz), 0.0), 2.5);
  float pg = exp(-max(alt,0.0)/0.20);
  col += uPollution * (w*vec3(0.060,0.034,0.014) + 0.25*vec3(0.02,0.014,0.008)) * pg;
  return col;
}
`;

// ---- Milky Way bake (celestial equirect, sqrt-encoded RGBA8) ----
export const MW_BAKE_FRAG = /* glsl */`
precision highp float;
uniform vec2 uSize;
varying vec2 vUv;
${NOISE}
const mat3 GAL = mat3(-0.0548755604, 0.4941094279, -0.8676661490,
                      -0.8734370902,-0.4448296300, -0.1980763734,
                      -0.4838350155, 0.7469822445,  0.4559837762);
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  float ra = (uv.x - 0.0) * 6.2831853;
  float dec = (uv.y - 0.5) * 3.14159265;
  vec3 e = vec3(cos(dec)*cos(ra), cos(dec)*sin(ra), sin(dec));
  vec3 g = GAL * e;
  float l = atan(g.y, g.x);
  float b = asin(clamp(g.z,-1.0,1.0));
  float cl = cos(l);
  float bulge = pow(max(cl,0.0), 3.0);
  float sigma = mix(0.075, 0.17, bulge);
  float core = exp(-pow(b/sigma, 2.0));
  float halo = 0.30*exp(-pow(b/(sigma*3.3), 2.0));
  float n1 = fbm(g*3.2);
  float n2 = fbm(g*9.0 + 10.0);
  float n3 = fbm(g*22.0 + 40.0);
  float arms = 0.72 + 0.28*sin(l*2.0+0.8) + 0.25*exp(-pow((l-1.45)/0.22,2.0)) + 0.18*exp(-pow((l+2.3)/0.3,2.0));
  float dens = (core + halo) * arms * (0.35 + 1.15*bulge + 0.25);
  dens *= mix(0.35, 1.7, n1) * (0.6 + 0.8*n2) * (0.8 + 0.4*n3); dens = pow(dens, 1.25);
  // Great Rift: meandering dust lane from Cygnus to Sagittarius
  float riftC = 0.012 + 0.03*sin(l*2.5+1.0) + 0.02*(n2-0.5);
  float riftW = 0.032 + 0.022*n2;
  float riftL = exp(-pow((l-0.7)/0.8, 2.0));
  float rift = exp(-pow((b-riftC)/riftW, 2.0)) * riftL * (0.45 + 0.55*ridge(g*7.0+3.0));
  float dark = smoothstep(0.60, 0.80, fbm(g*14.0+3.0)) * core * 0.75;
  dens *= (1.0 - clamp(rift*0.92 + dark, 0.0, 0.93));
  vec3 warm = vec3(1.0,0.78,0.52), cool = vec3(0.60,0.72,1.0);
  vec3 col = mix(cool, warm, clamp(bulge*0.95 + 0.12*n1, 0.0, 1.0));
  col *= dens;
  col += vec3(1.0,0.32,0.38) * 0.05 * core * smoothstep(0.55,0.85,n2) * (1.0-rift); // faint HII glow
  col = clamp(col*0.95, 0.0, 1.0);
  gl_FragColor = vec4(sqrt(col), 1.0);
}
`;

// ---- Sky dome ----
export const SKY_VERT = /* glsl */`varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
export const SKY_FRAG = /* glsl */`
uniform sampler2D uMW; uniform mat3 uWorldToEq; uniform float uMWGain;
varying vec3 vDir;
${NOISE}
${SKYBASE}
void main(){
  vec3 d = normalize(vDir);
  vec3 col = skyBase(d);
  vec3 e = uWorldToEq * d;
  vec2 uv = vec2(atan(e.y, e.x)/6.2831853, asin(clamp(e.z,-1.0,1.0))/3.14159265 + 0.5);
  vec3 mw = texture2D(uMW, uv).rgb; mw = mw*mw*uMWGain;
  float g = vnoise(e*620.0) * vnoise(e*1050.0+4.0);
  mw *= (0.7 + 1.2*g);
  float ext = exp(-0.22*(1.0/max(d.y,0.03) - 1.0));
  col += mw * ext;
  col += uFlash * uFlashTint * 0.055 * (0.35 + 0.65*(1.0 - max(d.y,0.0)));
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---- Stars ----
export const STAR_VERT = /* glsl */`
attribute float aMag; attribute vec3 aTint; attribute float aPhase;
uniform mat3 uCel; uniform float uTime; uniform float uStarGain;
varying vec3 vCol;
void main(){
  vec3 d = normalize(uCel * position);
  float alt = d.y;
  float X = 1.0/max(alt+0.03, 0.04);
  float ext = exp(-0.16*(X-1.0));
  float k = clamp(1.0 - alt*1.5, 0.0, 1.0);
  float scint = 0.05 + 0.5*k*k;
  float tw = 1.0 + scint*(0.6*sin(uTime*(7.0+aPhase*5.0)+aPhase*40.0) + 0.4*sin(uTime*(13.0+aPhase*3.0)+aPhase*17.0));
  float peak = 0.12*pow(10.0, 0.24*(6.2-aMag)) * ext * tw * uStarGain;
  float size = 1.8 + 0.85*max(0.0, 4.2-aMag);
  vCol = aTint * vec3(1.0, exp(-0.02*(X-1.0)), exp(-0.06*(X-1.0))) * peak;
  gl_PointSize = size;
  gl_Position = projectionMatrix*viewMatrix*vec4(cameraPosition + d*700000.0, 1.0);
  if(alt < -0.02) gl_Position = vec4(2.0,2.0,2.0,1.0);
}
`;
export const STAR_FRAG = /* glsl */`
varying vec3 vCol;
void main(){
  vec2 c = gl_PointCoord*2.0-1.0; float r2 = dot(c,c);
  float g = exp(-r2*4.5) * (1.0 - smoothstep(0.7,1.0,sqrt(r2)));
  gl_FragColor = vec4(vCol*g, 1.0);
}
`;

// ---- Terrain ----
export const TERRAIN_VERT = /* glsl */`
varying vec3 vPos; varying vec3 vN;
void main(){ vPos = position; vN = normal; gl_Position = projectionMatrix*viewMatrix*vec4(position,1.0); }
`;
export const TERRAIN_FRAG = /* glsl */`
uniform float uGroundLight; uniform vec3 uFlashDir;
varying vec3 vPos; varying vec3 vN;
${NOISE}
${SKYBASE}
void main(){
  vec3 toP = vPos - cameraPosition; float dist = length(toP); vec3 vd = toP/dist;
  vec3 n = normalize(vN);
  float n1 = fbm(vec3(vPos.x, 0.0, vPos.z)*0.012);
  float n2 = vnoise(vPos*0.9) * exp(-dist/180.0);
  float rockMix = smoothstep(0.78, 0.55, n.y);
  vec3 soil = mix(vec3(0.028,0.025,0.022), vec3(0.050,0.046,0.040), n1);
  vec3 rock = vec3(0.040,0.040,0.044);
  vec3 alb = mix(soil, rock, rockMix) * (0.75 + 0.5*n2);
  vec3 sd = normalize(vec3(n.x, max(n.y,0.0)*0.6+0.25, n.z));
  vec3 rad = alb * skyBase(sd) * uGroundLight * (0.35 + 0.65*n.y);
  vec3 L = normalize(uFlashDir);
  rad += alb * uFlash * uFlashTint * (0.25 + 0.75*max(dot(n,L),0.0)) * 1.4;
  float fogA = 1.0 - exp(-dist/26000.0);
  vec3 haze = skyBase(normalize(vec3(vd.x, 0.0, vd.z))) * 1.2 + uFlash*uFlashTint*0.012;
  vec3 col = mix(rad, haze, fogA*0.93);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---- Meteor ribbons (screen-space quads between a head and a tail in 3D) ----
export const METEOR_VERT = /* glsl */`
attribute vec2 corner; attribute vec3 aHead; attribute vec3 aTail;
attribute vec4 aA; attribute vec4 aB; attribute vec3 aCol;
uniform vec2 uRes;
varying vec2 vP; varying float vLen; varying vec4 vA; varying vec4 vB; varying vec3 vCol;
void main(){
  mat4 vp = projectionMatrix*viewMatrix;
  vec4 ch = vp*vec4(aHead,1.0); vec4 ct = vp*vec4(aTail,1.0);
  float eps = 1.0;
  if(ch.w<eps && ct.w<eps){ gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
  if(ch.w<eps){ float k=(eps-ch.w)/(ct.w-ch.w); ch = mix(ch,ct,k); }
  if(ct.w<eps){ float k=(eps-ct.w)/(ch.w-ct.w); ct = mix(ct,ch,k); }
  vec2 sh = ch.xy/ch.w*0.5*uRes, st = ct.xy/ct.w*0.5*uRes;
  float zh = ch.z/ch.w, zt = ct.z/ct.w;
  vec2 dv = sh-st; float len = length(dv);
  vec2 dir = len>1e-3 ? dv/len : vec2(1.0,0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float hw = aA.x*3.2 + aA.y*3.6 + 4.0;
  float ext = max(aA.y*3.8 + 4.0, aA.x*4.5);
  float extT = 3.0 + aA.x*4.5;
  float cx = corner.x;
  vec2 pos = mix(st,sh,cx) + dir*(cx*ext - (1.0-cx)*extT) + perp*corner.y*hw;
  vP = vec2(mix(len+extT, -ext, cx), corner.y*hw);
  vLen = len; vA = aA; vB = aB; vCol = aCol;
  gl_Position = vec4(pos/(0.5*uRes), mix(zt,zh,cx), 1.0);
}
`;
export const METEOR_FRAG = /* glsl */`
uniform float uTime;
varying vec2 vP; varying float vLen; varying vec4 vA; varying vec4 vB; varying vec3 vCol;
void main(){
  float s = vP.x, y = vP.y;
  float width = vA.x, headR = vA.y, headB = vA.z, trailB = vA.w;
  float seed = vB.x, train = vB.y, flick = vB.z;
  float tf = clamp(s/max(vLen,1.0), 0.0, 1.0);
  vec3 col = vec3(0.0);
  if(train < 0.5){
    float wd = width*(1.0-0.55*tf);
    float prof = exp(-y*y/(2.0*wd*wd));
    float fall = pow(1.0-tf, 1.7) * smoothstep(-2.0, 2.0, s);
    float f = 1.0 + flick*(0.5*sin(s*0.31+seed*60.0+uTime*55.0) + 0.5*sin(s*0.11-uTime*31.0+seed*20.0));
    vec3 c = mix(vec3(1.0,0.97,0.92), vCol, smoothstep(0.0,0.35,tf));
    c = mix(c, vCol*vec3(1.0,0.55,0.35), smoothstep(0.45,1.0,tf));
    col += c * prof * fall * f * trailB;
    float hr2 = (s*s*0.55 + y*y)/(headR*headR);
    col += mix(vec3(1.0,0.98,0.95), vCol, 0.25) * (exp(-hr2*3.0)*1.9 + 0.28*exp(-hr2*1.1)) * headB;
  } else {
    float prof = exp(-y*y/(2.0*width*width));
    float wob = 0.65 + 0.35*sin(s*0.045+seed*30.0)*sin(s*0.017+seed*7.0+uTime*0.6);
    col += vCol * prof * wob * trailB * smoothstep(-width*3.0, width*3.0 + 30.0, s) * smoothstep(-width*3.0, width*3.0 + 60.0, vLen - s);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---- Dots: sparks & satellites ----
export const DOT_VERT = /* glsl */`
attribute float aSize; attribute vec3 aCol; varying vec3 vCol;
void main(){ vCol = aCol; gl_PointSize = aSize; gl_Position = projectionMatrix*viewMatrix*vec4(position,1.0); }
`;
export const DOT_FRAG = /* glsl */`
varying vec3 vCol;
void main(){ vec2 c = gl_PointCoord*2.0-1.0; float r2 = dot(c,c); float g = exp(-r2*4.0)*(1.0-smoothstep(0.7,1.0,sqrt(r2))); gl_FragColor = vec4(vCol*g,1.0); }
`;

// ---- Post ----
export const FS_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.0,1.0); }`;
export const DOWN_FRAG = /* glsl */`
uniform sampler2D tex; uniform vec2 texel; uniform float uKaris; varying vec2 vUv;
vec3 s(vec2 o){ return texture2D(tex, vUv+o*texel).rgb; }
float kw(vec3 c){ return 1.0/(1.0+dot(c,vec3(0.2126,0.7152,0.0722))); }
void main(){
  vec3 a=s(vec2(-2,2)), b=s(vec2(0,2)), c=s(vec2(2,2)), d=s(vec2(-2,0)), e=s(vec2(0,0)), f=s(vec2(2,0)), g=s(vec2(-2,-2)), h=s(vec2(0,-2)), i=s(vec2(2,-2));
  vec3 j=s(vec2(-1,1)), k=s(vec2(1,1)), l=s(vec2(-1,-1)), m=s(vec2(1,-1));
  vec3 col;
  if(uKaris > 0.5){
    vec3 g0=(j+k+l+m)*0.25, g1=(a+b+d+e)*0.25, g2=(b+c+e+f)*0.25, g3=(d+e+g+h)*0.25, g4=(e+f+h+i)*0.25;
    float w0=0.5*kw(g0), w1=0.125*kw(g1), w2=0.125*kw(g2), w3=0.125*kw(g3), w4=0.125*kw(g4);
    col = (g0*w0+g1*w1+g2*w2+g3*w3+g4*w4)/(w0+w1+w2+w3+w4);
  } else {
    col = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125;
  }
  gl_FragColor = vec4(col,1.0);
}
`;
export const UP_FRAG = /* glsl */`
uniform sampler2D tex; uniform sampler2D base; uniform vec2 texel; uniform float uMix; varying vec2 vUv;
vec3 s(vec2 o){ return texture2D(tex, vUv+o*texel).rgb; }
void main(){
  vec3 u = 4.0*s(vec2(0,0)) + 2.0*(s(vec2(1,0))+s(vec2(-1,0))+s(vec2(0,1))+s(vec2(0,-1))) + (s(vec2(1,1))+s(vec2(-1,1))+s(vec2(1,-1))+s(vec2(-1,-1)));
  gl_FragColor = vec4(texture2D(base, vUv).rgb + u*(uMix/16.0), 1.0);
}
`;
export const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tBloom; uniform vec2 uRes;
uniform float uBloom, uExposure, uFade, uSeed;
varying vec2 vUv;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
void main(){
  vec2 c = vUv-0.5; float r2 = dot(c,c);
  vec2 ca = c*r2*0.0035;
  vec3 s; s.r = texture2D(tScene, vUv+ca).r; s.g = texture2D(tScene, vUv).g; s.b = texture2D(tScene, vUv-ca).b;
  vec3 b = texture2D(tBloom, vUv).rgb;
  vec3 col = (s + b*uBloom) * uExposure;
  col *= 1.0 - 0.6*smoothstep(0.10, 0.62, r2*1.5);
  col = aces(col*0.9);
  float lum = dot(col, vec3(0.2126,0.7152,0.0722));
  col = mix(col*vec3(0.86,0.96,1.14), col, smoothstep(0.0,0.5,lum));      // cool shadows
  col = pow(col, vec3(1.0/2.2));
  float n = h12(gl_FragCoord.xy + uSeed*17.13) + h12(gl_FragCoord.xy*1.37 + uSeed*3.7) - 1.0;
  col += n*(1.6/255.0 + 0.010*(1.0-lum));
  col *= uFade;
  gl_FragColor = vec4(col, 1.0);
}
`;
