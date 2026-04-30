/* ============================================================
   ETHAN SHAFRON — SITE JS
   Vanilla JS only — no jQuery dependency.
   ============================================================ */

(function () {
  'use strict';

  /* ----------------------------------------------------------
     MOBILE NAV TOGGLE
     ---------------------------------------------------------- */
  const toggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');

  if (toggle && navLinks) {
    toggle.addEventListener('click', () => {
      const open = navLinks.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open);
    });

    // Close when any nav link is clicked
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => navLinks.classList.remove('is-open'));
    });
  }

  /* ----------------------------------------------------------
     ACTIVE NAV LINK — highlights the link for the visible section
     Uses IntersectionObserver for performance.
     ---------------------------------------------------------- */
  const sections = document.querySelectorAll('section[id]');
  const links    = document.querySelectorAll('.nav-links a[href^="#"]');

  if (sections.length && links.length) {
    const activate = (id) => {
      links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + id));
    };

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) activate(entry.target.id);
      });
    }, {
      rootMargin: '-30% 0px -60% 0px'
    });

    sections.forEach(s => observer.observe(s));
  }

  /* ----------------------------------------------------------
     EMBED PLACEHOLDER — if the browser can't render the PDF
     inline, show a download link instead.
     ---------------------------------------------------------- */
  // No action needed; browsers that can't render will show fallback content.

})();
