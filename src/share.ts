// Remise d'un fichier à la feuille de partage (iOS / Android), ou téléchargement à défaut.

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

export async function shareOrDownload(file: File): Promise<ShareOutcome> {
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // autre erreur : on se rabat sur le téléchargement
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/** Nom de fichier sûr : sans accents, sans espaces ni caractères spéciaux. */
export function safeFilePart(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^dr\.?\s+/i, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
