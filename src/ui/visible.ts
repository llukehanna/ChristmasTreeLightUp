/**
 * Run `fn` every `ms` while the tab is visible. A hidden tab clears the timer (it does no work); on return `fn` runs
 * once at once, to catch up, and the timer restarts. Returns a stop function.
 */
export function everyWhileVisible(fn: () => void, ms: number, doc: Document = document): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const start = (): void => {
    if (timer === null) timer = setInterval(fn, ms);
  };
  const clear = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const onChange = (): void => {
    if (doc.hidden) {
      clear();
    } else if (timer === null) {
      fn();
      start();
    }
  };
  doc.addEventListener('visibilitychange', onChange);
  if (!doc.hidden) start();
  return () => {
    clear();
    doc.removeEventListener('visibilitychange', onChange);
  };
}
