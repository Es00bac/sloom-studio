'use strict';

// All dossiers, the field manual and both technology paths are in the HTML.
// These enhancements select a view; the content remains readable without JS.
document.documentElement.classList.add('enhanced');

if ('ResizeObserver' in window) {
  new ResizeObserver(entries => {
    document.documentElement.style.setProperty('--header-height', `${entries[0].target.getBoundingClientRect().height}px`);
  }).observe(document.querySelector('.masthead'));
}

const menuButton = document.querySelector('.nav-toggle');
const navigation = document.querySelector('#navigation');
function closeNavigation() {
  menuButton.setAttribute('aria-expanded', 'false');
  navigation.classList.remove('is-open');
}
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  navigation.classList.toggle('is-open', open);
});
navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', closeNavigation));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
    closeNavigation();
    menuButton.focus();
  }
});

document.querySelectorAll('[data-dossier]').forEach(dossier => {
  const buttons = Array.from(dossier.querySelectorAll('[data-select]'));
  const panels = Array.from(dossier.querySelectorAll('[data-panel]'));
  function select(button) {
    buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    panels.forEach(panel => { panel.hidden = panel.dataset.panel !== button.dataset.select; });
  }
  buttons.forEach(button => button.addEventListener('click', () => select(button)));
  select(buttons[0]);
});

const techButtons = Array.from(document.querySelectorAll('[data-tech-select]'));
const techPaths = Array.from(document.querySelectorAll('[data-tech-panel]'));
function selectTechnology(button) {
  techButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  techPaths.forEach(panel => { panel.hidden = panel.dataset.techPanel !== button.dataset.techSelect; });
}
techButtons.forEach(button => button.addEventListener('click', () => selectTechnology(button)));
selectTechnology(techButtons[0]);

// Prevent two trailer soundtracks from playing over one another.
document.querySelectorAll('video').forEach(video => {
  video.addEventListener('play', () => {
    document.querySelectorAll('video').forEach(other => { if (other !== video) other.pause(); });
  });
});

const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
if (!motionPreference.matches && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('motion-enabled');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -20px 0px' });
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
}

// A very small scene drift gives the key art depth without moving the copy.
if (!motionPreference.matches && window.matchMedia('(min-width: 901px)').matches) {
  const art = document.querySelector('.hero-art');
  let scheduled = false;
  window.addEventListener('scroll', () => {
    if (motionPreference.matches) return;
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      if (window.scrollY < 1100) art.style.translate = `0 ${Math.min(window.scrollY * 0.07, 55)}px`;
      scheduled = false;
    });
  }, { passive: true });
}
