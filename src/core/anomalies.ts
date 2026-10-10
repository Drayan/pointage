// Repérage des entrées suspectes à vérifier avant l'envoi d'un relevé.

import { MINUTE } from './time';

export type Anomaly = 'overlap' | 'long';

/** Au-delà, une session est presque sûrement un oubli de pointage (une journée enchaînée avec une garde reste en dessous). */
export const LONG_SESSION_HOURS = 48;

interface Span {
  id: string;
  start: number;
  end: number | null;
}

/** Anomalies par identifiant de session. Une session ouverte est comptée jusqu'à `now`. */
export function findAnomalies(sessions: readonly Span[], now: number): Map<string, Anomaly[]> {
  const out = new Map<string, Anomaly[]>();
  const add = (id: string, a: Anomaly) => {
    const list = out.get(id) ?? [];
    if (!list.includes(a)) list.push(a);
    out.set(id, list);
  };
  const spans = sessions
    .map((s) => ({ id: s.id, start: s.start, end: s.end ?? Math.max(now, s.start) }))
    .sort((a, b) => a.start - b.start);

  // balayage : on garde la session qui finit le plus tard parmi celles déjà vues
  let reach: { id: string; end: number } | null = null;
  for (const s of spans) {
    if ((s.end - s.start) / MINUTE > LONG_SESSION_HOURS * 60) add(s.id, 'long');
    if (reach && s.start < reach.end) {
      add(s.id, 'overlap');
      add(reach.id, 'overlap');
    }
    if (!reach || s.end > reach.end) reach = { id: s.id, end: s.end };
  }
  return out;
}
