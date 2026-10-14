(() => {
  const dialog = document.querySelector('#l2-course-dialog');
  const trigger = document.querySelector('.l2-course-trigger');
  if (!dialog || !trigger) return;
  trigger.addEventListener('click', () => {
    dialog.showModal();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      dialog.animate([{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0)'}],{duration:220,easing:'cubic-bezier(.22,1,.36,1)'});
    }
  });
  dialog.querySelector('.l2-course-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    const target = trigger.getClientRects().length ? trigger : document.querySelector('.menu-toggle');
    target?.focus({preventScroll:true});
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
})();
