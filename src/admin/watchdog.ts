export interface Watchdog {
  /** Something happened (progress): restart the quiet time. */
  poke(): void;
  /** Finished: never fire. */
  stop(): void;
}

/** Calls `onStall` once if `ms` pass without a poke. Armed from creation until it fires or is stopped. */
export function watchdog(ms: number, onStall: () => void): Watchdog {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let live = true;
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      live = false;
      onStall();
    }, ms);
  };
  arm();
  return {
    poke: () => {
      if (live) arm();
    },
    stop: () => {
      live = false;
      clearTimeout(timer);
    },
  };
}
