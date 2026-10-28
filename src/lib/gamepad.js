// Lecture des manettes (API Gamepad, disposition « standard » Xbox / PlayStation / Switch) avec
// détection des appuis, répétition quand une direction est maintenue et type de manette branchée.
import { useEffect, useRef, useState } from 'react';

export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const REPEAT_DELAY = 380;
const REPEAT_RATE = 110;

// Libellés des boutons par famille. Les clés suivent la position physique (a = bouton du bas,
// b = droite, x = gauche, y = haut), d'où les lettres inversées chez Nintendo.
export const PAD_LABELS = {
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', start: 'Menu', back: 'Vue' },
  playstation: { a: 'cross', b: 'circle', x: 'square', y: 'triangle', lb: 'L1', rb: 'R1', start: 'Options', back: 'Create' },
  nintendo: { a: 'B', b: 'A', x: 'Y', y: 'X', lb: 'L', rb: 'R', start: '+', back: '−' },
};

// Famille et nom de la manette d'après son identifiant (fabricant USB : 054c Sony, 057e Nintendo)
export function describePad(id = '') {
  const s = id.toLowerCase();
  if (/054c|dualsense|dualshock|playstation/.test(s)) {
    const name = /dualsense|0ce6|0df2/.test(s) ? 'DualSense' : /dualshock|05c4|09cc/.test(s) ? 'DualShock 4' : 'Manette PlayStation';
    return { family: 'playstation', name };
  }
  if (/057e|pro controller|joy-con|nintendo/.test(s)) return { family: 'nintendo', name: 'Manette Switch' };
  return { family: 'xbox', name: /xbox|xinput|045e/.test(s) ? 'Manette Xbox' : 'Manette' };
}

const PAD_KEY = 'pimplay.padFamily';

// Manette utilisée en dernier (celle dont l'état a changé le plus récemment). Chromium ne
// révèle les manettes qu'après un premier appui : en attendant, on reprend la dernière famille vue.
export function useActivePad() {
  const [pad, setPad] = useState(() => {
    let family = 'xbox';
    try { family = localStorage.getItem(PAD_KEY) || family; } catch {}
    return { family: PAD_LABELS[family] ? family : 'xbox', name: null };
  });
  useEffect(() => {
    const check = () => {
      const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
      if (!pads.length) { setPad((p) => (p.name ? { ...p, name: null } : p)); return; }
      const latest = pads.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
      const next = describePad(latest.id);
      setPad((p) => (p.family === next.family && p.name === next.name ? p : next));
      try { localStorage.setItem(PAD_KEY, next.family); } catch {}
    };
    check();
    const t = setInterval(check, 400);
    window.addEventListener('gamepadconnected', check);
    window.addEventListener('gamepaddisconnected', check);
    return () => {
      clearInterval(t);
      window.removeEventListener('gamepadconnected', check);
      window.removeEventListener('gamepaddisconnected', check);
    };
  }, []);
  return pad;
}

// handlers : { a, b, x, y, lb, rb, start, back, left, right, up, down } — appelés au moment de l'appui
export function useGamepad(handlers, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return undefined;
    let raf = 0;
    const pressed = new Map(); // "manette:bouton" -> instant d'appui
    const lastRepeat = new Map();
    const fire = (name) => ref.current[name]?.();

    const loop = (t) => {
      for (const pad of navigator.getGamepads?.() || []) {
        if (!pad) continue;
        const ax = pad.axes[0] || 0;
        const ay = pad.axes[1] || 0;
        const state = {
          a: pad.buttons[BTN.A]?.pressed, b: pad.buttons[BTN.B]?.pressed, x: pad.buttons[BTN.X]?.pressed, y: pad.buttons[BTN.Y]?.pressed,
          lb: pad.buttons[BTN.LB]?.pressed, rb: pad.buttons[BTN.RB]?.pressed,
          start: pad.buttons[BTN.START]?.pressed, back: pad.buttons[BTN.BACK]?.pressed,
          // Croix directionnelle ou stick gauche
          left: pad.buttons[BTN.LEFT]?.pressed || ax < -0.55, right: pad.buttons[BTN.RIGHT]?.pressed || ax > 0.55,
          up: pad.buttons[BTN.UP]?.pressed || ay < -0.55, down: pad.buttons[BTN.DOWN]?.pressed || ay > 0.55,
        };
        for (const [name, on] of Object.entries(state)) {
          const key = `${pad.index}:${name}`;
          if (on && !pressed.has(key)) {
            pressed.set(key, t);
            lastRepeat.set(key, t);
            fire(name);
          } else if (on && ['left', 'right', 'up', 'down'].includes(name)) {
            // Direction maintenue : répétition après un court délai
            if (t - pressed.get(key) > REPEAT_DELAY && t - lastRepeat.get(key) > REPEAT_RATE) {
              lastRepeat.set(key, t);
              fire(name);
            }
          } else if (!on) {
            pressed.delete(key);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
}
