(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, v) => { const x = clamp((v - a) / (b - a)); return x * x * (3 - 2 * x); };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const params = new URLSearchParams(location.search);
  const embedded=params.get('embed')==='1';
  if(embedded)document.body.classList.add('embedded');
  const fixed = params.has('frame') && Number.isFinite(Number(params.get('frame'))) ? clamp(Number(params.get('frame'))) : null;
  if (fixed !== null) document.body.dataset.fixedFrame = String(fixed);
  const earth = $('#earth'), space = $('#space'), context = space.getContext('2d');
  const previous = $('#previousScene');
  const state = { progress: fixed ?? 0, ready: false, playing: false, comparing: false, phase: -1 };
  let width = 0, height = 0, pixelRatio = 1, focal = 1, radius = 1, distance = 100;
  let dirty = true, disposed = false, animation = null, scrollTrigger = null;
  let lastFrame = performance.now(), autoplayDuration = 56000, startRadius = 20, endRadius = 600;
  const FLIGHT_END = .53, ROTATION_START = .57, ROTATION_END = .93;
  const CHINA = { longitude: 105, latitude: 35 };
  const EARTH_END = .62, COAST_START = .64, COAST_END = .855;
  const NINGBO = { longitude: 121.56, latitude: 29.86 };
  const destination = $('#destination'), headquarters = $('#headquarters'), arrival = $('#arrival');
  // City reference coordinates: GeoNames. Ningbo retains the existing arrival coordinate.
  const cities = [
    {id:'xian',name:'西安',label:'中国 · 陕西 · 西安',longitude:108.92861,latitude:34.25833},
    {id:'hongkong',name:'香港',label:'中国 · 香港',longitude:114.17469,latitude:22.27832},
    {id:'foshan',name:'佛山',label:'中国 · 广东 · 佛山',longitude:113.13148,latitude:23.02677},
    {id:'shenzhen',name:'深圳',label:'中国 · 深圳',longitude:114.06830,latitude:22.54554},
    {id:'changsha',name:'长沙',label:'中国 · 湖南 · 长沙',longitude:112.97087,latitude:28.19874},
    {id:'losangeles',name:'洛杉矶',label:'美国 · 加利福尼亚州 · 洛杉矶',longitude:-118.24368,latitude:34.05223},
    {id:'ningbo',name:'宁波',label:'中国 · 浙江 · 宁波',...NINGBO}
  ];
  const cityLayer=document.createElement('div');cityLayer.className='city-layer';
  cityLayer.setAttribute('aria-hidden','true');cityLayer.hidden=true;
  const cityNodes=cities.map((city,index)=>{
    const pin=document.createElement('span');pin.className='city-pin';pin.dataset.city=city.id;
    pin.style.setProperty('--pulse-delay',(-index*.31)+'s');
    for(const name of ['aura','ring','ring echo','core']){
      const part=document.createElement('i');part.className='city-'+name.replace(' ',' city-');pin.append(part);
    }
    const label=document.createElement('span');label.className='city-label';label.dataset.city=city.id;
    label.textContent=city.name;cityLayer.append(pin,label);
    return {city,pin,label,point:null,opacity:0,focused:false,box:null};
  });
  headquarters.before(cityLayer);
  let citySceneActive=!embedded||parent===window;
  let cloudFlight = null, coastProgress = 0, marker = {x:0,y:0,visible:false};
  let orientation = { rotation: .06, tilt: -.12, roll: -.18, turns: 0, alignment: 0 };
  let program, uniforms = {}, bridgeImage;
  const gl = earth.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false });
  let seed = 20261003;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const starLayers = [
    { count: 940, depth: .12, size: [.24,.62], alpha: [.10,.34] },
    { count: 230, depth: .40, size: [.45,.95], alpha: [.18,.50] },
    { count: 24, depth: 1, size: [.75,1.35], alpha: [.30,.62] }
  ].map(layer => ({ ...layer, stars: Array.from({ length: layer.count }, () => ({
    x: random()*1.3-.15, y: random()*1.3-.15,
    size: layer.size[0]+random()*(layer.size[1]-layer.size[0]),
    alpha: layer.alpha[0]+random()*(layer.alpha[1]-layer.alpha[0]), warm: random()<.09
  })) }));
  const galaxy = document.createElement('canvas');
  let galaxySize = '';
  const spaceView = { visibility: 0, galaxyOpacity: 0, drift: 0 };
  function noise(x,y) {
    const ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy;
    const sx=fx*fx*(3-2*fx), sy=fy*fy*(3-2*fy);
    const hash=(a,b)=>{let n=Math.imul(a,374761393)+Math.imul(b,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;};
    const a=hash(ix,iy), b=hash(ix+1,iy), c=hash(ix,iy+1), d=hash(ix+1,iy+1);
    return a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy;
  }
  function cloudNoise(x,y) {
    return noise(x,y)*.54+noise(x*2.03+17,y*2.03+9)*.27+noise(x*4.11+3,y*4.11+21)*.13+noise(x*8.23,y*8.23)*.06;
  }
  // Build the dust and star-cloud texture only at a new viewport size, never per frame.
  function prepareGalaxy() {
    const w=Math.min(960,Math.round(width)), h=Math.max(1,Math.round(w*height/width));
    const key=w+'x'+h;
    if(key===galaxySize)return;
    galaxySize=key;galaxy.width=w;galaxy.height=h;
    const ctx=galaxy.getContext('2d'), pixels=ctx.createImageData(w,h), aspect=w/h;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const px=(x/w-.52)*aspect, py=y/h-.5;
      const along=px, across=py;
      const turbulence=cloudNoise(along*3+31,across*5+17);
      const bend=across+.035*Math.sin(along*4.3)+.045*(turbulence-.5);
      const broad=Math.exp(-bend*bend/.045), core=Math.exp(-bend*bend/.009);
      const detail=cloudNoise(along*8+71,across*18+43);
      const dustAxis=bend+.026+.024*Math.sin(along*8+detail*3);
      const dust=Math.exp(-dustAxis*dustAxis/.00085)*(.45+detail*.5);
      const filaments=Math.max(0,detail-.27)*1.65;
      const light=(broad*(.18+turbulence*.35)+core*filaments*.8)*(1-dust*.88);
      const warm=smooth(.39,.68,cloudNoise(along*3+95,across*9+5));
      const textClear=.30+.70*smooth(.18,.61,x/w);
      const edge=1-smooth(.40,.85,Math.abs(py));
      // Lift the existing cloud structure without raising the deep-space floor.
      const strength=light*textClear*edge*1.65;
      const i=(y*w+x)*4;
      pixels.data[i]=2+strength*(24+warm*20);
      pixels.data[i+1]=5+strength*(35+warm*3);
      pixels.data[i+2]=13+strength*(53-warm*22);
      pixels.data[i+3]=255;
    }
    ctx.putImageData(pixels,0,0);
    // Tiny clustered stars belong to the distant galaxy; independent layers add parallax.
    let galaxySeed=84631;
    const next=()=>{galaxySeed=(galaxySeed*16807)%2147483647;return (galaxySeed-1)/2147483646;};
    for(let i=0;i<1050;i++){
      const along=(next()-.5)*aspect*1.65;
      const across=(next()+next()+next()-1.5)*.095-.035*Math.sin(along*4.3);
      const x=(.52+along/aspect)*w;
      const y=(.5+across)*h;
      ctx.globalAlpha=(.08+next()*.25)*(.30+.70*smooth(.18,.61,x/w));
      ctx.fillStyle=next()<.12?'#c4b4a1':'#a5b8cc';
      ctx.beginPath();ctx.arc(x,y,.18+next()*.37,0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=1;
  }
  // C1-continuous log-scale approach: gentle handoff, sustained flight, then zero speed.
  // All time-independent values derive from scroll progress, including the stars.
  const knots = [ [0, 0, .9], [.10, .09, .9], [.40, .46, 1.6], [.70, .86, .95], [.94, 1, 0], [1, 1, 0] ];
  function approach(progress) {
    for (let i = 0; i < knots.length - 1; i++) {
      const [x0, y0, m0] = knots[i], [x1, y1, m1] = knots[i + 1];
      if (progress <= x1) {
        const span = x1 - x0, t = clamp((progress - x0) / span), t2 = t * t, t3 = t2 * t;
        return (2*t3-3*t2+1)*y0 + (t3-2*t2+t)*span*m0 + (-2*t3+3*t2)*y1 + (t3-t2)*span*m1;
      }
    }
    return 1;
  }
  function rotationEase(t) {
    const keyframes = [[0,0,0],[.12,.13,1.9],[.5,.78,1.15],[1,1,0]];
    t=clamp(t);
    for(let i=0;i<keyframes.length-1;i++){
      const [x0,y0,m0]=keyframes[i], [x1,y1,m1]=keyframes[i+1];
      if(t<=x1){
        const span=x1-x0, x=(t-x0)/span, x2=x*x, x3=x2*x;
        return (2*x3-3*x2+1)*y0+(x3-2*x2+x)*span*m0+(-2*x3+3*x2)*y1+(x3-x2)*span*m1;
      }
    }
    return 1;
  }
  function globeOrientationAt(progress) {
    const turns=rotationEase((progress-ROTATION_START)/(ROTATION_END-ROTATION_START));
    const alignment=smooth(.79,.96,progress);
    const targetRotation=(CHINA.longitude-90)*Math.PI/180;
    return {
      rotation:.06+turns*Math.PI*2+(targetRotation-.06)*alignment,
      tilt:-.12+(-CHINA.latitude*Math.PI/180+.12)*alignment,
      roll:-.18+(.14)*alignment,
      turns,alignment
    };
  }
  function orientationAt(progress) {
    const base=globeOrientationAt(clamp(progress/EARTH_END));
    const alignment=smooth(COAST_START,.795,progress);
    return {...base,
      rotation:base.rotation+(NINGBO.longitude-CHINA.longitude)*Math.PI/180*alignment,
      tilt:base.tilt-(NINGBO.latitude-CHINA.latitude)*Math.PI/180*alignment,
      roll:base.roll*(1-alignment),coastAlignment:alignment};
  }
  function projectCity(city) {
    const latitude=city.latitude*Math.PI/180, theta=Math.PI-city.longitude*Math.PI/180;
    let [x,y,z]=[Math.cos(latitude)*Math.cos(theta),Math.sin(latitude),Math.cos(latitude)*Math.sin(theta)];
    let c=Math.cos(-orientation.rotation),s=Math.sin(-orientation.rotation);
    [x,z]=[c*x+s*z,-s*x+c*z];c=Math.cos(-orientation.tilt);s=Math.sin(-orientation.tilt);
    [y,z]=[c*y-s*z,s*y+c*z];c=Math.cos(-orientation.roll);s=Math.sin(-orientation.roll);
    [x,y]=[c*x-s*y,s*x+c*y];
    return {x:width*.52+focal*x/(distance-z),y:height*.5-focal*y/(distance-z),visible:distance*z>1,front:distance*z-1};
  }
  const destinationAt=()=>projectCity(NINGBO);
  function updateCityMotion() {
    cityLayer.classList.toggle('is-paused',!citySceneActive||document.hidden||reducedMotion.matches||fixed!==null);
  }
  function renderCities(progress) {
    const envelope=smooth(.315,.345,progress)*(1-smooth(.603,.635,progress));
    cityLayer.hidden=envelope<=.001;
    updateCityMotion();
    // Keep the existing light emphasis, while every city name uses the same typography.
    const focus=progress<.363?['xian','changsha']:progress<.405?['foshan','shenzhen']:
      progress<.49?['losangeles']:progress<.535?['hongkong','foshan']:
      progress<.575?['shenzhen','changsha']:['ningbo','xian'];
    const visible=[];
    for(const node of cityNodes){
      const point=projectCity(node.city);node.point=point;
      node.opacity=envelope*smooth(.015,.24,point.front);
      if(point.x<24||point.x>width-24||point.y<95||point.y>height-95)node.opacity=0;
      node.focused=focus.includes(node.city.id)&&node.opacity>.02;
      node.pin.style.transform='translate3d('+point.x+'px,'+point.y+'px,0)';
      node.pin.style.opacity=String(node.opacity);
      node.pin.hidden=node.opacity<=.001;node.label.hidden=node.pin.hidden;
      node.pin.classList.toggle('is-focused',node.focused);
      node.box=null;
      if(!node.pin.hidden)visible.push(node);
    }
    const offsets={foshan:[-42,-27],shenzhen:[16,-22],hongkong:[-12,15],losangeles:[12,10]};
    const placed=[];
    const overlaps=(a,b,pad=5)=>a.x<b.x+b.w+pad&&a.x+a.w+pad>b.x&&a.y<b.y+b.h+pad&&a.y+a.h+pad>b.y;
    for(const node of visible){
      const preferred=offsets[node.city.id]||[12,-25],w=node.city.name.length*17,h=20;
      const candidates=[preferred,[preferred[0],preferred[1]-24],[preferred[0],preferred[1]+24],[14,12],[-w-12,-24],[-w-12,12]];
      let box;
      for(const [dx,dy] of candidates){
        const candidate={x:clamp(node.point.x+dx,24,width-w-24),y:clamp(node.point.y+dy,96,height-h-88),w,h};
        const coversPoint=visible.some(other=>other!==node&&overlaps(candidate,{x:other.point.x-5,y:other.point.y-5,w:10,h:10},2));
        if(!placed.some(other=>overlaps(candidate,other))&&!coversPoint){box=candidate;break;}
      }
      box??={x:clamp(node.point.x+preferred[0],24,width-w-24),y:clamp(node.point.y+preferred[1],96,height-h-88),w,h};
      placed.push(box);node.box=box;
      node.label.style.transform='translate3d('+box.x+'px,'+box.y+'px,0)';
      node.label.style.opacity=String(node.opacity);
    }
  }
  const vertex = `attribute vec2 a_position; void main(){gl_Position=vec4(a_position,0.,1.);}`;
  const fragment = `
    precision highp float;
    uniform vec2 u_resolution,u_center;
    uniform float u_focal,u_distance,u_radius,u_progress,u_rotation,u_tilt,u_roll,u_coast,u_tech;
    uniform sampler2D u_day,u_cloud,u_night,u_bridge,u_region,u_detail;
    const float PI=3.14159265359;
    vec3 rotateY(vec3 n,float a){return vec3(cos(a)*n.x+sin(a)*n.z,n.y,-sin(a)*n.x+cos(a)*n.z);}
    vec3 rotateX(vec3 n,float a){return vec3(n.x,cos(a)*n.y-sin(a)*n.z,sin(a)*n.y+cos(a)*n.z);}
    vec3 rotateZ(vec3 n,float a){return vec3(cos(a)*n.x-sin(a)*n.y,sin(a)*n.x+cos(a)*n.y,n.z);}
    vec3 model(vec3 n){return rotateY(rotateX(rotateZ(n,u_roll),u_tilt),u_rotation);}
    // Equirectangular longitude increases toward screen-right; keep the front longitude
    // of the source renderer while correcting its mirrored east-west texture mapping.
    vec2 uvOf(vec3 n){return vec2(fract(1.-atan(n.z,n.x)/(2.*PI)),asin(clamp(n.y,-1.,1.))/PI+.5);}
    vec4 over(vec4 front,vec4 back){
      float a=front.a+back.a*(1.-front.a);
      if(a<.0001)return vec4(0.);
      return vec4((front.rgb*front.a+back.rgb*back.a*(1.-front.a))/a,a);
    }
    vec2 bridgeUV(){
      float scale=max(u_resolution.x/1920.,u_resolution.y/1080.);
      vec2 size=vec2(1920.,1080.)*scale;
      vec2 offset=(u_resolution-size)*vec2(.52,.5);
      vec2 uv=(gl_FragCoord.xy-offset)/size;
      // Carry the filmed rays outward during handoff rather than freezing their motion.
      // This samples only the existing last frame; it never creates additional trails.
      float advance=u_radius/(19.6*scale);
      return vec2(.52,.5)+(uv-vec2(.52,.5))/advance;
    }
    void main(){
      float handoff=1.-smoothstep(.015,.16,u_progress);
      vec4 background=vec4(texture2D(u_bridge,bridgeUV()).rgb,handoff);
      float blend=smoothstep(0.,.055,u_progress);
      vec2 xy=gl_FragCoord.xy-u_center;
      vec3 ray=normalize(vec3(xy,-u_focal));
      vec3 origin=vec3(0.,0.,u_distance);
      float b=dot(origin,ray), discriminant=b*b-u_distance*u_distance+1.;
      vec3 light=normalize(vec3(-.62,.57,.68));
      if(discriminant<0.){
        float dr=length(xy)/u_radius-1.;
        float alpha=(exp(-max(dr,0.)*52.)*.46+exp(-max(dr,0.)*17.)*.045)*blend;
        float sun=.23+.77*max(dot(normalize(vec3(xy,0.)),light),0.);
        alpha*=sun;
        // A narrow luminous limb plus a faint outer atmosphere; never a flat outline.
        alpha+=(exp(-max(dr,0.)*40.)*.24+exp(-max(dr,0.)*12.)*.035)*sun*blend*u_tech;
        gl_FragColor=over(vec4(mix(vec3(.075,.35,.72),vec3(.16,.56,1.),u_tech*.72),alpha),background);return;
      }
      float t=-b-sqrt(max(0.,discriminant));
      vec3 n=normalize(origin+t*ray), mapped=model(n);
      vec2 uv=uvOf(mapped);
      vec3 surface=texture2D(u_day,uv).rgb;
      // Same geographic projection on the sphere; the regional image never rotates separately.
      vec2 regionUV=vec2(((uv.x-.5)*360.-70.)/75.,((uv.y-.5)*180.+2.)/57.);
      float inside=smoothstep(0.,.07,regionUV.x)*(1.-smoothstep(.93,1.,regionUV.x))*smoothstep(0.,.07,regionUV.y)*(1.-smoothstep(.93,1.,regionUV.y));
      vec3 region=texture2D(u_region,clamp(regionUV,0.,1.)).rgb;
      vec2 detailUV=vec2(((uv.x-.5)*360.-112.)/20.,((uv.y-.5)*180.-23.)/15.);
      float detailInside=smoothstep(0.,.10,detailUV.x)*(1.-smoothstep(.90,1.,detailUV.x))*smoothstep(0.,.10,detailUV.y)*(1.-smoothstep(.90,1.,detailUV.y));
      region=mix(region,texture2D(u_detail,clamp(detailUV,0.,1.)).rgb,detailInside*smoothstep(.25,.65,u_coast));
      surface=mix(surface,region,inside*smoothstep(.01,.32,u_coast));
      float ndl=dot(n,light), diffuse=max(ndl,0.);
      float nightWeight=1.-smoothstep(-.12,.17,ndl);
      float ocean=smoothstep(.025,.10,surface.b-surface.r);
      surface=mix(surface,surface*vec3(.53,.93,1.32),.56);
      vec3 color=surface*(.045+1.20*pow(diffuse,.78));
      // Clouds intersect a slightly larger sphere, so their position changes with distance.
      float cloudRadius=1.006;
      float ct=-b-sqrt(max(0.,b*b-u_distance*u_distance+cloudRadius*cloudRadius));
      vec3 cloudNormal=normalize(origin+ct*ray);
      vec4 clouds=texture2D(u_cloud,uvOf(rotateY(model(cloudNormal),.007)));
      float cloud=smoothstep(.10,.88,max(clouds.r,max(clouds.g,clouds.b)))*clouds.a;
      vec4 shadowTex=texture2D(u_cloud,uvOf(rotateY(mapped,.014)));
      float shadow=smoothstep(.14,.86,max(shadowTex.r,max(shadowTex.g,shadowTex.b)))*shadowTex.a;
      color*=1.-shadow*.14*(1.-smoothstep(0.,.32,u_coast));
      color=mix(color,vec3(.82,.90,.97)*(.055+max(dot(cloudNormal,light),0.)*1.02),cloud*.9*(1.-smoothstep(0.,.32,u_coast)*.92));
      float spec=pow(max(dot(reflect(-light,n),-ray),0.),42.);
      color+=vec3(.38,.63,.8)*spec*ocean*.32*(1.-cloud);
      float cities=dot(texture2D(u_night,uv).rgb,vec3(.3,.59,.11));
      color+=vec3(.40,.64,.79)*cities*nightWeight*.8;
      float limb=pow(1.-max(dot(n,-ray),0.),3.8);
      color+=vec3(.035,.27,.64)*limb*(.28+.72*diffuse)*.86;
      // Keep geographic textures and the existing light direction. This treatment
      // fades out before Ningbo, leaving its original illumination pixel-identical.
      vec3 daylight=surface*(.035+.38*pow(diffuse,.65))*(1.-cloud*.8);
      vec3 cloudLight=vec3(.17,.19,.20)*cloud*pow(diffuse,.7);
      vec3 oceanLight=vec3(.12,.27,.34)*pow(max(dot(reflect(-light,n),-ray),0.),14.)*ocean*(1.-cloud);
      vec3 nightLights=vec3(.58,.79,1.)*pow(max(cities,0.),.82)*nightWeight*1.45*(1.-cloud*.45);
      vec3 atmosphere=vec3(.045,.32,.78)*limb*(.32+.68*diffuse)*.72;
      color+=(daylight+cloudLight+oceanLight+nightLights+atmosphere)*u_tech;
      // Roll off the brightest cloud/desert highlights instead of clipping white.
      float highlight=max(color.r,max(color.g,color.b));
      color/=1.+max(highlight-.78,0.)*.85*u_tech;
      color=pow(max(color,vec3(0.)),vec3(.9));
      float edge=1.-smoothstep(u_radius-1.2,u_radius,length(xy));
      gl_FragColor=over(vec4(color,blend*edge),background);
    }`;
  function showStatus(text) { $('#status').textContent = text; $('#status').hidden = false; }
  function shader(type, source) {
    const item = gl.createShader(type); gl.shaderSource(item, source); gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item));
    return item;
  }
  function texture(url, unit, name) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        gl.activeTexture(gl.TEXTURE0 + unit); const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, ['u_bridge','u_region','u_detail'].includes(name) ? gl.CLAMP_TO_EDGE : gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(gl.getUniformLocation(program, name), unit);
        if (name === 'u_bridge') bridgeImage = image;
        resolve();
      };
      image.onerror = () => reject(new Error('素材加载失败：' + url)); image.src = url;
    });
  }
  async function setup() {
    if (!gl) { showStatus('当前浏览器无法显示实时地球。请在支持 WebGL 的浏览器中打开。'); return; }
    try {
      program = gl.createProgram(); gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program); const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const attribute = gl.getAttribLocation(program, 'a_position'); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
      for (const name of ['resolution','center','focal','distance','radius','progress','rotation','tilt','roll','coast','tech']) uniforms[name] = gl.getUniformLocation(program, 'u_' + name);
      cloudFlight=window.createCloudFlight($('#cloudFlight'));
      await Promise.all([texture('../earth-day.jpg',0,'u_day'),texture('../earth-clouds.png',1,'u_cloud'),texture('../earth-night.png',2,'u_night'),texture('第二幕实际末帧.png',3,'u_bridge'),texture('素材/中国及周边.jpg',4,'u_region'),texture('素材/中国东部沿海.jpg',5,'u_detail'),$('#headquartersPhoto').decode()]);
      state.ready = true; document.body.classList.add('ready'); $('#status').hidden = true;
      for (const id of ['play','compare','progress','orbitStep','coastStep']) $('#'+id).disabled = false;
      resize(); paint();
      earth.dataset.ready = 'true'; document.body.dataset.frameReady = 'true';
      if(embedded&&parent!==window)parent.postMessage({type:'hoome-earth-ready'},location.origin);
    } catch (error) { console.error(error); showStatus('地球画面未能准备完成。请通过本地预览地址打开，或刷新重试。'); }
  }
  function resize() {
    width = innerWidth; height = $('.stage').clientHeight;
    pixelRatio = Math.min(devicePixelRatio || 1, width < 800 ? 1.5 : 1.35);
    for (const canvas of [space, earth]) { canvas.width = Math.round(width * pixelRatio); canvas.height = Math.round(height * pixelRatio); }
    context.setTransform(pixelRatio,0,0,pixelRatio,0,0);
    if (gl) gl.viewport(0,0,earth.width,earth.height);
    cloudFlight?.resize(width,height);
    focal = height * 1.48;
    startRadius = 19.6 * Math.max(width/1920,height/1080);
    endRadius = Math.min(height * .65, width * (width < 800 ? .87 : .47));
    if(width>0&&height>0)prepareGalaxy();
    dirty = true;
  }
  function starfield(progress,journeyProgress) {
    context.clearRect(0,0,width,height);
    const visibility=smooth(.015,.22,progress)*(1-smooth(.60,.82,journeyProgress));
    const drift=approach(progress);
    spaceView.visibility=visibility;spaceView.galaxyOpacity=visibility*.94;spaceView.drift=drift;
    context.fillStyle = '#02050d'; context.fillRect(0,0,width,height);
    if(visibility<=0)return;
    context.globalAlpha=spaceView.galaxyOpacity;
    const margin=height*.035;
    context.drawImage(galaxy,-margin-drift*height*.009,-margin+drift*height*.006,width+margin*2,height+margin*2);
    for(const layer of starLayers){
      const scale=1+drift*layer.depth*.24;
      for(const star of layer.stars){
        const x=width*(.52+(star.x-.52)*scale), y=height*(.5+(star.y-.5)*scale);
        if(x<0||x>width||y<0||y>height||Math.hypot(x-width*.52,y-height*.5)<radius+2)continue;
        const clear=.42+.58*smooth(.12,.58,x/width);
        const alpha=star.alpha*visibility*clear;
        if(layer.depth===1){
          const glow=context.createRadialGradient(x,y,0,x,y,star.size*4);
          glow.addColorStop(0,'rgba(157,189,221,.26)');glow.addColorStop(1,'rgba(157,189,221,0)');
          context.globalAlpha=alpha;context.fillStyle=glow;
          context.fillRect(x-star.size*4,y-star.size*4,star.size*8,star.size*8);
        }
        context.globalAlpha=alpha;context.fillStyle=star.warm?'#d6c5ad':'#bfd0e2';
        context.beginPath();context.arc(x,y,star.size,0,Math.PI*2);context.fill();
      }
    }
    context.globalAlpha = 1;
  }
  // Pure camera geometry, shared by rendering and the parent page's briefing.
  function radiusAt(progress) {
    const globeProgress=clamp(progress/EARTH_END);
    const flightProgress=clamp(globeProgress/FLIGHT_END);
    let apparentRadius = startRadius * Math.exp(Math.log(endRadius/startRadius) * approach(flightProgress));
    // Give the rotating planet space to show its whole silhouette, then restore
    // the confirmed approach exactly before the final Ningbo marker appears.
    apparentRadius *= 1-.32*smooth(.06,.32,progress)*(1-smooth(.54,.635,progress));
    // Inverse apparent-radius formula for a perspective camera viewing a unit sphere.
    let cameraDistance = Math.sqrt(1 + (focal/apparentRadius)**2);
    const coast=smooth(COAST_START,COAST_END,progress);
    if(coast>0){
      cameraDistance=1+Math.exp(Math.log(cameraDistance-1)*(1-coast)+Math.log(.045)*coast);
      apparentRadius=focal/Math.sqrt(cameraDistance*cameraDistance-1);
    }
    return {radius:apparentRadius,distance:cameraDistance,coastProgress:coast};
  }
  function viewportCoverProgress(){
    const corner=Math.hypot(width*.52,height*.5);
    let low=.635,high=.855;
    for(let i=0;i<16;i++){
      const mid=(low+high)/2;
      if(radiusAt(mid).radius>=corner)high=mid;else low=mid;
    }
    return high;
  }
  function paint() {
    if (!state.ready) return;
    const progress = fixed ?? state.progress;
    const globeProgress=clamp(progress/EARTH_END);
    const flightProgress=clamp(globeProgress/FLIGHT_END);
    ({radius,distance,coastProgress}=radiusAt(progress));
    orientation=orientationAt(progress);
    if(progress<.88){
    starfield(flightProgress,progress);
    gl.useProgram(program); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uniforms.resolution,earth.width,earth.height);
    gl.uniform2f(uniforms.center,width*.52*pixelRatio,height*.5*pixelRatio);
    gl.uniform1f(uniforms.focal,focal*pixelRatio); gl.uniform1f(uniforms.distance,distance);
    gl.uniform1f(uniforms.radius,radius*pixelRatio); gl.uniform1f(uniforms.progress,flightProgress);
    gl.uniform1f(uniforms.rotation,orientation.rotation);gl.uniform1f(uniforms.tilt,orientation.tilt);gl.uniform1f(uniforms.roll,orientation.roll);
    gl.uniform1f(uniforms.coast,coastProgress);
    gl.uniform1f(uniforms.tech,smooth(.008,.055,progress)*(1-smooth(.575,.635,progress)));
    gl.drawArrays(gl.TRIANGLES,0,6);
    }
    marker=destinationAt();
    renderCities(progress);
    destination.style.left=marker.x+'px';destination.style.top=marker.y+'px';
    destination.style.opacity=String(marker.visible?smooth(.635,.69,progress)*(1-smooth(.775,.825,progress)):0);
    headquarters.style.opacity=progress>=.88?'1':'0';
    headquarters.setAttribute('aria-hidden',String(progress<.925));
    const arrivalProgress=smooth(.90,.995,progress);
    $('#headquartersPhoto').style.transform='scale('+(1.015+.05*arrivalProgress)+')';
    arrival.style.opacity=String(smooth(.955,.99,progress));
    arrival.style.transform='translateY('+((1-smooth(.955,.99,progress))*12)+'px)';
    cloudFlight.render(progress);
    const phase = state.comparing ? -1 : globeProgress < .16*FLIGHT_END ? 0 : globeProgress < .70*FLIGHT_END ? 1 : globeProgress < .94*FLIGHT_END ? 2 : globeProgress < ROTATION_START ? 3 : globeProgress < .79 ? 4 : globeProgress < .96 ? 5 : progress < COAST_START ? 6 : progress < .795 ? 7 : progress < .925 ? 8 : progress < .99 ? 9 : 10;
    if (phase !== state.phase) {
      state.phase = phase; $('#phaseNumber').textContent = phase < 0 ? '02' : String(phase+1).padStart(2,'0');
      $('#phaseName').textContent = phase < 0 ? '第二幕 · 穿越圆环' : ['接续深空','持续抵近','抵近减速','停留于地球','展示全球','转向中国','中国朝向镜头','沿海驶向宁波','穿越云层','抵达灏米总部','停留于灏米'][phase];
    }
    if (document.activeElement !== $('#progress')) $('#progress').value = String(Math.round(progress*1000));
    $('#percentage').value = Math.round(progress*100)+'%';
    $('#scrollCue').style.opacity = String((1-smooth(.025,.10,flightProgress))*(state.comparing?0:1));
    $('.shade').style.opacity = String(smooth(.04,.18,flightProgress));
    document.body.dataset.progress = progress.toFixed(5); document.body.dataset.radius = radius.toFixed(3);
    if(fixed !== null) { gl.finish(); document.body.dataset.frameReady = 'true'; }
    dirty = false;
  }
  function seek(value) {
    state.progress = clamp(value);
    const total = Math.max(1,document.documentElement.scrollHeight-innerHeight);
    if(!embedded)scrollTo({top:state.progress*total,behavior:'instant'}); dirty = true;
  }
  function updatePlayLabel() {
    const text = state.playing ? '暂停演示' : '自动演示'; $('#play').textContent = text; $('#play').setAttribute('aria-label',text);
    $('#compare').textContent = state.comparing ? '退出连看' : '连看第二幕';
  }
  function stopComparison() {
    if(!state.comparing) return;
    previous.pause(); previous.hidden = true; state.comparing = false; state.phase=-2; dirty=true;
    updatePlayLabel();
  }
  function pause(manual = false) {
    state.playing=false; previous.pause(); if(manual)stopComparison(); updatePlayLabel();
  }
  function reset() { pause(true); seek(0); paint(); }
  async function compare() {
    if(state.comparing) { pause(true); return; }
    reset(); state.comparing=true; previous.hidden=false; previous.currentTime=0;
    state.playing=true; dirty=true; updatePlayLabel();
    try { await previous.play(); }
    catch { pause(true); showStatus('第二幕视频暂时无法播放。可直接滚动体验第三幕。'); }
  }
  previous.addEventListener('ended',()=>{
    state.comparing=false; seek(0); paint(); previous.hidden=true; state.playing=true;
    lastFrame=performance.now(); updatePlayLabel();
  });
  previous.addEventListener('error',()=>{
    if(state.comparing) {pause(true);showStatus('第二幕视频未能加载。可直接滚动体验第三幕。');}
  });
  function immersive(enabled) {
    document.body.classList.toggle('immersive',enabled); $('#exitImmersive').hidden=!enabled;
    for(const item of document.querySelectorAll('.chrome')) item.inert=enabled;
    if(enabled)$('#exitImmersive').focus({preventScroll:true});
    else $('#immerse').focus({preventScroll:true});
  }
  $('#compare').addEventListener('click',compare);
  $('#orbitStep').addEventListener('click',()=>{pause(true);seek(ROTATION_START*EARTH_END);paint();});
  $('#coastStep').addEventListener('click',()=>{pause(true);seek(COAST_START);paint();});
  $('#play').addEventListener('click',async()=>{
    if(state.playing) {pause();return;}
    if(!state.ready)return;
    if(state.progress>.999)seek(0);
    if(state.comparing){try{await previous.play();}catch{pause(true);return;}}
    state.playing=true; lastFrame=performance.now(); updatePlayLabel();
  });
  $('#replay').addEventListener('click',reset); $('#home').addEventListener('click',event=>{event.preventDefault();reset();});
  $('#progress').addEventListener('input',event=>{pause(true);seek(Number(event.target.value)/1000);paint();});
  $('#immerse').addEventListener('click',()=>immersive(true)); $('#exitImmersive').addEventListener('click',()=>immersive(false));
  addEventListener('wheel',()=>pause(true),{passive:true});
  addEventListener('touchstart',event=>{if(!event.target.closest('button,input,a'))pause(true);},{passive:true});
  addEventListener('keydown',event=>{
    if(event.key==='Escape')immersive(false);
    if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)&&!event.target.closest('button,input'))pause(true);
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();lastFrame=performance.now();updateCityMotion();});
  reducedMotion.addEventListener('change',()=>{pause(true);dirty=true;});
  earth.addEventListener('webglcontextlost',event=>{
    event.preventDefault();pause(true);state.ready=false;document.body.classList.remove('ready');
    for(const id of ['play','compare','progress','orbitStep','coastStep'])$('#'+id).disabled=true;
    showStatus('地球画面已暂停。请刷新恢复。');
  });
  function tick(now) {
    if(disposed)return;
    const dt = Math.min(50,now-lastFrame); lastFrame=now;
    if(document.hidden){requestAnimationFrame(tick);return;}
    if(state.playing&&!state.comparing&&state.ready&&fixed===null){
      seek(state.progress+dt/autoplayDuration);
      if(state.progress>=1)pause();
    }
    if(dirty)paint();
    requestAnimationFrame(tick);
  }
  function initScroll() {
    if(fixed!==null||embedded)return;
    if(typeof gsap==='undefined'||typeof ScrollTrigger==='undefined'){
      addEventListener('scroll',()=>{state.progress=clamp(scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight));dirty=true;},{passive:true});return;
    }
    gsap.registerPlugin(ScrollTrigger);
    const playhead={value:0};
    animation=gsap.to(playhead,{value:1,ease:'none',onUpdate:()=>{
      if(!state.playing&&!state.comparing){state.progress=playhead.value;dirty=true;}
    },scrollTrigger:{trigger:'#journey',start:'top top',end:'bottom bottom',scrub:true,invalidateOnRefresh:true}});
    scrollTrigger=animation.scrollTrigger;
  }
  addEventListener('resize',()=>{resize();});
  new ResizeObserver(resize).observe($('.stage'));
  window.sceneDemo={
    seek(value){pause(true);seek(value);paint();},
    setActive(value){if(citySceneActive!==Boolean(value)){citySceneActive=Boolean(value);updateCityMotion();}},
    citiesSnapshot(){return cityNodes.map(node=>({id:node.city.id,name:node.city.name,label:node.label.textContent,longitude:node.city.longitude,latitude:node.city.latitude,point:node.point,opacity:node.opacity,focused:node.focused,box:node.box}));},
    viewportCoverProgress,
    snapshot(){return {progress:fixed??state.progress,radius,distance,ready:state.ready,playing:state.playing,comparing:state.comparing,width,height,reducedMotion:reducedMotion.matches,orientation:{...orientation},coastProgress,marker:{...marker},photoVisible:headquarters.style.opacity==='1',clouds:cloudFlight?.snapshot(),frontLongitude:((90+orientation.rotation*180/Math.PI+180)%360+360)%360-180,frontLatitude:-orientation.tilt*180/Math.PI};}
  };
  addEventListener('pagehide',()=>{disposed=true;previous.pause();scrollTrigger?.kill();animation?.kill();});
  resize();initScroll();setup();requestAnimationFrame(tick);
})();
