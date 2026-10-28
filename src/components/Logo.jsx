// Logo Pimplay (même dessin que build/logo.svg, utilisé pour l'icône Windows)
export default function Logo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      <defs>
        <linearGradient id="pimplay-bg" x1="0" y1="0" x2="1" y2="1">
          {/* Suit la couleur d'accent choisie (violet par défaut, comme l'icône de l'app) */}
          <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--accent-mid)' }} />
          <stop offset="1" style={{ stopColor: 'var(--accent-2)' }} />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#pimplay-bg)" />
      <rect x="128" y="100" width="78" height="312" rx="26" fill="#fff" />
      <path d="M168 100 H296 A120 120 0 0 1 296 340 H168 Z" fill="#fff" />
      <path d="M268 172 L268 268 Q268 280 278 274 L350 230 Q360 220 350 210 L278 166 Q268 160 268 172 Z" fill="url(#pimplay-bg)" />
    </svg>
  );
}
