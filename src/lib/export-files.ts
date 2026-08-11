export function buildExportFilename(stem: string, extension: string, date = new Date()) {
  return `${stem}-${date.toISOString().slice(0, 10)}.${extension}`;
}
