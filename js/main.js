/* PixelPlay — main.js */

(function () {
  'use strict';

  /* ── Hamburger Menu ─────────────────────────────────────── */
  const hamburger = document.querySelector('.hamburger');
  const mobileNav = document.querySelector('.mobile-nav');

  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      const open = hamburger.classList.toggle('open');
      mobileNav.classList.toggle('open', open);
      hamburger.setAttribute('aria-expanded', open);
    });

    // Close on link tap
    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        mobileNav.classList.remove('open');
        hamburger.setAttribute('aria-expanded', false);
      });
    });

    // Close on outside click
    document.addEventListener('click', e => {
      if (!hamburger.contains(e.target) && !mobileNav.contains(e.target)) {
        hamburger.classList.remove('open');
        mobileNav.classList.remove('open');
        hamburger.setAttribute('aria-expanded', false);
      }
    });
  }

  /* ── Sticky Nav Shadow ──────────────────────────────────── */
  const siteNav = document.querySelector('.site-nav');
  if (siteNav) {
    const onScroll = () => {
      siteNav.classList.toggle('scrolled', window.scrollY > 10);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ── Smooth Scroll ──────────────────────────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', e => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      const navH = siteNav ? siteNav.offsetHeight : 0;
      const top = target.getBoundingClientRect().top + window.scrollY - navH - 12;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  /* ── Active Nav Highlight on Scroll ─────────────────────── */
  const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
  const sections = Array.from(navLinks)
    .map(a => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);

  const highlightNav = () => {
    const scrollY = window.scrollY + (siteNav ? siteNav.offsetHeight : 0) + 60;
    let active = sections[0];
    sections.forEach(sec => {
      if (sec.offsetTop <= scrollY) active = sec;
    });
    navLinks.forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === `#${active?.id}`);
    });
  };

  if (navLinks.length) {
    window.addEventListener('scroll', highlightNav, { passive: true });
    highlightNav();
  }

  /* ── Scroll Fade-In (IntersectionObserver) ──────────────── */
  const fadeEls = document.querySelectorAll('.fade-in');
  if ('IntersectionObserver' in window && fadeEls.length) {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    fadeEls.forEach(el => observer.observe(el));
  } else {
    // Fallback: show all immediately
    fadeEls.forEach(el => el.classList.add('visible'));
  }

  /* ── AI Prompt Typewriter Demo ──────────────────────────── */
  const promptEl = document.querySelector('.ai-typed-text');
  if (promptEl) {
    const phrases = [
      'A 2-player space shooter with asteroids',
      'A memory card matching game',
      'Multiplayer snake on one screen',
      'A trivia game about 80s music',
    ];
    let phraseIdx = 0;
    let charIdx = 0;
    let deleting = false;
    let paused = false;

    const type = () => {
      const phrase = phrases[phraseIdx];
      if (paused) {
        paused = false;
        deleting = true;
        setTimeout(type, 1200);
        return;
      }
      if (!deleting) {
        promptEl.textContent = phrase.slice(0, ++charIdx);
        if (charIdx === phrase.length) { paused = true; setTimeout(type, 80); return; }
      } else {
        promptEl.textContent = phrase.slice(0, --charIdx);
        if (charIdx === 0) {
          deleting = false;
          phraseIdx = (phraseIdx + 1) % phrases.length;
        }
      }
      setTimeout(type, deleting ? 40 : 75);
    };
    type();
  }

})();
