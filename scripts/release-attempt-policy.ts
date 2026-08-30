export function mayPerformFirstNpmPublication(runAttempt: string, exactVersionExists: boolean): boolean {
  if (!/^[1-9][0-9]*$/u.test(runAttempt)) throw new Error("Release attempt is invalid.");
  return exactVersionExists || Number(runAttempt) > 0;
}
