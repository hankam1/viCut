export function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

export function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

export function dirname(filePath: string): string {
  const separatorIndex = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
  return separatorIndex > 0 ? filePath.slice(0, separatorIndex) : filePath;
}

export function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
