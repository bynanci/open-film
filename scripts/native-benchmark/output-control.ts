import type { Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";

/** Scoped ownership: stream failures must never abandon managed child processes. */
export function observeBenchmarkOutput() {
  let failure: Error | undefined;
  const broken = new Map<Writable, Error>();
  const pending = new Set<Promise<Error | undefined>>();
  const streams = [process.stdout, process.stderr];
  const handlers = streams.map((stream) => {
    const handler = (error: Error) => {
      broken.set(stream, error);
      failure ??= error;
    };
    stream.on("error", handler);
    return handler;
  });
  const write = (stream: Writable, value: string) => {
    const existing = broken.get(stream);
    if (existing) return Promise.resolve(existing);
    const writing = new Promise<Error | undefined>((resolve) => {
      const failed = (error: unknown) => {
        const problem =
          error instanceof Error ? error : new Error(String(error));
        broken.set(stream, problem);
        failure ??= problem;
        resolve(problem);
      };
      try {
        stream.write(value, (error) => {
          if (error) failed(error);
          else resolve(undefined);
        });
      } catch (error) {
        failed(error);
      }
    });
    pending.add(writing);
    void writing.then(() => pending.delete(writing));
    return writing;
  };
  return {
    get failure() {
      return failure;
    },
    stdout: (value: string) => write(process.stdout, value),
    stderr: (value: string) => write(process.stderr, value),
    async dispose() {
      await Promise.all(pending);
      // Writable callbacks precede error events; drain that turn before detaching.
      await setImmediate();
      streams.forEach((stream, index) =>
        stream.removeListener("error", handlers[index]!),
      );
    },
  };
}
