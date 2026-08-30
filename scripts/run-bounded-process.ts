export type BoundedProcessResult = Readonly<{ exitCode: number; stderr: Buffer; stdout: Buffer }>;

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maximum: number,
  kill: () => void,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > maximum) {
        kill();
        throw new Error("Subprocess output exceeded its streaming bound.");
      }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}

export async function runBoundedProcess(
  command: readonly string[],
  options: Readonly<{
    cwd?: string;
    env: Record<string, string | undefined>;
    stderrBytes?: number;
    stdoutBytes?: number;
    timeoutMs?: number;
  }>,
): Promise<BoundedProcessResult> {
  const child = Bun.spawn([...command], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: options.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  let timedOut = false;
  const kill = () => child.kill(9);
  const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs ?? 30_000);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      readBounded(child.stdout, options.stdoutBytes ?? 256 * 1_024, kill),
      readBounded(child.stderr, options.stderrBytes ?? 64 * 1_024, kill),
    ]);
    if (timedOut) throw new Error("Subprocess exceeded its time bound.");
    return Object.freeze({ exitCode, stderr, stdout });
  } finally { clearTimeout(timer); }
}
