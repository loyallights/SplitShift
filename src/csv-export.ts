import { getCartridgeSdk, hosted } from './persistence';

/** Returns the host path, null on cancellation, or 'download' in browser preview. */
export async function exportTextFile(content: string, filename: string): Promise<string | null> {
  if (!hosted) {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    try { link.click(); } finally {
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    return 'download';
  }
  const sdk = getCartridgeSdk();
  const directory = await sdk.invoke<string | null>('dialog.selectFolder', {});
  if (!directory) return null;
  // A fresh filename avoids replacing an earlier exported report.
  const uniqueName = filename.replace(/\.csv$/i, '') + '-' + crypto.randomUUID() + '.csv';
  const filePath = directory + (/[\\/]$/.test(directory) ? '' : '/') + uniqueName;
  const result = await sdk.invoke<{ success?: boolean; error?: string }>('dialog.writeFile', {
    filePath, content,
  });
  if (result?.success === false) throw new Error(result.error || 'The CSV file could not be saved.');
  return filePath;
}
