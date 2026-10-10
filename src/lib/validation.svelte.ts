/**
 * Runs `check` shortly after `read()` settles and exposes its message. Call it while a component
 * initializes, because it registers an effect. `read` returns null when there is nothing to check.
 */
export function createValidator<T>(
  read: () => T | null,
  check: (input: T) => Promise<string | null>,
  delayMs = 200,
) {
  let error = $state<string | null>(null);

  $effect(() => {
    const input = read();
    if (input === null) {
      error = null;
      return;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const message = await check(input);
        if (!stale) error = message;
      } catch {
        // If the backend cannot answer, the search itself will report the problem.
        if (!stale) error = null;
      }
    }, delayMs);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  });

  return {
    get error() {
      return error;
    },
  };
}
