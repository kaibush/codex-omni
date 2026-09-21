export const TERMINAL_SUBMIT_DELAY_MS = 40;

export function splitTrailingSubmit(data: string): { body: string; submit: boolean } {
  if (!data.endsWith("\r")) return { body: data, submit: false };
  return { body: data.slice(0, -1), submit: true };
}

export function writeTerminalInput(
  write: (data: string) => void,
  data: string,
  options: {
    getTimer: () => unknown;
    setTimer: (timer: unknown) => void;
    alive?: () => boolean;
    delayMs?: number;
  }
) {
  const previous = options.getTimer();
  if (previous != null) {
    clearTimeout(previous as NodeJS.Timeout);
    options.setTimer(null);
    write("\r");
  }
  const { body, submit } = splitTrailingSubmit(data);
  if (body) write(body);
  if (!submit) return;
  if (!body) {
    write("\r");
    return;
  }
  const timer = setTimeout(() => {
    if (options.getTimer() !== timer) return;
    options.setTimer(null);
    if (options.alive && !options.alive()) return;
    write("\r");
  }, options.delayMs ?? TERMINAL_SUBMIT_DELAY_MS);
  options.setTimer(timer);
}
