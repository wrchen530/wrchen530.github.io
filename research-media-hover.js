document.querySelectorAll('video[data-hover-preview]').forEach((video) => {
  const link = video.closest('.publication-media');
  if (!link) return;

  const start = () => {
    video.load();
    video.currentTime = 0;
    video.play().catch(() => {});
  };
  const reset = () => {
    video.pause();
    if (video.readyState >= 1) video.currentTime = 0;
  };

  link.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') start();
  });
  link.addEventListener('pointerleave', reset);
  link.addEventListener('focus', () => {
    if (link.matches(':focus-visible')) start();
  });
  link.addEventListener('blur', reset);
});
