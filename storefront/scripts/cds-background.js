/* Cahaya Design System — animated background paths.
   Renders layered flowing curved strokes that draw + drift, low opacity.
   Auto-mounts a fixed full-screen layer behind all content. */

function buildPath(i, total, width, height, accent) {
  // Flowing horizontal-ish bezier that shifts vertically per index.
  const baseY = (height / (total + 1)) * (i + 1);
  const amp = 60 + (i % 5) * 26;
  const skew = (i - total / 2) * 8;
  const y0 = baseY + skew;
  const c1x = width * 0.28;
  const c1y = baseY - amp;
  const c2x = width * 0.72;
  const c2y = baseY + amp;
  const yEnd = baseY - skew;
  const d = `M -50 ${y0.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${(width + 50).toFixed(1)} ${yEnd.toFixed(1)}`;
  const len = Math.hypot(width + 100, amp * 2) + width;
  const stroke = accent ? 'var(--cds-bg-path-accent)' : 'var(--cds-bg-path)';
  const dur = 12 + (i % 6) * 2.5;
  const delay = (i % 8) * -1.6;
  const sw = 1 + (i % 3) * 0.6;
  return `<path d="${d}" stroke="${stroke}" stroke-width="${sw.toFixed(2)}" style="--len:${Math.round(len)};--dur:${dur}s;--delay:${delay}s" />`;
}

function renderBackground() {
  if (document.querySelector('.cds-bg')) return;
  const layer = document.createElement('div');
  layer.className = 'cds-bg';
  layer.setAttribute('aria-hidden', 'true');

  const width = 1440;
  const height = 900;
  const total = 22;
  let paths = '';
  for (let i = 0; i < total; i += 1) {
    paths += buildPath(i, total, width, height, i % 4 === 0);
  }
  layer.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
  document.body.prepend(layer);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', renderBackground);
} else {
  renderBackground();
}
