// Stockage local (IndexedDB) : sessions brutes et réglages. Rien ne quitte le téléphone.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface Session {
  id: string;
  start: number; // instant UTC, arrondi à la minute
  end: number | null; // null = session en cours
  manual: boolean;
  note: string;
  updatedAt: number;
}

export interface Settings {
  name: string;
  role: string;
  service: string;
  rateDayCents: number;
  rateNightCents: number;
  alertHours: number;
  weekAlertHours: number; // semaine signalée au-delà de ce total (0 = désactivé)
  defaultStart: string; // 'HH:MM', pré-remplissage d'une nouvelle entrée
  defaultEnd: string;
  extraHolidays: string[]; // 'AAAA-MM-JJ'
  relevesSent: Record<string, number>; // 'AAAA-MM' -> instant du dernier envoi
  releveReminderDismissed: string | null; // mois dont le rappel d'envoi a été écarté
  installHintDismissed: boolean;
  institution: string; // en-tête du relevé, une ligne par retour à la ligne
  astreintes: string[]; // 'AAAA-MM-JJ' : soirs d'astreinte (date où l'astreinte commence)
  astreinteCents: number; // forfait par soir d'astreinte, pour l'estimation (0 = non rémunéré)
  pauseStartedAt: number | null; // pause de midi en cours
  lastBackup: number | null;
  alertSnoozeUntil: number | null; // l'alerte de session ouverte est masquée jusqu'à cet instant
  backupReminderDismissedAt: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  role: 'Assistant libre (000)',
  service: 'Chirurgie',
  rateDayCents: 2600,
  rateNightCents: 3400,
  alertHours: 11,
  weekAlertHours: 0,
  defaultStart: '08:00',
  defaultEnd: '18:00',
  extraHolidays: [],
  relevesSent: {},
  releveReminderDismissed: null,
  installHintDismissed: false,
  institution: 'CLINIQUE SAINT-PIERRE A.S.B.L.\n1340 OTTIGNIES',
  astreintes: [],
  astreinteCents: 0,
  pauseStartedAt: null,
  lastBackup: null,
  alertSnoozeUntil: null,
  backupReminderDismissedAt: null,
};

interface PointageDB extends DBSchema {
  sessions: { key: string; value: Session };
  meta: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<PointageDB>> | null = null;

function db(): Promise<IDBPDatabase<PointageDB>> {
  dbPromise ??= openDB<PointageDB>('pointage', 1, {
    upgrade(database) {
      database.createObjectStore('sessions', { keyPath: 'id' });
      database.createObjectStore('meta');
    },
  });
  return dbPromise;
}

export async function loadSessions(): Promise<Session[]> {
  return (await db()).getAll('sessions');
}

export async function saveSession(s: Session): Promise<void> {
  await (await db()).put('sessions', s);
}

export async function removeSession(id: string): Promise<void> {
  await (await db()).delete('sessions', id);
}

export async function loadSettings(): Promise<Settings> {
  const stored = (await (await db()).get('meta', 'settings')) as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(s: Settings): Promise<void> {
  await (await db()).put('meta', s, 'settings');
}

/** Demande au navigateur de ne pas effacer les données (sans garantie sur iOS). */
export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // facultatif
  }
}

// ---------- Sauvegarde ----------

export interface Backup {
  format: 'pointage-000';
  version: 1;
  exportedAt: string;
  settings: Settings;
  sessions: Session[];
}

export function makeBackup(settings: Settings, sessions: Session[]): Backup {
  return { format: 'pointage-000', version: 1, exportedAt: new Date().toISOString(), settings, sessions };
}

function isSession(x: unknown): x is Session {
  const s = x as Session;
  return (
    !!s &&
    typeof s.id === 'string' &&
    typeof s.start === 'number' &&
    (s.end === null || typeof s.end === 'number') &&
    typeof s.manual === 'boolean' &&
    typeof s.note === 'string' &&
    typeof s.updatedAt === 'number'
  );
}

export interface ImportResult {
  added: number;
  updated: number;
  unchanged: number;
}

/**
 * Fusion par identifiant : rien n'est supprimé, et en cas de conflit
 * la version la plus récemment modifiée l'emporte.
 */
export async function importBackup(raw: unknown, current: Session[]): Promise<ImportResult> {
  const data = raw as Partial<Backup>;
  if (data?.format !== 'pointage-000' || !Array.isArray(data.sessions)) {
    throw new Error("Ce fichier n'est pas une sauvegarde Pointage.");
  }
  const byId = new Map(current.map((s) => [s.id, s]));
  const result: ImportResult = { added: 0, updated: 0, unchanged: 0 };
  const database = await db();
  const tx = database.transaction('sessions', 'readwrite');
  for (const s of data.sessions) {
    if (!isSession(s)) continue;
    const existing = byId.get(s.id);
    if (!existing) {
      result.added++;
      await tx.store.put(s);
    } else if (s.updatedAt > existing.updatedAt) {
      result.updated++;
      await tx.store.put(s);
    } else {
      result.unchanged++;
    }
  }
  await tx.done;
  return result;
}

export function newId(): string {
  return crypto.randomUUID();
}
