(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, v) => { const t = clamp((v-a)/(b-a)); return t*t*(3-2*t); };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(min-width: 901px)');
  const opening = $('.opening'), stage = $('.opening-stage'), hero = $('.hero-copy');
  const first = $('#opening-video'), portal = $('#portal-video'), earth = $('#earth-frame');
  const heroVideo = $('#hero-video');
  const poster = $('#journey-poster'), scrim = $('.opening-scrim'), arrivalFade = $('.arrival-fade');
  const status = $('.journey-status'), bottom = $('.opening-bottom'), explore = $('[data-explore]');
  const stories = [...document.querySelectorAll('[data-story]')];
  const storyLines = new Map(stories.map(element=>[element,[...element.querySelectorAll('[data-story-line]')]]));
  const steps = [...document.querySelectorAll('.roadmap-step')];
  const timeline = { progress:0 };
  const scrollTimeline = { progress:0 };
  // Preserve the first two scenes' travel; add reading space only within Earth.
  function rotationTravel(){return innerHeight*1.1;}
  function journeySegments(){return [...(window.HoomeEarthBrief?[{start:.435,end:.58,extra:innerHeight*1.2}]:[]),{start:.58,end:.74,extra:rotationTravel()}];}
  function baseTravel(){return Math.max(1,opening.offsetHeight-stage.offsetHeight-journeySegments().reduce((sum,segment)=>sum+segment.extra,0));}
  function narrativeProgress(raw){
    const base=baseTravel(),distance=raw*(opening.offsetHeight-stage.offsetHeight);
    let inserted=0;
    for(const segment of journeySegments()){
      const start=base*segment.start+inserted,end=base*segment.end+inserted+segment.extra;
      if(distance<start)return clamp((distance-inserted)/base);
      if(distance<=end)return segment.start+(distance-start)/(end-start)*(segment.end-segment.start);
      inserted+=segment.extra;
    }
    return clamp((distance-inserted)/base);
  }
  function scrollDistance(progress){
    return progress*baseTravel()+journeySegments().reduce((sum,segment)=>sum+segment.extra*clamp((progress-segment.start)/(segment.end-segment.start)),0);
  }
  const spans = {question:[.09,.125,.23,.265],together:[.277,.307,.37,.409],value:[.45,.49,.645,.69],work:window.HoomeEarthBrief?[.81,.827,.846,.868]:[.713,.748,.822,.853],arrival:[.91,.949,1,1.1]};
  const videos = [first,portal];
  const primedVideos = new WeakSet();
  const posters = ['第一幕视频/第一幕-16-9-30帧-末帧.png','第二幕素材/第二幕尾帧-第三幕起始-1920x1080.png','灏米创新总部.png'];
  let mediaRequested=false, frameReady=false, raf=0, sceneProgress=-1;
  let journeyTween, navTrigger, lazyTimer, disposed=false;
  let heroRequested=false, heroPrimed=false, heroPlayPending=false, heroPlayBlocked=false;
  const failures = new Set();
  const motionEnabled = () => desktop.matches && !reduced.matches && typeof gsap!=='undefined' && typeof ScrollTrigger!=='undefined';
  function schedule(){if(!raf&&!disposed)raf=requestAnimationFrame(()=>{raf=0;render();});}
  function updateHeroVideo(p){
    const active=motionEnabled()&&!document.hidden&&!disposed&&p<.055;
    if(active&&!heroRequested){
      heroRequested=true;heroVideo.muted=true;
      heroVideo.src=heroVideo.dataset.src;heroVideo.preload='auto';heroVideo.load();
    }
    // The outgoing frame remains underneath the incoming scroll-driven clip.
    // Its opacity is never faded independently, avoiding a dark dip between layers.
    heroVideo.style.opacity=heroPrimed&&motionEnabled()&&p<.276?'1':'0';
    if(!active){heroVideo.pause();return;}
    if(heroPrimed&&heroVideo.paused&&!heroPlayPending&&!heroPlayBlocked){
      heroPlayPending=true;
      heroVideo.play().catch(()=>{heroPlayBlocked=true;}).finally(()=>{
        heroPlayPending=false;
        if(disposed||document.hidden||!motionEnabled()||timeline.progress>=.055)heroVideo.pause();
      });
    }
  }
  heroVideo.addEventListener('loadeddata',()=>{heroPrimed=true;schedule();});
  heroVideo.addEventListener('error',()=>{heroPrimed=false;heroPlayBlocked=true;schedule();});
  document.addEventListener('visibilitychange',schedule);
  ['pointerdown','keydown'].forEach(name=>addEventListener(name,()=>{
    if(heroPlayBlocked){heroPlayBlocked=false;schedule();}
  },{passive:true}));
  function requestMedia(){
    if(mediaRequested||!motionEnabled())return;
    mediaRequested=true;
    videos.forEach(video=>{video.src=video.dataset.src;video.preload='auto';video.load();});
    earth.src=earth.dataset.src;
    posters.forEach(src=>{const image=new Image();image.src=src;});
    schedule();
  }
  function seekVideo(video,fraction){
    if(!Number.isFinite(video.duration)||!primedVideos.has(video)||video.error)return false;
    const target=clamp(fraction)*Math.max(0,video.duration-.035);
    // Seek completion re-renders against the newest target, including reverse scroll.
    if(!video.seeking&&Math.abs(video.currentTime-target)>.035)video.currentTime=target;
    return true;
  }
  videos.forEach(video=>{
    video.addEventListener('loadeddata',()=>primedVideos.add(video));
    ['loadeddata','seeked','canplay'].forEach(name=>video.addEventListener(name,schedule));
    video.addEventListener('error',()=>{failures.add(video.id);schedule();});
  });
  earth.addEventListener('load',schedule);
  addEventListener('message',event=>{
    if(event.origin===location.origin&&event.source===earth.contentWindow&&event.data?.type==='hoome-earth-ready'){frameReady=true;schedule();}
  });
  function render(){
    const p=motionEnabled()?timeline.progress:0;
    updateHeroVideo(p);
    window.HoomeParticles?.setProgress(p);
    if(p>.002&&p<.998)requestMedia();
    const heroAlpha=1-smooth(.018,.09,p);
    hero.style.opacity=String(heroAlpha);hero.style.transform=`translate3d(0,${-30*(1-heroAlpha)}px,0)`;hero.inert=heroAlpha<.05;
    window.HoomePortalRoute?.render(p,motionEnabled());
    const firstOn=p>.018&&p<.276,portalOn=p>=.265&&p<.408,earthOn=p>=.398;
    const firstReady=firstOn&&seekVideo(first,(p-.018)/.247);
    const portalReady=portalOn&&seekVideo(portal,(p-.265)/.135);
    try{frameReady=Boolean(earth.contentWindow?.sceneDemo?.snapshot().ready);}catch{frameReady=false;}
    if(frameReady)earth.contentWindow.sceneDemo.setActive?.(earthOn&&motionEnabled());
    if(frameReady&&earthOn){const target=clamp((p-.4)/.55);if(Math.abs(target-sceneProgress)>.00001){earth.contentWindow.sceneDemo.seek(target);sceneProgress=target;}}
    window.HoomeEarthBrief?.render(p,motionEnabled(),frameReady?earth.contentWindow.sceneDemo.snapshot():null);
    stories.forEach(element=>{
      let span=spans[element.dataset.story];
      if(!span)return;
      if(element.dataset.story==='work'&&window.HoomeEarthBrief){
        const start=Math.max(.81,window.HoomeEarthBrief.fadeEnd()+.006);
        span=[start,start+.017,Math.max(.846,start+.04),Math.max(.868,start+.062)];
      }
      const [a,b,c,d]=span,opacity=smooth(a,b,p)*(1-smooth(c,d,p));
      element.style.opacity=String(opacity);element.style.visibility=opacity>.001?'visible':'hidden';
      element.style.transform=`translate3d(0,${(1-smooth(a,b,p))*24-smooth(c,d,p)*16}px,0)`;
      // Offset only the text entrance, using the same scroll progress as the camera.
      const lines=storyLines.get(element);
      lines.forEach((line,i)=>{
        const offset=i/Math.max(1,lines.length-1);
        const reveal=smooth(a+(b-a)*.24*offset,a+(b-a)*(.72+.28*offset),p);
        line.style.opacity=String(reveal);
        line.style.transform=`translate3d(0,${(1-reveal)*8}px,0)`;
      });
    });
    first.style.opacity=firstReady?String(smooth(.018,.035,p)):'0';
    portal.style.opacity=portalReady?String(smooth(.265,.276,p)):'0';
    earth.style.opacity=earthOn&&frameReady?String(smooth(.398,.408,p)):'0';
    const posterIndex=p>=.883?2:p>=.398?1:0;
    if(poster.dataset.index!==String(posterIndex)){poster.src=posters[posterIndex];poster.dataset.index=String(posterIndex);}
    poster.style.opacity=p>=.265?'1':'0';
    const visualPhase=p<.09?'hero':p<.265?'opening':p<.408?'portal':'earth';
    if(scrim.dataset.visualPhase!==visualPhase)scrim.dataset.visualPhase=visualPhase;
    scrim.style.opacity=String(p<.09?.78:p<.265?.5:p<.408?.63:p<.70?.83:p<.85?.7:.18+smooth(.89,.95,p)*.68);
    arrivalFade.style.opacity=String(smooth(.9,.99,p));
    explore.style.opacity=String(1-smooth(.02,.08,p));explore.inert=p>.08;
    const bottomAlpha=(1-smooth(.94,.99,p))*(window.HoomeEarthBrief?.isVisible()?0:1);
    bottom.style.opacity=String(bottomAlpha);bottom.inert=bottomAlpha<.05;
    const waiting=(firstOn&&!firstReady)||(portalOn&&!portalReady)||(earthOn&&!frameReady);
    status.hidden=!waiting||p<.05||p>.99;
    status.textContent=failures.size?'部分画面暂未加载，可继续阅读活动内容。':'画面加载中，可继续滚动或直接了解活动。';
    document.body.dataset.journeyProgress=p.toFixed(5);
  }
  function updatePhase(){
    if(!steps.length)return;
    let current=steps[0],closest=Infinity;
    for(const step of steps){const distance=Math.abs(step.getBoundingClientRect().top-innerHeight*.42);if(distance<closest){closest=distance;current=step;}}
    steps.forEach(step=>{const active=step===current;step.classList.toggle('is-current',active);if(active)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');});
    $('#current-phase-name').textContent=current.querySelector('h3').textContent;
  }
  function updateNavigation(){
    $('.site-header').classList.toggle('scrolled',scrollY>35);
    $('.site-header').classList.toggle('over-journey',scrollY>35&&scrollY<opening.offsetHeight-stage.offsetHeight);
    const name=motionEnabled()&&timeline.progress>.09&&timeline.progress<.398?'season':!motionEnabled()&&$('#portal-timeline').getBoundingClientRect().top<innerHeight*.45&&$('#portal-timeline').getBoundingClientRect().bottom>innerHeight*.2?'season':'hackathon';
    document.querySelectorAll('[data-nav]').forEach(link=>{if(link.dataset.nav===name)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
    updatePhase();
  }
  function setupMotion(){
    journeyTween?.scrollTrigger?.kill();journeyTween?.kill();navTrigger?.kill();clearTimeout(lazyTimer);
    document.body.classList.toggle('motion-ready',motionEnabled());timeline.progress=0;scrollTimeline.progress=0;
    if(motionEnabled()){
      gsap.registerPlugin(ScrollTrigger);
      journeyTween=gsap.to(scrollTimeline,{progress:1,ease:'none',onUpdate:()=>{timeline.progress=narrativeProgress(scrollTimeline.progress);render();},scrollTrigger:{trigger:opening,start:'top top',end:'bottom bottom',scrub:.16,invalidateOnRefresh:true}});
      navTrigger=ScrollTrigger.create({start:0,end:'max',onUpdate:updateNavigation});
      lazyTimer=setTimeout(()=>{if(scrollY<opening.offsetHeight-stage.offsetHeight)requestMedia();},1200);
      ScrollTrigger.refresh();
    }else videos.forEach(video=>video.pause());
    updateNavigation();render();
  }
  function navigateToAnchor(id){
    const target=document.getElementById(id.slice(1));if(!target)return;
    const anchor=target.id!=='hackathon'?(target.querySelector('h2')||target):target;
    if(id==='#portal-timeline'&&motionEnabled()){
      scrollTo({top:opening.offsetTop+scrollDistance(window.HoomePortalRoute.overviewProgress()),behavior:'instant'});
    }else if(id==='#earth-brief'&&motionEnabled()){
      scrollTo({top:opening.offsetTop+scrollDistance(window.HoomeEarthBrief.fullContentProgress()),behavior:'instant'});
    }else anchor.scrollIntoView({behavior:'instant',block:'start'});
    history.replaceState(null,'',id);
    if(!target.hasAttribute('tabindex'))target.setAttribute('tabindex','-1');target.focus({preventScroll:true});
    if(journeyTween){ScrollTrigger.update();journeyTween.progress(journeyTween.scrollTrigger.progress);}
    updateNavigation();schedule();
  }
  const menu=$('.menu-toggle'),nav=$('#main-nav');
  function closeMenu(){nav.classList.remove('is-open');menu.setAttribute('aria-expanded','false');}
  menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';nav.classList.toggle('is-open',open);menu.setAttribute('aria-expanded',String(open));});
  nav.addEventListener('click',event=>{if(event.target.closest('a,button'))closeMenu();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.getAttribute('aria-expanded')==='true'){closeMenu();menu.focus();}});
  document.addEventListener('click',event=>{if(!event.target.closest('.site-header'))closeMenu();});
  desktop.addEventListener('change',closeMenu);
  const contact=$('#contact-dialog');
  document.querySelectorAll('.contact-trigger').forEach(button=>button.addEventListener('click',()=>contact.showModal()));
  $('.contact-close').addEventListener('click',()=>contact.close());
  contact.addEventListener('click',event=>{if(event.target===contact){const box=contact.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)contact.close();}});
  contact.addEventListener('close',()=>{if(!desktop.matches)menu.focus();});
  document.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',event=>{
    if(!document.getElementById(link.getAttribute('href').slice(1)))return;
    event.preventDefault();navigateToAnchor(link.getAttribute('href'));
  }));
  explore.addEventListener('click',()=>{if(motionEnabled())scrollTo({top:scrollDistance(.13),behavior:'smooth'});else $('#main-content').scrollIntoView({behavior:'instant'});});
  const registration=window.HOOME_REGISTRATION||{};
  const links=[['employeeUrl','员工自主报名'],['departmentUrl','部门提报候选人']].flatMap(([key,text])=>{
    if(!registration[key])return [];
    try{const url=new URL(registration[key]);if(!['https:','http:'].includes(url.protocol))return [];const link=document.createElement('a');link.href=url.href;link.textContent=text;link.className='button';link.target='_blank';link.rel='noopener noreferrer';return [link];}catch{return [];}
  });
  if(links.length&&$('#registration')){$('#registration').className='registration-actions';$('#registration').replaceChildren(...links);}
  reduced.addEventListener('change',setupMotion);desktop.addEventListener('change',setupMotion);
  new ResizeObserver(()=>{if(typeof ScrollTrigger!=='undefined')ScrollTrigger.refresh();schedule();}).observe(stage);
  document.fonts.ready.then(()=>{if(typeof ScrollTrigger!=='undefined')ScrollTrigger.refresh();});
  addEventListener('pagehide',()=>{disposed=true;clearTimeout(lazyTimer);cancelAnimationFrame(raf);raf=0;heroVideo.pause();videos.forEach(video=>video.pause());journeyTween?.scrollTrigger?.kill();journeyTween?.kill();navTrigger?.kill();});
  addEventListener('pageshow',event=>{if(event.persisted){disposed=false;setupMotion();}});
  window.HoomeSite={scrollPosition:progress=>scrollDistance(clamp(progress)),snapshot:()=>({progress:timeline.progress,scrollProgress:scrollTimeline.progress,mediaRequested,earthLoaded:frameReady,reducedMotion:reduced.matches,motionEnabled:motionEnabled(),currentPhase:$('#current-phase-name')?.textContent??null,failures:[...failures]})};
  setupMotion();
  if(['#portal-timeline','#earth-brief'].includes(location.hash))requestAnimationFrame(()=>navigateToAnchor(location.hash));
})();
