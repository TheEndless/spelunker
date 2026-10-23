self.onmessage = (event: MessageEvent<{ canvas?: OffscreenCanvas }>) => {
  const canvas = event.data.canvas;
  let painted = false;
  if (canvas) {
    const context = canvas.getContext('2d');
    if (context) {
      canvas.width = 40;
      canvas.height = 20;
      context.fillStyle = '#ff0000';
      context.fillRect(0, 0, 40, 20);
      painted = true;
    }
  }
  (self as unknown as Worker).postMessage({
    ok: true,
    hasOffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    painted,
  });
};
