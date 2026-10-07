/** Cancellation releases application ownership even if a provider ignores its
 * signal. Providers remain responsible for stopping their underlying work;
 * late results/rejections are consumed without resuming the cancelled caller. */
export function cancellableProviderResult<T>(
  work: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", cancel);
      action();
    };
    const cancel = () =>
      finish(() =>
        reject(new DOMException("Provider operation cancelled.", "AbortError")),
      );
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    // Install both handlers even if cancellation already won, preventing
    // unhandled late rejections from a non-cooperating provider.
    work.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}
