import { execFile, spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";

const APPLE_TEAM_ID = "8AAP53VTW3";
const APPLE_IDENTIFIER = "dev.hraness.oh.sqlite-cli";
const REQUIREMENT = `anchor apple generic and identifier "${APPLE_IDENTIFIER}" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${APPLE_TEAM_ID}"`;
const CODESIGN = "/usr/bin/codesign";
const TIMEOUT_MS = 10_000;
const VERIFIER_ENV = Object.freeze({ PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" });

export class MacOsSidecarSignatureError extends Error {
  override readonly name = "MacOsSidecarSignatureError";
  constructor() {
    super("The packaged native helper does not have the required Apple Developer ID signature.");
  }
}

export type VerifiedMacSidecar = Readonly<{
  dev: bigint;
  ino: bigint;
  size: bigint;
  mode: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}>;

function identity(path: string): VerifiedMacSidecar {
  try {
    const file = lstatSync(path, { bigint: true });
    if (!file.isFile() || file.size < 1n || file.size > 134_217_728n || (file.mode & 0o111n) === 0n) {
      throw new MacOsSidecarSignatureError();
    }
    return Object.freeze({ dev: file.dev, ino: file.ino, size: file.size, mode: file.mode,
      mtimeNs: file.mtimeNs, ctimeNs: file.ctimeNs });
  } catch {
    throw new MacOsSidecarSignatureError();
  }
}

export function assertVerifiedMacSidecar(path: string, expected: VerifiedMacSidecar): void {
  const actual = identity(path);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino || actual.size !== expected.size
    || actual.mode !== expected.mode || actual.mtimeNs !== expected.mtimeNs || actual.ctimeNs !== expected.ctimeNs) {
    throw new MacOsSidecarSignatureError();
  }
}

function argumentsFor(path: string): string[] {
  return ["--verify", "--strict", "--all-architectures", "--test-requirement", REQUIREMENT, path];
}

// No verifier path or identity comes from the environment. No verifier output
// is forwarded: failure is a fixed message without paths or command output.
export async function verifyMacSidecar(path: string): Promise<VerifiedMacSidecar> {
  const before = identity(path);
  await new Promise<void>((resolve, reject) => {
    try {
      execFile(CODESIGN, argumentsFor(path), {
        env: VERIFIER_ENV, timeout: TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 16_384,
      }, (error) => {
        if (error !== null) reject(new MacOsSidecarSignatureError());
        else resolve();
      });
    } catch {
      reject(new MacOsSidecarSignatureError());
    }
  });
  assertVerifiedMacSidecar(path, before);
  return before;
}

export function verifyMacSidecarSync(path: string): VerifiedMacSidecar {
  const before = identity(path);
  try {
    const result = spawnSync(CODESIGN, argumentsFor(path), {
      env: VERIFIER_ENV, timeout: TIMEOUT_MS, killSignal: "SIGKILL", stdio: "ignore",
    });
    if (result.error !== undefined || result.signal !== null || result.status !== 0) {
      throw new MacOsSidecarSignatureError();
    }
  } catch {
    throw new MacOsSidecarSignatureError();
  }
  assertVerifiedMacSidecar(path, before);
  return before;
}
