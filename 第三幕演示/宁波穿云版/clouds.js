(() => {
  'use strict';
  // The cloud field only changes with scroll progress: stopping or reversing the
  // scroll preserves the exact image, including the concealed scene handoff.
  window.createCloudFlight = canvas => {
    const gl=canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:false});
    if(!gl)throw new Error('云层 WebGL 不可用');
    const vertex='attribute vec2 a_position;void main(){gl_Position=vec4(a_position,0.,1.);}';
    const fragment=`
      precision highp float;
      uniform vec2 u_resolution;
      uniform float u_progress;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
      float fbm(vec2 p){float f=0.,a=.54;mat2 m=mat2(.8,-.6,.6,.8);for(int i=0;i<5;i++){f+=a*noise(p);p=m*p*2.03+vec2(4.7,9.2);a*=.49;}return f;}
      void main(){
        float p=u_progress;
        vec2 q=(gl_FragCoord.xy/u_resolution-.5)*vec2(u_resolution.x/u_resolution.y,1.);
        float enter=smoothstep(.775,.87,p),exit=smoothstep(.898,.981,p);
        float zoom=mix(5.8,1.25,smoothstep(.785,.915,p));
        vec2 domain=q*zoom+vec2(.55,-(p-.775)*7.);
        vec2 warp=vec2(fbm(domain*.6+3.),fbm(domain*.6+19.));
        float field=fbm(domain+warp*2.9);
        float fine=fbm(domain*3.4+7.1);
        float shape=field*.82+fine*.18;
        // Cloud banks first enter from the edges, then close across the center.
        // Hold every pixel fully opaque around .88, concealing the photographic cut.
        float radial=length(q*vec2(.72,1.));
        float threshold=mix(1.14,-.30,enter)+exit*1.55;
        float density=smoothstep(threshold,threshold+.25,shape+radial*.19);
        float hold=smoothstep(.854,.874,p)*(1.-smoothstep(.897,.914,p));
        float alpha=max(density,hold)*(1.-smoothstep(.978,.987,p));
        float light=clamp(.55+field*.40+fine*.08,0.,1.);
        vec3 shadow=mix(vec3(.18,.28,.39),vec3(.22,.38,.53),exit);
        vec3 highlight=mix(vec3(.78,.84,.89),vec3(.63,.78,.89),exit);
        vec3 color=mix(shadow,highlight,smoothstep(.22,.73,shape));
        color*=light;
        color+=vec3(.06,.08,.10)*pow(max(0.,1.-length(q-vec2(-.3,.3))*.7),3.);
        gl_FragColor=vec4(color,alpha);
      }`;
    const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;};
    const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const attribute=gl.getAttribLocation(program,'a_position');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);
    const resolution=gl.getUniformLocation(program,'u_resolution'),progressUniform=gl.getUniformLocation(program,'u_progress');
    let progress=0;
    return {
      resize(width,height){const ratio=Math.min(devicePixelRatio||1,width<800?1.25:1);canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);gl.viewport(0,0,canvas.width,canvas.height);},
      render(value){progress=value;gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);if(value<=.775||value>=.987)return;gl.useProgram(program);gl.uniform2f(resolution,canvas.width,canvas.height);gl.uniform1f(progressUniform,value);gl.drawArrays(gl.TRIANGLES,0,6);},
      snapshot(){return {progress,fullCover:progress>=.874&&progress<=.897,active:progress>.775&&progress<.987};}
    };
  };
})();
