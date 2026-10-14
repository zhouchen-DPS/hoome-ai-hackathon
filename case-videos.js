(() => {
  const dialog = document.querySelector('#case-player');
  if (!dialog) return;
  const video = dialog.querySelector('video');
  const error = dialog.querySelector('.case-player-error');
  let trigger = null;
  document.querySelectorAll('.case-cover').forEach(button => {
    button.addEventListener('click', () => {
      trigger = button;
      dialog.querySelector('#case-player-title').textContent = button.dataset.caseTitle;
      dialog.querySelector('#case-player-person').textContent = button.dataset.casePerson;
      error.hidden = true;
      video.poster = button.querySelector('img').getAttribute('src');
      video.src = button.dataset.caseSrc;
      dialog.showModal();
      document.documentElement.classList.add('case-player-open');
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        dialog.animate([{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0)'}],{duration:220,easing:'cubic-bezier(.22,1,.36,1)'});
      }
      video.play().catch(() => { /* Native controls remain available if autoplay is blocked. */ });
    });
  });
  video.addEventListener('error', () => { if (dialog.open && video.hasAttribute('src')) error.hidden = false; });
  dialog.querySelector('.case-player-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    video.pause();
    video.removeAttribute('src');
    video.removeAttribute('poster');
    video.load();
    error.hidden = true;
    document.documentElement.classList.remove('case-player-open');
    trigger?.focus({preventScroll:true});
  });
})();
