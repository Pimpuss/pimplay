import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { SOURCES } from '../lib/context.jsx';

export function gradientFor(name = '') {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `linear-gradient(160deg, hsl(${h} 55% 34%), hsl(${(h + 50) % 360} 60% 13%))`;
}

// Image avec repli en cascade (jaquette -> en-tête -> dégradé avec le nom)
export function Cover({ game, kind = 'cover', className = 'cover-img', style }) {
  const img = game.images || {};
  // Chaque entrée peut être une URL ou une liste d'URL (cache local puis CDN)
  const chain = (kind === 'hero' ? [img.hero, img.header] : kind === 'logo' ? [img.logo] : [img.cover, img.header]).flat().filter(Boolean);
  const chainKey = chain.join('|');
  const [i, setI] = useState(0);
  const [wide, setWide] = useState(false);
  const [soft, setSoft] = useState(false);
  useEffect(() => { setI(0); setWide(false); setSoft(false); }, [game.id, chainKey]);
  if (i < chain.length) {
    const onError = () => { setWide(false); setSoft(false); setI(i + 1); };
    const onLoad = (e) => {
      const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
      // Une image horizontale (en-tête) ne doit pas être rognée dans une jaquette verticale :
      // on l'affiche entière sur un fond flouté
      if (kind === 'cover') setWide(w > h);
      // Bannière : une image petite (en-tête 460 px…) ou presque carrée (jaquette) serait pixelisée
      // ou très rognée → floutée en ambiance. Une image 16:9 en haute définition reste nette.
      if (kind === 'hero') setSoft(w < 1000 || w / h < 1.4);
    };
    if (wide) {
      return (
        <div className="cover-wide">
          <img src={chain[i]} alt="" className="bg" draggable={false} />
          <img src={chain[i]} alt="" className="fg" draggable={false} onError={onError} />
          <span className="cover-wide-name">{game.name}</span>
        </div>
      );
    }
    return <img src={chain[i]} alt="" className={`${className} ${soft ? 'hero-soft' : ''}`} style={style} draggable={false} onError={onError} onLoad={onLoad} />;
  }
  if (kind === 'logo') return null;
  return (
    <div className="cover-fallback" style={{ background: gradientFor(game.name) }}>
      {kind === 'cover' && <span className="src">{SOURCES[game.source]}</span>}
      {kind === 'cover' && game.name}
    </div>
  );
}

// Cadrage vertical choisi dans « Personnaliser » (25 % par défaut : on garde surtout le haut de l'image)
export const DEFAULT_HERO_POSITION = 25;
export const heroStyle = (game) => ({ objectPosition: `center ${game.meta?.heroPosition ?? DEFAULT_HERO_POSITION}%` });

export function GameLogo({ game, fallback }) {
  const logos = [game.images?.logo].flat().filter(Boolean);
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [game.id]);
  if (i >= logos.length) return fallback;
  return <img src={logos[i]} alt={game.name} className="hero-logo" draggable={false} onError={() => setI(i + 1)} />;
}

export function Toggle({ on, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      className={`toggle ${on ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title} style={wide ? { width: 'min(860px, calc(100vw - 40px))' } : undefined}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost sm icon" onClick={onClose} aria-label="Fermer"><X /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Menu déroulant aux couleurs de l'app (remplace le <select> natif de Windows).
// options : [[valeur, libellé, Icône?], …]
export function Select({ value, options, onChange, label = 'Choisir', width }) {
  const [open, setOpen] = useState(false);
  const current = Math.max(0, options.findIndex(([v]) => v === value));
  const [hi, setHi] = useState(current);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    setHi(current);
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (i) => { onChange(options[i][0]); setOpen(false); };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') return setOpen(false);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      setHi((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open) pick(hi); else setOpen(true);
    }
  };

  const [, curLabel, CurIcon] = options[current];
  return (
    <div className="dd" ref={ref} style={{ width }}>
      <button type="button" className={`dd-btn ${open ? 'open' : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        onClick={() => setOpen(!open)} onKeyDown={onKeyDown}>
        {CurIcon && <CurIcon className="dd-ico" />}
        <span>{curLabel}</span>
        <ChevronDown className="dd-chev" />
      </button>
      {open && (
        <div className="dd-menu" role="listbox">
          {options.map(([v, l, Icon], i) => (
            <button type="button" key={v} role="option" aria-selected={v === value}
              className={`dd-opt ${v === value ? 'sel' : ''} ${i === hi ? 'hi' : ''}`}
              onMouseEnter={() => setHi(i)} onClick={() => pick(i)}>
              {Icon && <Icon className="dd-ico" />}
              <span>{l}</span>
              {v === value && <Check className="dd-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Seg({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button type="button" key={v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

// ---------- Raccourcis : conversion KeyboardEvent -> accélérateur Electron ----------

const CODE_MAP = {
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Space: 'Space',
};

function keyFromEvent(e) {
  const c = e.code;
  if (/^F\d{1,2}$/.test(c)) return c;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^Numpad\d$/.test(c)) return 'num' + c.slice(6);
  return CODE_MAP[c] || null;
}

export function formatHotkey(acc) {
  if (!acc) return '';
  return acc
    .split('+')
    .map((k) => k.replace(/^num(\d)$/, 'Num $1').replace(/^numadd$/, 'Num +').replace(/^numsub$/, 'Num −')
      .replace(/^nummult$/, 'Num ×').replace(/^numdiv$/, 'Num ÷').replace(/^numdec$/, 'Num .').replace('Control', 'Ctrl'))
    .join(' + ');
}

export function HotkeyInput({ value, onChange }) {
  const [capturing, setCapturing] = useState(false);
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setCapturing(false);
      if (e.key === 'Backspace') { onChange(''); return setCapturing(false); }
      const key = keyFromEvent(e);
      if (!key) return;
      const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
      onChange([...mods, key].join('+'));
      setCapturing(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, onChange]);
  return (
    <button
      type="button"
      className={`kbd ${!value ? 'unset' : ''} ${capturing ? 'capturing' : ''}`}
      onClick={() => setCapturing(true)}
      onBlur={() => setCapturing(false)}
      title="Cliquer puis appuyer sur une touche (Retour arrière pour effacer)"
    >
      {capturing ? 'Appuyez…' : value ? formatHotkey(value) : 'Aucun'}
    </button>
  );
}
