// Calculs de l'historique : découpe des sessions par jour (une partie à cheval sur minuit compte
// pour les deux jours), regroupement par période et formats d'affichage.

const DAY = 24 * 3600 * 1000;

export const PERIODS = [
  ['7', '7 jours'],
  ['30', '30 jours'],
  ['365', '12 mois'],
  ['all', 'Depuis toujours'],
];

const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
// Minuit suivant / décalé de n jours, en heure locale : un jour ne fait pas toujours 24 h (passage à
// l'heure d'été ou d'hiver), donc jamais « + n * 24 h »
const addDays = (t, n) => { const d = new Date(startOfDay(t)); d.setDate(d.getDate() + n); return d.getTime(); };
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const monthKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}`; };

// Répartit chaque session sur les jours qu'elle couvre, limitée à [from, to)
function* slices(sessions, from, to) {
  for (const s of sessions) {
    let a = Math.max(s.s, from);
    const b = Math.min(s.e, to);
    while (a < b) {
      const end = Math.min(b, addDays(a, 1));
      yield { g: s.g, t: a, ms: end - a };
      a = end;
    }
  }
}

// Colonnes du graphique + agrégats de la période
export function computeStats(sessions, period, now = Date.now()) {
  const monthly = period === '365';
  const buckets = [];
  if (monthly) {
    const d = new Date(now);
    d.setDate(1); d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() - 11);
    for (let i = 0; i < 12; i++) {
      const start = d.getTime();
      d.setMonth(d.getMonth() + 1);
      buckets.push({ key: monthKey(start), start, end: d.getTime(), ms: 0, games: new Map() });
    }
  } else {
    const days = Number(period);
    for (let i = days - 1; i >= 0; i--) {
      const start = addDays(now, -i);
      buckets.push({ key: dayKey(start), start, end: addDays(start, 1), ms: 0, games: new Map() });
    }
  }
  const from = buckets[0].start;
  const to = buckets[buckets.length - 1].end;
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  const totals = new Map();
  const playedDays = new Set();
  for (const sl of slices(sessions, from, to)) {
    const b = byKey.get(monthly ? monthKey(sl.t) : dayKey(sl.t));
    if (!b) continue;
    b.ms += sl.ms;
    b.games.set(sl.g, (b.games.get(sl.g) || 0) + sl.ms);
    totals.set(sl.g, (totals.get(sl.g) || 0) + sl.ms);
    playedDays.add(dayKey(sl.t));
  }
  const inPeriod = sessions.filter((s) => s.e > from && s.s < to);
  const totalMs = [...totals.values()].reduce((a, b) => a + b, 0);
  return {
    buckets,
    monthly,
    totalMs,
    sessionCount: inPeriod.length,
    avgMs: inPeriod.length ? inPeriod.reduce((a, s) => a + (Math.min(s.e, to) - Math.max(s.s, from)), 0) / inPeriod.length : 0,
    playedDays: playedDays.size,
    dayCount: monthly ? Math.round((to - from) / DAY) : buckets.length,
    top: [...totals].sort((a, b) => b[1] - a[1]).map(([g, ms]) => ({ g, ms })),
    recent: [...inPeriod].sort((a, b) => b.s - a.s),
  };
}

// Graduations « propres » de l'axe vertical, en minutes ou en heures selon l'échelle
export function niceTicks(maxMs) {
  const maxMin = Math.max(maxMs / 60000, 1);
  const steps = [5, 10, 15, 30, 60, 120, 180, 240, 360, 600, 1200, 2400, 6000];
  const step = steps.find((s) => maxMin / s <= 4) || steps[steps.length - 1];
  const top = Math.ceil(maxMin / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { ticks, topMs: top * 60000, label: (min) => (step >= 60 ? `${min / 60} h` : `${min} min`) };
}

export function formatDuration(ms, { compact = false } = {}) {
  const m = Math.round(ms / 60000);
  if (m < 1) return compact ? '<1 min' : 'moins d’une minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h >= 100 || !r) return `${h.toLocaleString('fr-FR')} h`;
  return `${h} h ${String(r).padStart(2, '0')}`;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const formatBucket = (b, monthly) => capitalize(
  monthly
    ? new Date(b.start).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : new Date(b.start).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
);

export const formatAxis = (b, monthly, period) =>
  monthly
    ? new Date(b.start).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')
    : period === '7'
      ? new Date(b.start).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')
      : new Date(b.start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'numeric' });

export const formatSessionDate = (t) =>
  new Date(t).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '')
  + ' · ' + new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
