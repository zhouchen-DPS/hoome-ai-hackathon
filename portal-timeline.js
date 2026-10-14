(() => {
  'use strict';
  const root = document.querySelector('#portal-timeline');
  if (!root) return;
  const items = [...root.querySelectorAll('.route-event')];
  const months = [...root.querySelectorAll('.route-months > span')];
  const labels = items.map(item => item.querySelector('h3'));
  // Separate fixed line breaks keep the zoom-out free of layout jumps.
  const overviewLines = [
    ['全员AI行动季','发布会'],
    ['首届AI黑客松','发布'], ['2天1晚','AI黑客松先锋营'], ['AI黑客松','部门项目集结'],
    ['AI黑客松','加速营'], ['全员AI能力L2','考核认定'],
    ['灏米创新AI年度成果','评审&AI黑客松决赛'], ['各部门AI','先锋认证'], ['AI奖项','颁奖']
  ];
  const overviewLabels = items.map((item, i) => {
    const label = document.createElement('h3');
    label.className = 'route-overview-label';
    label.setAttribute('aria-hidden', 'true');
    overviewLines[i].forEach(line => { const span = document.createElement('span');span.textContent = line;label.append(span); });
    item.append(label);
    return label;
  });
  const arcs = items.map(item => {
    if (!item.classList.contains('is-key')) return null;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.classList.add('route-arc');svg.setAttribute('viewBox', '0 0 64 64');svg.setAttribute('aria-hidden', 'true');
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', '32');circle.setAttribute('cy', '32');circle.setAttribute('r', '30');circle.setAttribute('pathLength', '100');
    svg.append(circle);item.querySelector('.route-node').append(svg);
    return circle;
  });
  const stems = items.map(item => item.querySelector('.route-stem'));
  const heading = root.querySelector('.route-heading');
  const learning = root.querySelector('.route-learning');
  const travel = root.querySelector('.route-track-travel');
  const arrival = root.querySelector('.route-track-arrival');
  const beam = root.querySelector('.route-beam');
  const markers = items.map(item => {
    if (!item.classList.contains('is-key')) return null;
    const marker = document.createElement('span');marker.className = 'route-focus-marker';marker.setAttribute('aria-hidden', 'true');item.append(marker);
    const halo = document.createElement('b');halo.className = 'route-node-halo';item.querySelector('.route-node').append(halo);
    return marker;
  });
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  // Crop the now-empty September range, keeping the source month/node relationship.
  const axisPosition = position => (position - .205) / .795;
  const positions = items.map(item => axisPosition(Number(item.dataset.position)));
  // Start exactly where the replaced question copy began; finish before Earth enters.
  const start = .09, end = .398;
  let width = innerWidth;
  let lastActive = false;
  let lastCurrent = -1;
  let lastProgress = -1;
  let lastMotion;
  // Convert source-axis month positions into the equally paced reading journey.
  function sourceIndex(position) {
    if (position < positions[0]) return (position - positions[0]) / (positions[1] - positions[0]);
    for (let i = 1; i < positions.length; i++) {
      if (position <= positions[i]) return i - 1 + (position - positions[i - 1]) / (positions[i] - positions[i - 1]);
    }
    return items.length - 1;
  }
  const monthIndices = months.map(month => sourceIndex(axisPosition(Number(month.dataset.position))));
  function resetStatic() {
    root.removeAttribute('style');root.removeAttribute('aria-hidden');root.dataset.mode = 'static';
    ['routeProgress', 'currentIndex', 'cursor', 'overview'].forEach(key => delete root.dataset[key]);
    [...items, ...labels, ...overviewLabels, ...arcs.filter(Boolean), ...markers.filter(Boolean), ...stems, ...months, heading, learning, travel, arrival, beam].forEach(element => element.removeAttribute('style'));
    items.forEach(item => { item.removeAttribute('aria-current');delete item.dataset.state; });
    lastCurrent = -1;lastActive = false;lastProgress = -1;
  }
  function render(p, motion) {
    if (!motion) { if (lastMotion !== false) resetStatic();lastMotion = false;return; }
    const changedMode = lastMotion !== true;
    lastMotion = true;
    const q = clamp((p - start) / (end - start));
    const alpha = smooth(0, .06, q) * (1 - smooth(.90, 1, q));
    const active = p > start && p < end;
    if (!changedMode && !active && !lastActive) return;
    if (!changedMode && Math.abs(p - lastProgress) < .000001 && width === innerWidth) return;
    width = innerWidth;lastProgress = p;lastActive = active;
    const overview = smooth(.72, .80, q);
    const passage = clamp((q - .06) / .66) * (items.length - 1);
    const cursor = Math.floor(passage) + smooth(.28, .72, passage % 1);
    const current = Math.round(cursor);
    const spacing = Math.min(480, width * (width <= 1100 ? .38 : .32));
    const span = width * .80;
    const flightPhase = q < .06 ? clamp(q / .06) : passage % 1;
    const flight = smooth(.05, .72, flightPhase);
    const flightAlpha = smooth(0, .12, flightPhase) * (1 - smooth(.80, .99, flightPhase)) * (1 - overview);
    const sweep = smooth(.80, .86, q);
    const sweepAlpha = smooth(.80, .808, q) * (1 - smooth(.86, .872, q));
    const sweeping = q >= .80;
    const beamX = sweeping ? sweep * span : span * (.5 + .5 * (1 - flight));
    beam.style.transform = `translate3d(${beamX.toFixed(2)}px,0,0) scaleX(${sweeping ? -1 : 1})`;
    beam.style.opacity = String(sweeping ? sweepAlpha : flightAlpha);
    const overviewTypeScale = width <= 1100 ? .45 : .40;
    root.style.opacity = alpha.toFixed(4);
    root.style.setProperty('--route-overview', overview.toFixed(5));
    root.style.visibility = active ? 'visible' : 'hidden';
    root.setAttribute('aria-hidden', String(!active));
    root.dataset.mode = overview > .995 ? 'overview' : overview > 0 ? 'expanding' : 'travel';
    root.dataset.routeProgress = q.toFixed(5);
    root.dataset.currentIndex = String(current);
    root.dataset.cursor = cursor.toFixed(5);
    root.dataset.overview = overview.toFixed(5);
    heading.style.transform = `translate3d(0,${-8 * overview}px,0)`;
    heading.style.opacity = String(lerp(.8, 1, overview));
    travel.style.transform = `scaleX(${lerp(.5, 1, overview)})`;
    arrival.style.opacity = String((1 - overview) * (.35 + .45 * (1 - Math.abs(cursor - current) * 2)));
    arrival.style.transform = `scaleX(${1 - Math.abs(cursor - current) * .7})`;
    items.forEach((item, i) => {
      const delta = i - cursor;
      const focus = 1 - smooth(.10, .90, Math.abs(delta));
      const visible = 1 - smooth(.95, 1.35, Math.abs(delta));
      const future = delta > 0;
      const opacity = lerp(visible * lerp(future ? .46 : .25, 1, focus), 1, overview);
      const x = lerp(delta * spacing, (positions[i] - .5) * span, overview);
      const z = -Math.min(150, Math.abs(delta) * 80) * (1 - overview);
      const depthScale = lerp(.76 + .24 * focus, 1, overview);
      const titleScale = lerp(depthScale, overviewTypeScale, overview);
      const lower = i % 2 === 1;
      const titleY = lerp(-76, lower ? 124 : -66, overview);
      const pulse = focus * (1 - overview);
      item.style.transform = `translate3d(${x.toFixed(2)}px,0,${z.toFixed(2)}px)`;
      item.style.opacity = opacity.toFixed(4);
      item.style.visibility = opacity > .005 ? 'visible' : 'hidden';
      const key = item.classList.contains('is-key');
      const response = key ? (1 - smooth(0, .075, Math.abs(sweep - positions[i]))) * sweepAlpha : 0;
      item.style.setProperty('--node-scale', String(lerp(key ? 1.05 + focus * .30 : .70 + focus * .20, key ? .68 : .30, overview)));
      item.style.setProperty('--ring-scale', String(1 + pulse * .18 + response * .25));
      item.style.setProperty('--node-energy', String(Math.max(pulse, response)));
      if (markers[i]) { markers[i].style.opacity = String(focus * (1 - overview));markers[i].style.transform = `scaleX(${.35 + focus * .65})`; }
      item.style.setProperty('--ring-opacity', String(lerp(.35 + pulse * .65, .85, overview)));
      item.style.setProperty('--ring-angle', `${(cursor - i) * 28}deg`);
      const arrive = smooth(-.85, -.05, cursor - i);
      item.style.setProperty('--arc-angle', `${12 + arrive * 70}deg`);
      if (arcs[i]) arcs[i].style.strokeDasharray = `${lerp(7, 23, arrive)} 100`;
      labels[i].style.transform = `translate(-50%,${titleY}px) scale(${titleScale})`;
      labels[i].style.opacity = String(1 - smooth(.08, .28, overview));
      overviewLabels[i].style.transform = labels[i].style.transform;
      overviewLabels[i].style.opacity = String(smooth(.30, .58, overview));
      stems[i].style.opacity = String(overview * .65);
      stems[i].style.transform = lower ? 'scaleY(1)' : 'scaleY(-1)';
      if (current !== lastCurrent || changedMode) {
        item.dataset.state = i === current ? 'current' : i < current ? 'past' : 'upcoming';
        if (i === current) item.setAttribute('aria-current', 'step');else item.removeAttribute('aria-current');
      }
    });
    months.forEach((month, i) => {
      const delta = monthIndices[i] - cursor;
      const x = lerp(delta * spacing, (axisPosition(Number(month.dataset.position)) - .5) * span, overview);
      month.style.transform = `translate3d(${x}px,${lerp(0, -10, overview)}px,0) translateX(-50%)`;
      month.style.opacity = String(lerp(1 - smooth(1.10, 1.9, Math.abs(delta)), 1, overview));
    });
    learning.style.opacity = String(smooth(.80, .82, q));
    learning.style.transform = `translate3d(0,${(1 - overview) * 16}px,0)`;
    lastCurrent = current;
  }
  // Land after the overview and learning line have appeared, before the exit fade.
  window.HoomePortalRoute = { render, overviewProgress: () => start + (end - start) * .88 };
})();
