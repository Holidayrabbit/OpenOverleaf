export function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const omitted = value.length - max;
  return `${value.slice(0, max)}\n…[truncated ${omitted} characters]`;
}

export function tail(value: string, maxLines: number): string {
  const lines = value.replace(/\n$/, "").split(/\r?\n/);
  if (lines.length <= maxLines) return lines.join("\n").trim();
  return lines.slice(-maxLines).join("\n").trim();
}

/** Keep the first LaTeX error in view when it sits above a long transcript. */
export function relevantLog(log: string): string {
  const lines = log.replace(/\n$/, "").split(/\r?\n/);
  const errorAt = lines.findIndex((line) => line.startsWith("!"));
  const tailText = lines.slice(-160).join("\n").trim();
  if (errorAt === -1) return tailText;
  const errorLine = lines[errorAt] ?? "";
  if (tailText.includes(errorLine)) return tailText;
  const errorBlock = lines.slice(errorAt, errorAt + 12).join("\n");
  return `${errorBlock}\n…\n${tailText}`.trim();
}
