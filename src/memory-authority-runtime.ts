import { Cause, Effect, Exit, Option } from "effect";
import { parseAdoptionRequest, parseCanonicalAdvanceRequest,
  type OhMemoryAuthorityOptionsV1, type OhMemoryAuthorityV1 } from "./memory-core";
import { memoryAuthorityLive, type MemoryFailure } from "./memory-authority-platform";
import { makeMemoryAuthority } from "./memory-authority-program";

function unwrap<A>(exit: Exit.Exit<A, MemoryFailure>): A {
  if (Exit.isSuccess(exit)) return exit.value;
  const expected = Cause.failureOption(exit.cause);
  if (Option.isSome(expected)) throw expected.value.cause;
  throw Cause.squash(exit.cause);
}

function run<A>(program: Effect.Effect<A, MemoryFailure, never>): Promise<A> {
  return Effect.runPromiseExit(program).then(unwrap);
}

/** Existing Promise surface; stores and agent capability lifetimes remain borrowed. */
export async function createOhMemoryAuthorityV1(options: OhMemoryAuthorityOptionsV1): Promise<OhMemoryAuthorityV1> {
  const authority = await run(makeMemoryAuthority.pipe(Effect.provide(memoryAuthorityLive(options))));
  return Object.freeze({
    agent: Object.freeze({
      explain: (value: unknown) => authority.agent.explain(value),
      nominate: (value: unknown) => authority.agent.nominate(value),
      query: (value: unknown) => authority.agent.query(value),
      remember: (value: unknown) => authority.agent.remember(value),
    }),
    host: Object.freeze({
      advanceCanonical: (value: unknown) => {
        // Detach before enqueueing; caller mutation cannot change a waiting request.
        try { return run(authority.advanceCanonical(parseCanonicalAdvanceRequest(value))); }
        catch (cause) { return Promise.reject(cause); }
      },
      adoptNomination: (value: unknown) => {
        try { return run(authority.adoptNomination(parseAdoptionRequest(value))); }
        catch (cause) { return Promise.reject(cause); }
      },
    }),
  });
}
