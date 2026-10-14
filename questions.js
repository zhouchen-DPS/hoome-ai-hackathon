(() => {
  const items = [...document.querySelectorAll('.question-item')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new WeakMap();
  function setExpanded(item, expanded) {
    const answer = item.querySelector('.question-answer');
    const previous = animations.get(item);
    const height = item.open ? answer.getBoundingClientRect().height : 0;
    previous?.cancel();
    item.dataset.expanded = String(expanded);
    item.querySelector('summary').setAttribute('aria-expanded', String(expanded));
    if (reduced.matches) { item.open = expanded; return; }
    item.open = true;
    const animation = answer.animate([
      {height: height + 'px', opacity: expanded && !height ? 0 : 1},
      {height: (expanded ? answer.scrollHeight : 0) + 'px', opacity: expanded ? 1 : 0}
    ], {duration:250, easing:'cubic-bezier(.22,1,.36,1)'});
    animations.set(item, animation);
    animation.onfinish = () => {
      item.open = expanded;
      animations.delete(item);
    };
  }
  items.forEach(item => {
    item.dataset.expanded = 'false';
    item.querySelector('summary').setAttribute('aria-expanded', 'false');
    item.querySelector('summary').addEventListener('click', event => {
      event.preventDefault();
      const expanded = item.dataset.expanded !== 'true';
      if (expanded) items.filter(other => other !== item && other.dataset.expanded === 'true').forEach(other => setExpanded(other, false));
      setExpanded(item, expanded);
    });
  });
  const more = document.querySelector('.questions-more');
  const extra = document.querySelector('#more-questions');
  if (!more || !extra) return;
  let extraAnimation = null;
  extra.hidden = true;
  more.hidden = false;
  more.addEventListener('click', () => {
    const expanded = more.getAttribute('aria-expanded') !== 'true';
    const height = extra.hidden ? 0 : extra.getBoundingClientRect().height;
    extraAnimation?.cancel();
    more.setAttribute('aria-expanded', String(expanded));
    more.querySelector('span').textContent = expanded ? '收起其他问题' : '查看更多';
    extra.hidden = false;
    const finish = () => {
      extra.hidden = !expanded;
      extraAnimation = null;
      if (!expanded) extra.querySelectorAll('.question-item').forEach(item => {
        animations.get(item)?.cancel();
        animations.delete(item);
        item.open = false;
        item.dataset.expanded = 'false';
        item.querySelector('summary').setAttribute('aria-expanded', 'false');
      });
    };
    if (reduced.matches) { finish(); return; }
    extraAnimation = extra.animate([
      {height:height+'px',opacity:expanded&&!height?0:1},
      {height:(expanded?extra.scrollHeight:0)+'px',opacity:expanded?1:0}
    ],{duration:250,easing:'cubic-bezier(.22,1,.36,1)'});
    extraAnimation.onfinish = finish;
  });
})();
