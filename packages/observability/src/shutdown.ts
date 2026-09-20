export interface ShutdownTarget {
  readonly close: () => Promise<void>;
}

export function registerGracefulShutdown(
  targets: readonly ShutdownTarget[],
  timeoutMs: number,
): () => void {
  let closing = false;
  let timeout: NodeJS.Timeout | undefined;

  const close = async (): Promise<void> => {
    if (closing) {
      return;
    }

    closing = true;
    timeout = setTimeout(() => {
      process.exitCode = 1;
    }, timeoutMs);
    timeout.unref();

    try {
      await Promise.all(targets.map(async (target) => target.close()));
    } catch {
      process.exitCode = 1;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  };

  const handleSignal = (): void => {
    void close();
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  return () => {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    if (timeout) {
      clearTimeout(timeout);
    }
  };
}
