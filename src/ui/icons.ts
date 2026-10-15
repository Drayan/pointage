// Icônes en trait, héritant de la couleur du texte.

const svg = (body: string, size = 24, stroke = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  list: svg('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  chevronLeft: svg('<path d="m15 6-6 6 6 6"/>', 20),
  chevronRight: svg('<path d="m9 6 6 6-6 6"/>', 20),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 18, 2.4),
  file: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M9 13h7M9 17h5"/>', 18),
  alert: svg('<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>', 26),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 18),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', 18),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', 18),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>', 18),
  check: svg('<path d="m5 12 5 5 9-10"/>', 16, 2.4),
  alertSmall: svg('<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>', 18),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>', 20),
  pause: svg('<path d="M9 5v14M15 5v14"/>', 22, 2.4),
  play: svg('<path d="M7 5v14l11-7z"/>', 22, 2.2),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', 18),
};
