/**
 * Turns photo gallery links into a full-screen lightbox popup showing the
 * image in place, instead of navigating to the linked image URL.
 */
(function () {
  function init() {
    const links = Array.from(document.querySelectorAll('.gallery a'));
    if (!links.length) return;

    const style = document.createElement('style');
    style.textContent = `
      .gallery-lightbox-backdrop {
        position: fixed; inset: 0; z-index: 600;
        background: rgba(20,17,12,0.92);
        display: none; align-items: center; justify-content: center;
        padding: 40px 20px;
      }
      .gallery-lightbox-backdrop.visible { display: flex; }
      .gallery-lightbox-backdrop img {
        max-width: 100%; max-height: 100%;
        border-radius: 10px;
        box-shadow: 0 30px 80px rgba(0,0,0,0.5);
        display: block;
      }
      .gallery-lightbox-close {
        position: absolute; top: 18px; right: 18px;
        width: 40px; height: 40px; border-radius: 50%;
        border: none; background: rgba(255,255,255,0.15);
        color: #fff; font-size: 18px; line-height: 1; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: background .2s ease;
      }
      .gallery-lightbox-close:hover { background: rgba(255,255,255,0.3); }
    `;
    document.head.appendChild(style);

    const backdrop = document.createElement('div');
    backdrop.className = 'gallery-lightbox-backdrop';
    backdrop.innerHTML = '<button type="button" class="gallery-lightbox-close" aria-label="Close">✕</button><img alt="">';
    document.body.appendChild(backdrop);
    const img = backdrop.querySelector('img');
    const closeBtn = backdrop.querySelector('.gallery-lightbox-close');

    function open(src, alt) {
      img.src = src;
      img.alt = alt || '';
      backdrop.classList.add('visible');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      backdrop.classList.remove('visible');
      document.body.style.overflow = '';
      img.src = '';
    }

    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    links.forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const thumb = a.querySelector('img');
        open(a.getAttribute('href'), thumb ? thumb.alt : '');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
