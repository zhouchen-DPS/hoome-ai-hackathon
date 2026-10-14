(() => {
  'use strict';
  const root=document.querySelector('#earth-brief');
  if(!root)return;
  const clamp=v=>Math.max(0,Math.min(1,v));
  const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
  const windows={goals:[.432,.485],schedule:[.497,.557],team:[.568,.618]};
  const orbits=root.querySelector('.orbits'),space=root.querySelector('.orbital-space'),caption=root.querySelector('.planet-caption');
  const panels=[...root.querySelectorAll('[data-brief]')].map(element=>{
    const name=element.dataset.brief,line=root.querySelector(`[data-connect="${name}"]`),length=line.getTotalLength();
    line.style.strokeDasharray=String(length);
    return {element,rows:[...element.querySelectorAll('[data-brief-row]')],rule:element.querySelector('.module-rule'),line,length,originalPath:line.getAttribute('d'),beacon:root.querySelector(`[data-beacon="${name}"]`),window:windows[name]};
  });
  function layoutConnections(){
    const narrow=matchMedia('(min-width:901px) and (max-width:1100px)').matches;
    const paths={goals:'M 800 294 L 840 222 L 876 222',team:'M 810 603 L 846 638 L 876 638'};
    panels.forEach(panel=>{
      const adjust=narrow&&paths[panel.element.dataset.brief];
      panel.line.setAttribute('d',adjust||panel.originalPath);
      if(adjust)panel.beacon.setAttribute('transform','translate(-123 0)');
      else panel.beacon.removeAttribute('transform');
      panel.length=panel.line.getTotalLength();
    });
  }
  layoutConnections();
  let fadeStart=null,geometry='',last='',active=false;
  function coverProgress(scene){
    if(!scene?.ready)return null;
    const key=scene.width+'x'+scene.height;
    if(key!==geometry){fadeStart=null;geometry=key;}
    if(fadeStart===null){
      const cover=document.querySelector('#earth-frame')?.contentWindow?.sceneDemo?.viewportCoverProgress?.();
      if(Number.isFinite(cover))fadeStart=.4+cover*.55;
    }
    return fadeStart;
  }
  window.HoomeEarthBrief={
    render(progress,animated,scene){
      const threshold=coverProgress(scene)??.8;
      const key=animated+':'+progress.toFixed(7)+':'+threshold;
      if(last===key)return;
      last=key;
      if(!animated){
        active=false;root.removeAttribute('style');root.removeAttribute('aria-hidden');
        [space,orbits,caption,...panels.flatMap(p=>[p.element,p.rule,p.line,p.beacon,...p.rows])].forEach(el=>el.removeAttribute('style'));
        panels.forEach(({element})=>element.removeAttribute('aria-hidden'));
        return;
      }
      const exit=smooth(threshold,threshold+.018,progress);
      active=progress>.426&&exit<.999;
      root.style.visibility=active?'visible':'hidden';
      root.style.opacity=String(smooth(.426,.44,progress)*(1-exit));
      root.setAttribute('aria-hidden',String(!active));
      space.style.opacity=String(smooth(.426,.445,progress));
      orbits.style.opacity=String(smooth(.426,.455,progress));
      orbits.style.transform=`rotate(${-3*smooth(.426,.69,progress)}deg)`;
      orbits.style.transformOrigin='52% 50%';
      caption.style.opacity=String(smooth(.618,.642,progress));
      panels.forEach(({element,rows,rule,line,length,beacon,window:[start,end]})=>{
        const enter=smooth(start,start+.014,progress);
        element.style.opacity=String(enter);element.style.visibility=enter>.001?'visible':'hidden';
        element.setAttribute('aria-hidden',String(enter<.05||!active));
        element.style.transform=`translate3d(0,${(1-enter)*10}px,0)`;
        rule.style.transform=`scaleX(${smooth(start,start+.019,progress)})`;
        rule.style.transformOrigin=element.dataset.brief==='schedule'?'right':'left';
        rows.forEach((row,i)=>{
          const at=start+.007+(end-start-.023)*i/Math.max(1,rows.length-1);
          const reveal=smooth(at,at+.012,progress);
          row.style.opacity=String(reveal);
          row.style.transform=`translate3d(${(1-reveal)*7}px,0,0)`;
          row.style.clipPath=reveal>.999?'none':`inset(-10px ${100*(1-reveal)}% -10px -40px)`;
        });
        line.style.strokeDasharray=String(length);
        line.style.strokeDashoffset=String(length*(1-smooth(start-.006,start+.012,progress)));
        beacon.style.opacity=String(smooth(start-.01,start,progress));
      });
      root.dataset.fadeStart=threshold.toFixed(5);root.dataset.exit=exit.toFixed(5);
    },
    // All three panels, their rows and the closing caption are fully revealed here.
    fullContentProgress(){return .65;},
    fadeEnd(){return(fadeStart??.8)+.018;},
    isVisible(){return active;}
  };
  addEventListener('resize',()=>{fadeStart=null;last='';layoutConnections();},{passive:true});
})();
