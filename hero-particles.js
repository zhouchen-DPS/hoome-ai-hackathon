(() => {
  'use strict';
  const canvas = document.getElementById('hero-particles');
  const video = document.getElementById('hero-video');
  const stage = document.querySelector('.opening-stage');
  if (!canvas || !video || !stage) return;
  const preference = matchMedia('(min-width:801px) and (hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference)');
  const MAX_FIELDS = 3, MAX_PARTICLES = 208, MAX_RECTS = 12;
  const particles = [], fields = [];
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  let gl, fieldProgram, pointProgram, fieldBuffer, pointBuffer, texture;
  let sampleCanvas, sampleCtx, pixels, sampleTime = -1;
  let sampleLeft = 0, sampleTop = 0, sampleWidth = 1, sampleHeight = 1;
  let textureCanvas, textureCtx;
  let bounds, width = 1, height = 1, dpr = 1, coverWidth = 1, coverHeight = 1, offsetX = 0, offsetY = 0;
  let rects = [], activeRectCount = 0, target = null, follower = null, flowStrength = 0, emissionCredit = 0;
  let lastMovementTime = -Infinity;
  let progress = 0, raf = 0, lastFrame = 0, emitted = 0, disposed = false, failed = false;
  let frameCount = 0, frameMs = 0, framePeak = 0, quality = 1, qualityPending = false, drawAverage = 0;
  let sampleWorker = null, sampleBusy = false, sampleVersion = 0, sampleRequest = null, lastSampleRequest = -Infinity;
  let sampleMode = 'worker', lastSampleAt = -Infinity, idleSample = 0, textureWidth = 0, textureHeight = 0;
  const fieldData = new Float32Array(8 * 4);
  const fieldQuad = new Float32Array(12);
  const rectData = new Float32Array(MAX_RECTS * 4);
  const pointData = new Float32Array(MAX_PARTICLES * 8);

  // Feather the source distortion and particle halos around the actual text bounds.
  const protection = `
    uniform vec4 u_rects[12];
    uniform int u_rectCount;
    float protectionAt(vec2 p) {
      float m = smoothstep(88.0, 112.0, p.y);
      for (int i = 0; i < 12; i++) {
        if (i >= u_rectCount) break;
        vec4 r = u_rects[i];
        vec2 outside = max(max(r.xy - p, p - r.zw), vec2(0.0));
        m *= smoothstep(0.0, 24.0, length(outside));
      }
      return m;
    }`;
  const fieldVertex = `
    precision highp float;
    attribute vec2 a_position;
    uniform vec2 u_size;
    varying vec2 v_position;
    void main() {
      v_position = a_position;
      gl_Position = vec4(a_position / u_size * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
    }`;
  const fieldFragment = `
    precision highp float;
    uniform sampler2D u_video;
    uniform vec2 u_cover, u_offset;
    uniform vec4 u_fields[8];
    uniform int u_fieldCount;
    uniform float u_fade;
    varying vec2 v_position;
    ${protection}
    void main() {
      vec2 displacement = vec2(0.0);
      float total = 0.0;
      for (int i = 0; i < 8; i++) {
        if (i >= u_fieldCount) break;
        vec4 f = u_fields[i];
        vec2 delta = v_position - f.xy;
        float distanceToCenter = length(delta);
        float n = distanceToCenter / f.z;
        float envelope = (1.0 - smoothstep(0.15, 1.0, n)) * f.w;
        // Sampling outward draws the source light inward without cutting holes.
        displacement += delta / max(distanceToCenter, 1.0) * sin(clamp(n, 0.0, 1.0) * 3.14159) * 12.0 * envelope;
        total += envelope;
      }
      float keep = protectionAt(v_position);
      vec2 uv = (v_position + u_offset) / u_cover;
      vec3 original = texture2D(u_video, uv).rgb;
      float hi = max(max(original.r, original.g), original.b);
      float lo = min(min(original.r, original.g), original.b);
      float colored = smoothstep(0.10, 0.30, hi) * smoothstep(0.14, 0.36, (hi - lo) / max(hi, 0.001));
      displacement /= max(1.0, total);
      vec3 pulled = texture2D(u_video, (v_position + u_offset + displacement * keep) / u_cover).rgb;
      float absorption = min(total, 1.0) * colored * keep;
      pulled *= 1.0 - 0.14 * absorption;
      float alpha = min(total * 1.7, 1.0) * keep * u_fade;
      gl_FragColor = vec4(pulled * alpha, alpha);
    }`;
  const pointVertex = `
    precision highp float;
    attribute vec2 a_position;
    attribute vec3 a_color;
    attribute vec3 a_shape;
    uniform vec2 u_size;
    uniform float u_dpr;
    varying vec3 v_color;
    varying vec2 v_shape;
    void main() {
      gl_Position = vec4(a_position / u_size * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
      gl_PointSize = a_shape.x * u_dpr;
      v_color = a_color;
      v_shape = a_shape.yz;
    }`;
  const pointFragment = `
    precision highp float;
    uniform vec2 u_size;
    uniform float u_dpr, u_fade;
    varying vec3 v_color;
    varying vec2 v_shape;
    ${protection}
    void main() {
      float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
      float core = 1.0 - smoothstep(v_shape.y * 0.5, v_shape.y, r);
      float halo = exp(-4.8 * r * r) * (1.0 - smoothstep(0.75, 1.0, r));
      float shoulder = exp(-22.0 * r * r);
      vec2 position = vec2(gl_FragCoord.x / u_dpr, u_size.y - gl_FragCoord.y / u_dpr);
      float alpha = (core * 0.85 + halo * 0.26 + shoulder * 0.12) * v_shape.x * protectionAt(position) * u_fade;
      gl_FragColor = vec4(v_color * alpha, alpha);
    }`;

  function allowed() {
    return preference.matches && !document.hidden && !disposed && !failed && progress < .018;
  }
  function clear() {
    cancelAnimationFrame(raf); raf = 0; lastFrame = 0;
    target = follower = null; fields.length = particles.length = 0; flowStrength = emissionCredit = 0;
    pixels = null; sampleVersion++; lastSampleRequest = -Infinity;
    if (gl && !gl.isContextLost()) { gl.disable(gl.SCISSOR_TEST); gl.clear(gl.COLOR_BUFFER_BIT); }
    canvas.style.opacity = '0'; canvas.dataset.cells = '0'; canvas.dataset.bursts = '0';
    canvas.dataset.phase = 'idle';
    canvas.dataset.state = failed ? 'unavailable' : preference.matches ? 'idle' : 'disabled';
    if (qualityPending && gl && !failed && !disposed) { quality = .8; qualityPending = false; resize(); }
  }
  function protectText() {
    rects = [];
    const add = r => rects.push({ left: r.left - bounds.left - 16, top: r.top - bounds.top - 14,
      right: r.right - bounds.left + 16, bottom: r.bottom - bounds.top + 14 });
    stage.querySelectorAll('.event-name,.hero-title-address,.hero-title-message,.hero-description').forEach(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      for (const r of range.getClientRects()) if (r.width && r.height) add(r);
    });
    stage.querySelectorAll('.hero-actions a,.opening-bottom a,.opening-bottom button').forEach(element => add(element.getBoundingClientRect()));
    // DOM ranges include nested spans and duplicate glyph bounds. Remove only
    // contained rectangles; never bridge unrelated text or distant buttons.
    rects = rects.filter((r, i, all) => !all.some((outer, j) => j !== i &&
      outer.left <= r.left && outer.top <= r.top && outer.right >= r.right && outer.bottom >= r.bottom &&
      (outer.left < r.left || outer.top < r.top || outer.right > r.right || outer.bottom > r.bottom || j < i)));
    canvas.dataset.protectionRects = String(rects.length);
  }
  function prepareProtection(left, top, right, bottom) {
    // Only masks touching this frame's local drawing area need GPU uniforms.
    // CPU hit testing retains every real rectangle regardless of shader capacity.
    const local = rects.filter(r => r.right + 24 >= left && r.left - 24 <= right &&
      r.bottom + 24 >= top && r.top - 24 <= bottom);
    activeRectCount = Math.min(local.length, MAX_RECTS);
    rectData.fill(0);
    local.slice(0, MAX_RECTS).forEach((r, i) => rectData.set([r.left, r.top, r.right, r.bottom], i * 4));
    // An exceptionally dense text area stays clear instead of masking blank space.
    return local.length <= MAX_RECTS;
  }
  function protectedPoint(x, y, margin = 0) {
    return y < 112 || rects.some(r => x > r.left - margin && x < r.right + margin && y > r.top - margin && y < r.bottom + margin);
  }
  function resize() {
    bounds = stage.getBoundingClientRect(); width = bounds.width; height = bounds.height;
    dpr = Math.min(devicePixelRatio || 1, 1.5) * quality;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    dpr = canvas.width / width;
    if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
    const pos = getComputedStyle(video).objectPosition.split(/\s+/).map(v => parseFloat(v) / 100);
    const scale = Math.max(width / (video.videoWidth || 1920), height / (video.videoHeight || 1080));
    coverWidth = (video.videoWidth || 1920) * scale; coverHeight = (video.videoHeight || 1080) * scale;
    offsetX = (coverWidth - width) * (Number.isFinite(pos[0]) ? pos[0] : .5);
    offsetY = (coverHeight - height) * (Number.isFinite(pos[1]) ? pos[1] : .5);
    if (sampleCanvas) {
      sampleCanvas.width = sampleCanvas.height = 128;
    }
    sampleTime = -1; pixels = null; protectText();
    sampleVersion++; textureWidth = textureHeight = 0;
    canvas.dataset.resolution = `${canvas.width}x${canvas.height}`;
  }
  function program(vertexSource, fragmentSource) {
    const compile = (type, source) => {
      const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const result = gl.createProgram(), vs = compile(gl.VERTEX_SHADER, vertexSource), fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(result, vs); gl.attachShader(result, fs); gl.linkProgram(result);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result));
    const uniforms = {};
    ['size','cover','offset','fields','fieldCount','rects','rectCount','fade','video','dpr'].forEach(name => {
      uniforms[name] = gl.getUniformLocation(result, `u_${name}${['fields','rects'].includes(name) ? '[0]' : ''}`);
    });
    const attributes = {};
    ['position','color','shape'].forEach(name => { attributes[name] = gl.getAttribLocation(result, `a_${name}`); });
    return { program: result, uniforms, attributes };
  }
  function fail(error) {
    failed = true; console.warn('Hero light bloom unavailable:', error.message); clear();
  }
  function init() {
    if (gl || failed) return Boolean(gl && !failed);
    try {
      gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
      if (!gl) throw new Error('WebGL is not available');
      sampleCanvas = document.createElement('canvas');
      sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
      textureCanvas = document.createElement('canvas');
      textureCtx = textureCanvas.getContext('2d', { alpha: false });
      if (!sampleCtx || !textureCtx) throw new Error('Video color sampling is not available');
      fieldProgram = program(fieldVertex, fieldFragment); pointProgram = program(pointVertex, pointFragment);
      fieldBuffer = gl.createBuffer(); pointBuffer = gl.createBuffer(); texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.clearColor(0, 0, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer); gl.bufferData(gl.ARRAY_BUFFER, pointData.byteLength, gl.DYNAMIC_DRAW);
      resize(); startSampler(); canvas.dataset.renderer = 'webgl'; canvas.dataset.motion = 'continuous'; return true;
    } catch (error) { fail(error); return false; }
  }
  function acceptSample(request, data, cost) {
    if (request.id !== sampleVersion || !allowed()) return;
    pixels = data; sampleLeft = request.left; sampleTop = request.top;
    sampleWidth = request.width; sampleHeight = request.height;
    sampleTime = request.videoTime; lastSampleAt = request.created;
    canvas.dataset.sampler = sampleMode; canvas.dataset.sampleCpuMs = cost.toFixed(1);
  }
  function fallbackSampler() {
    sampleWorker?.terminate(); sampleWorker = null; sampleMode = 'idle-main';
    sampleBusy = false; sampleRequest = null; lastSampleRequest = -Infinity;
    canvas.dataset.sampler = sampleMode;
  }
  function startSampler() {
    if (sampleWorker || sampleMode === 'idle-main') return;
    if (typeof Worker !== 'function' || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') { fallbackSampler(); return; }
    try {
      sampleWorker = new Worker(new URL('hero-color-sampler.js', document.baseURI));
      sampleWorker.onmessage = event => {
        const request = sampleRequest; sampleBusy = false; sampleRequest = null;
        if (event.data.error) { fallbackSampler(); return; }
        if (request && request.id === event.data.id) acceptSample(request, event.data.pixels, event.data.cpuMs);
      };
      sampleWorker.onerror = fallbackSampler;
    } catch { fallbackSampler(); }
  }
  function queueSample(x, y, radius, now) {
    if (sampleBusy || now - lastSampleRequest < 90 || video.readyState < 2 || video.seeking) return;
    startSampler(); sampleBusy = true; lastSampleRequest = now;
    const margin = 64;
    const left = Math.max(-offsetX, x - radius - margin), top = Math.max(-offsetY, y - radius - margin);
    const right = Math.min(coverWidth - offsetX, x + radius + margin), bottom = Math.min(coverHeight - offsetY, y + radius + margin);
    const sx = Math.max(0, Math.floor((left + offsetX) / coverWidth * video.videoWidth));
    const sy = Math.max(0, Math.floor((top + offsetY) / coverHeight * video.videoHeight));
    const sw = Math.min(video.videoWidth - sx, Math.ceil((right - left) / coverWidth * video.videoWidth));
    const sh = Math.min(video.videoHeight - sy, Math.ceil((bottom - top) / coverHeight * video.videoHeight));
    const request = { id: ++sampleVersion, sx, sy, sw, sh, created: now, videoTime: video.currentTime,
      left: sx / video.videoWidth * coverWidth - offsetX, top: sy / video.videoHeight * coverHeight - offsetY,
      width: sw / video.videoWidth * coverWidth, height: sh / video.videoHeight * coverHeight };
    sampleRequest = request;
    if (sampleMode === 'worker') {
      createImageBitmap(video, sx, sy, sw, sh, { resizeWidth: 128, resizeHeight: 128, resizeQuality: 'low' }).then(bitmap => {
        if (!sampleWorker || request.id !== sampleVersion || !allowed()) { bitmap.close(); sampleBusy = false; sampleRequest = null; return; }
        sampleWorker.postMessage({ id: request.id, bitmap }, [bitmap]);
      }).catch(fallbackSampler);
    } else {
      const read = () => {
        idleSample = 0;
        try {
          if (request.id !== sampleVersion || !allowed()) return;
          const started = performance.now();
          sampleCtx.drawImage(video, sx, sy, sw, sh, 0, 0, 128, 128);
          request.videoTime = video.currentTime;
          acceptSample(request, sampleCtx.getImageData(0, 0, 128, 128).data, performance.now() - started);
        } catch (error) { fail(error); }
        finally { sampleBusy = false; sampleRequest = null; }
      };
      idleSample = typeof requestIdleCallback === 'function' ? requestIdleCallback(read, { timeout: 40 }) : setTimeout(read, 0);
    }
  }
  function colorAt(x, y) {
    const sx = (x - sampleLeft) / sampleWidth * sampleCanvas.width, sy = (y - sampleTop) / sampleHeight * sampleCanvas.height;
    if (sx < 1 || sy < 1 || sx >= sampleCanvas.width - 1 || sy >= sampleCanvas.height - 1) return null;
    const rgb = [0, 0, 0]; let total = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const weight = dx || dy ? 1 : 4, index = ((Math.floor(sy) + dy) * sampleCanvas.width + Math.floor(sx) + dx) * 4;
      for (let c = 0; c < 3; c++) rgb[c] += pixels[index + c] * weight;
      total += weight;
    }
    rgb.forEach((v, i) => { rgb[i] = Math.round(v / total); });
    const hi = Math.max(...rgb), lo = Math.min(...rgb), saturation = (hi - lo) / Math.max(1, hi);
    if (hi < 56 || saturation < .24) return null;
    return { rgb, energy: (hi / 255) ** 2 * saturation,
      strength: .55 + .45 * clamp((hi - 56) / 150) * clamp((saturation - .24) / .4) };
  }
  function release(x, y, nx, ny, speed, now, count, span) {
    if (!pixels || now - lastSampleAt > 220 || protectedPoint(x, y, 10)) return;
    const fast = clamp(speed / 1.8), radius = 76 + fast * 22, candidates = [];
    const rotation = Math.random() * Math.PI * 2, attempts = Math.max(24, count * 8);
    for (let i = 0; i < attempts; i++) {
      const angle = rotation + i * 2.399963, distance = radius * Math.sqrt((i + .5) / attempts);
      const sx = x + Math.cos(angle) * distance, sy = y + Math.sin(angle) * distance;
      if (sx < 0 || sy < 0 || sx > width || sy > height || protectedPoint(sx, sy, 12)) continue;
      const color = colorAt(sx, sy);
      if (color) candidates.push({ sx, sy, angle, distance, ...color, priority: Math.random() ** (1 / (.015 + color.energy)) });
    }
    candidates.sort((a, b) => b.priority - a.priority);
    candidates.length = Math.min(count, candidates.length, MAX_PARTICLES - particles.length);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i], turn = (Math.random() < .5 ? -1 : 1) * (.7 + Math.random() * .65);
      const angle = c.angle + turn, reach = 30 + Math.random() * 30 + fast * 8;
      const ux = Math.cos(c.angle), uy = Math.sin(c.angle), vx = Math.cos(angle), vy = Math.sin(angle);
      const gain = Math.min(1.22, 255 / Math.max(...c.rgb));
      particles.push({ sx: c.sx, sy: c.sy,
        c1x: x - ux * c.distance * .22, c1y: y - uy * c.distance * .22,
        c2x: x + vx * reach * .12, c2y: y + vy * reach * .12,
        ex: x + vx * reach + nx * fast * 10, ey: y + vy * reach + ny * fast * 10,
        born: now - span * (1 - (i + .5) / Math.max(1, candidates.length)), duration: 620 + Math.random() * 180,
        diameter: Math.random() < .12 ? 7 + Math.random() * 2 : 3 + Math.random() * 3,
        halo: 11 + Math.random() * 6, strength: c.strength, rgb: c.rgb.map(v => v * gain / 255), visibility: 1 });
      emitted++;
    }
    canvas.dataset.emitted = String(emitted); canvas.dataset.releaseCount = String(candidates.length);
    if (candidates.length) {
      const c = candidates[candidates.length - 1];
      canvas.dataset.sourceColor = c.rgb.join(','); canvas.dataset.sourceTime = sampleTime.toFixed(4);
      canvas.dataset.sourcePosition = `${c.sx.toFixed(1)},${c.sy.toFixed(1)}`;
    }
    canvas.dataset.radius = radius.toFixed(1); canvas.dataset.speed = speed.toFixed(3);
  }
  // One differentiable path, rather than stopping at the center and switching velocity.
  function particlePosition(p, now) {
    const q = clamp((now - p.born) / p.duration), t = 1 - (1 - q) ** 2.2, a = 1 - t;
    return { x: a ** 3 * p.sx + 3 * a * a * t * p.c1x + 3 * a * t * t * p.c2x + t ** 3 * p.ex,
      y: a ** 3 * p.sy + 3 * a * a * t * p.c1y + 3 * a * t * t * p.c2y + t ** 3 * p.ey };
  }
  function onPointer(event) {
    if (event.pointerType !== 'mouse' || !allowed() || video.readyState < 2) return;
    if (!init()) return;
    if (event.target.closest('a,button,input,select,textarea,summary')) { target = null; return; }
    const now = performance.now(), x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    if (x < 0 || x > width || y < 0 || y > height || protectedPoint(x, y, 8)) { target = null; return; }
    const dx = target ? x - target.x : 0, dy = target ? y - target.y : 0, distance = Math.hypot(dx, dy);
    if (target && distance < .05) return;
    const speed = target ? distance / Math.max(1, now - target.time) : .2, old = target;
    lastMovementTime = now;
    target = { x, y, time: now, nx: distance > .1 ? dx / distance : old?.nx || 1,
      ny: distance > .1 ? dy / distance : old?.ny || 0, speed: mix(old?.speed || 0, speed, .4) };
    if (!follower || (!old && flowStrength < .01)) {
      follower = { x, y }; fields.length = 0;
      for (let i = 0; i < MAX_FIELDS; i++) fields.push({ x, y });
    }
    if (!raf) raf = requestAnimationFrame(draw);
  }
  function common(pass, fade) {
    gl.useProgram(pass.program);
    gl.uniform2f(pass.uniforms.size, width, height); gl.uniform1f(pass.uniforms.fade, fade);
    gl.uniform1f(pass.uniforms.dpr, dpr); gl.uniform4fv(pass.uniforms.rects, rectData);
    gl.uniform1i(pass.uniforms.rectCount, activeRectCount);
  }
  function attribute(pass, name, count, stride, offset) {
    const location = pass.attributes[name.slice(2)];
    gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, count, gl.FLOAT, false, stride, offset);
    return location;
  }
  function draw(now) {
    const drawStarted = performance.now();
    raf = 0;
    if (!allowed()) { clear(); return; }
    const elapsedFrame = lastFrame ? now - lastFrame : 16.7;
    const dt = Math.min(elapsedFrame / 1000, .05); lastFrame = now;
    frameCount++; frameMs += elapsedFrame; framePeak = Math.max(framePeak, elapsedFrame);
    if (frameCount % 30 === 0) {
      canvas.dataset.frameMs = (frameMs / frameCount).toFixed(1); canvas.dataset.framePeakMs = framePeak.toFixed(1);
    }
    const inputAge = target ? now - target.time : Infinity;
    const activity = 1 - smooth(45, 155, inputAge);
    flowStrength = mix(flowStrength, activity, 1 - Math.exp(-dt / (activity > flowStrength ? .045 : .11)));
    if (follower && target) {
      const follow = 1 - Math.exp(-dt / .035);
      follower.x = mix(follower.x, target.x, follow); follower.y = mix(follower.y, target.y, follow);
    }
    if (follower) {
      for (let i = 0; i < fields.length; i++) {
        const lead = i ? fields[i - 1] : follower, follow = 1 - Math.exp(-dt / (.025 + i * .018));
        fields[i].x = mix(fields[i].x, lead.x, follow); fields[i].y = mix(fields[i].y, lead.y, follow);
      }
    }
    // Sampling is asynchronous and independent of the number of particles released.
    if (target && follower && activity > .02) {
      const fast = clamp(target.speed / 1.8), radius = 76 + fast * 22;
      queueSample(follower.x, follower.y, radius, now);
      const rate = 160 + fast * 80;
      // No catch-up burst after an inactive tab, stalled frame or missing color sample.
      if (!pixels || now - lastSampleAt > 220) emissionCredit = 0;
      else {
        if (elapsedFrame > 100) emissionCredit = 0;
        const releaseDt = Math.min(dt, 1 / 30);
        emissionCredit += rate * activity * releaseDt;
        const count = Math.floor(emissionCredit); emissionCredit -= count;
        if (count) release(follower.x, follower.y, target.nx, target.ny, target.speed, now, count, releaseDt * 1000);
      }
    } else emissionCredit = 0;
    for (let i = particles.length - 1; i >= 0; i--) {
      if (now - particles[i].born >= particles[i].duration || particles[i].visibility < .005 || now - lastMovementTime >= 800) particles.splice(i, 1);
    }
    if (flowStrength < .003 && !particles.length && activity < .003) { clear(); return; }
    const fade = 1 - smooth(.002, .018, progress);
    let left = width, top = height, right = 0, bottom = 0;
    const include = (x, y, extent) => {
      left = Math.min(left, x - extent); top = Math.min(top, y - extent);
      right = Math.max(right, x + extent); bottom = Math.max(bottom, y + extent);
    };
    const fieldActive = flowStrength > .003 && fields.length > 0;
    const radius = 76 + clamp((target?.speed || 0) / 1.8) * 22;
    fieldData.fill(0);
    if (fieldActive) fields.forEach((f, i) => {
      const weight = [.66, .24, .1][i];
      fieldData.set([f.x, f.y, radius, flowStrength * weight], i * 4);
      include(f.x, f.y, radius + 18);
    });
    let count = 0;
    for (const p of particles) {
      const elapsed = now - p.born, age = clamp(elapsed / p.duration), position = particlePosition(p, now);
      const proximity = follower ? 1 - smooth(140, 280, Math.hypot(position.x - follower.x, position.y - follower.y)) : 1;
      p.visibility = Math.min(p.visibility, proximity);
      const alpha = smooth(0, 55, elapsed) * (1 - smooth(.27, 1, age)) ** 1.2 * p.strength * p.visibility * (1 - smooth(500, 800, now - lastMovementTime));
      const halo = mix(7, p.halo, smooth(60, 240, elapsed));
      pointData.set([position.x, position.y, ...p.rgb, halo * 2, alpha, p.diameter / (halo * 2)], count++ * 8);
      include(position.x, position.y, halo + 2);
    }
    left = clamp(left, 0, width); right = clamp(right, 0, width);
    top = clamp(top, 0, height); bottom = clamp(bottom, 0, height);
    if (right <= left || bottom <= top) { clear(); return; }
    if (!prepareProtection(left, top, right, bottom)) {
      gl.disable(gl.SCISSOR_TEST); gl.clear(gl.COLOR_BUFFER_BIT);
      canvas.style.opacity = '0';
      raf = requestAnimationFrame(draw); return;
    }
    try {
      gl.disable(gl.SCISSOR_TEST); gl.clear(gl.COLOR_BUFFER_BIT); gl.enable(gl.SCISSOR_TEST);
      gl.scissor(Math.floor(left * dpr), Math.max(0, Math.floor((height - bottom) * dpr)),
        Math.min(canvas.width, Math.ceil((right - left) * dpr) + 2), Math.min(canvas.height, Math.ceil((bottom - top) * dpr) + 2));
      gl.enable(gl.BLEND);
      if (fieldActive && video.readyState >= 2 && !video.seeking) {
        const cropLeft = Math.max(-offsetX, left - 18), cropTop = Math.max(-offsetY, top - 18);
        const cropRight = Math.min(coverWidth - offsetX, right + 18), cropBottom = Math.min(coverHeight - offsetY, bottom + 18);
        const cropWidth = cropRight - cropLeft, cropHeight = cropBottom - cropTop;
        const textureScale = Math.min(quality, 1024 / Math.max(cropWidth, cropHeight));
        const tw = Math.max(16, Math.ceil(cropWidth * textureScale / 16) * 16);
        const th = Math.max(16, Math.ceil(cropHeight * textureScale / 16) * 16);
        if (textureCanvas.width !== tw || textureCanvas.height !== th) { textureCanvas.width = tw; textureCanvas.height = th; }
        textureCtx.drawImage(video, (cropLeft + offsetX) / coverWidth * video.videoWidth,
          (cropTop + offsetY) / coverHeight * video.videoHeight, cropWidth / coverWidth * video.videoWidth,
          cropHeight / coverHeight * video.videoHeight, 0, 0, tw, th);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
        if (textureWidth !== tw || textureHeight !== th) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textureCanvas);
          textureWidth = tw; textureHeight = th;
        } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, textureCanvas);
        common(fieldProgram, fade); gl.uniform1i(fieldProgram.uniforms.video, 0);
        gl.uniform2f(fieldProgram.uniforms.cover, cropWidth, cropHeight); gl.uniform2f(fieldProgram.uniforms.offset, -cropLeft, -cropTop);
        gl.uniform4fv(fieldProgram.uniforms.fields, fieldData); gl.uniform1i(fieldProgram.uniforms.fieldCount, fields.length);
        gl.bindBuffer(gl.ARRAY_BUFFER, fieldBuffer);
        fieldQuad.set([left, top, right, top, left, bottom, left, bottom, right, top, right, bottom]);
        gl.bufferData(gl.ARRAY_BUFFER, fieldQuad, gl.STREAM_DRAW);
        const fieldAttribute = attribute(fieldProgram, 'a_position', 2, 0, 0);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.disableVertexAttribArray(fieldAttribute); canvas.dataset.textureSize = tw + 'x' + th;
      }
      common(pointProgram, fade);
      gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pointData.subarray(0, count * 8));
      const attributes = [attribute(pointProgram, 'a_position', 2, 32, 0), attribute(pointProgram, 'a_color', 3, 32, 8), attribute(pointProgram, 'a_shape', 3, 32, 20)];
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, count); attributes.forEach(location => gl.disableVertexAttribArray(location));
      if (frameCount === 2) canvas.dataset.glError = String(gl.getError());
      const cost = performance.now() - drawStarted;
      drawAverage = mix(drawAverage, cost, .08);
      if (quality === 1 && frameCount > 90 && drawAverage > 16) qualityPending = true;
      canvas.dataset.renderFrames = String(frameCount); canvas.dataset.drawCpuMs = cost.toFixed(1);
      canvas.style.opacity = '1'; canvas.dataset.state = 'active'; canvas.dataset.cells = String(count);
      canvas.dataset.bursts = '0'; canvas.dataset.fields = String(fields.length);
      canvas.dataset.phase = activity > .02 ? 'flow' : 'settling'; canvas.dataset.flowStrength = flowStrength.toFixed(3);
      raf = requestAnimationFrame(draw);
    } catch (error) { fail(error); }
  }
  stage.addEventListener('pointermove', onPointer, { passive: true });
  stage.addEventListener('pointerleave', () => { target = null; });
  addEventListener('scroll', () => { target = null; if (progress >= .018) clear(); }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  preference.addEventListener('change', clear);
  new ResizeObserver(() => { clear(); if (gl && !failed) resize(); }).observe(stage);
  video.addEventListener('loadeddata', () => { if (gl && !failed) { clear(); resize(); } });
  document.fonts.ready.then(() => { if (gl && !failed) protectText(); });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); failed = true; clear(); });
  canvas.addEventListener('webglcontextrestored', () => { gl = null; failed = false; clear(); });
  addEventListener('pagehide', () => {
    disposed = true; clear(); sampleWorker?.terminate(); sampleWorker = null; sampleBusy = false; sampleRequest = null;
    if (idleSample) { if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idleSample); clearTimeout(idleSample); idleSample = 0; }
  });
  addEventListener('pageshow', () => { disposed = false; clear(); });
  window.HoomeParticles = { setProgress(value) { progress = value; if (value >= .018 || !preference.matches) clear(); } };
})();
