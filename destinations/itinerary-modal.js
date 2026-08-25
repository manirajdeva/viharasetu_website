/**
 * Turns each "View Itinerary" button on a destination page into a popup
 * showing a day-wise plan, instead of navigating to a (non-existent)
 * itinerary-N-days.html page.
 *
 * Usage: call initItineraryModals(itineraries) after the DOM is ready, where
 * `itineraries` is an array in the same order as the .itineraries .card
 * elements on the page. Each entry: { title, sub, days: [{ day, title, items, tags }] }
 */
function initItineraryModals(itineraries) {
  const backdrop = document.createElement('div');
  backdrop.className = 'itin-modal-backdrop';
  backdrop.innerHTML = '<div class="itin-modal"><button type="button" class="itin-modal-close" aria-label="Close">✕</button><div class="itin-modal-content"></div></div>';
  document.body.appendChild(backdrop);
  const modalContent = backdrop.querySelector('.itin-modal-content');
  const closeBtn = backdrop.querySelector('.itin-modal-close');

  function closeModal() {
    backdrop.classList.remove('visible');
    document.body.style.overflow = '';
  }
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderItinerary(itin) {
    const daysHtml = itin.days.map(d => `
      <div class="itin-day">
        <div class="itin-day-badge"><div class="num">${d.day}</div><div class="lbl">Day</div></div>
        <div class="itin-day-title">${escapeHtml(d.title)}</div>
        <ul>${d.items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
        ${d.tags && d.tags.length ? `<div class="itin-tags">${d.tags.map(t => `<span class="itin-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      </div>
    `).join('');
    modalContent.innerHTML = `
      <h2>${escapeHtml(itin.title)}</h2>
      <p class="itin-sub">${escapeHtml(itin.sub || '')}</p>
      <div class="itin-day-list">${daysHtml}</div>
    `;
    backdrop.classList.add('visible');
    document.body.style.overflow = 'hidden';
    backdrop.scrollTop = 0;
  }

  const cards = document.querySelectorAll('.itineraries .card');
  cards.forEach((card, idx) => {
    const link = card.querySelector('a.btn');
    const data = itineraries[idx];
    if (!link || !data) return;
    link.setAttribute('href', '#');
    link.addEventListener('click', (e) => {
      e.preventDefault();
      renderItinerary(data);
    });
  });
}
