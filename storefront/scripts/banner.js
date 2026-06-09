const API_BANNERS = 'https://api.cahayastore.me/api/banners';
const ROTATE_MS = 6000;

function escapeAttr(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function slideHtml(banner) {
  const img = `<img src="${escapeAttr(banner.image_url)}" alt="${escapeAttr(banner.alt)}" loading="lazy" />`;
  return banner.link
    ? `<a class="banner-slide" href="${escapeAttr(banner.link)}">${img}</a>`
    : `<div class="banner-slide">${img}</div>`;
}

async function fetchBanners() {
  const res = await fetch(API_BANNERS, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API banners failed: ${res.status}`);
  const json = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}

function setupCarousel(track, dotsWrap, count) {
  let index = 0;
  let timer = null;

  const go = (next) => {
    index = (next + count) % count;
    track.style.transform = `translateX(-${index * 100}%)`;
    if (dotsWrap) {
      [...dotsWrap.children].forEach((dot, i) =>
        dot.classList.toggle('is-active', i === index));
    }
  };

  const start = () => {
    if (count <= 1) return;
    stop();
    timer = setInterval(() => go(index + 1), ROTATE_MS);
  };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

  if (dotsWrap && count > 1) {
    dotsWrap.innerHTML = '';
    for (let i = 0; i < count; i += 1) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'banner-dot' + (i === 0 ? ' is-active' : '');
      dot.setAttribute('aria-label', `Banner ${i + 1}`);
      dot.addEventListener('click', () => { go(i); start(); });
      dotsWrap.appendChild(dot);
    }
  }

  const section = track.closest('.banner-section');
  section?.addEventListener('mouseenter', stop);
  section?.addEventListener('mouseleave', start);

  go(0);
  start();
}

async function initBanners() {
  const track = document.querySelector('[data-banners]');
  const dotsWrap = document.querySelector('[data-banner-dots]');
  if (!track) return;
  const section = track.closest('.banner-section');

  try {
    const banners = await fetchBanners();
    if (!banners.length) {
      if (section) section.hidden = true;
      return;
    }
    track.classList.add('banner-track');
    track.innerHTML = banners.map(slideHtml).join('');
    setupCarousel(track, dotsWrap, banners.length);
  } catch (error) {
    console.error(error);
    if (section) section.hidden = true;
  }
}

initBanners();
