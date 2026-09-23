# Exact context token counts

The framework pilot counts the complete rendered context with a pinned
`o200k_base` tokenizer. This includes JSON punctuation, neutral unit IDs,
escaped content and line separators. Literal token markers such as
`<|endoftext|>` remain ordinary text. The context ceiling is 8,192 tokens.

These counts describe a string. They do not include the question, instructions,
message framing, tool schemas or output allowance. OpenAI's
[token-counting guide](https://developers.openai.com/api/docs/guides/token-counting)
distinguishes local text tokenization from complete request accounting. The
[archived tokenizer cookbook](https://developers.openai.com/cookbook/examples/how_to_count_tokens_with_tiktoken)
maps GPT-4o to `o200k_base`; it does not establish current model access or exact
chat-request usage.

## Pinned offline implementation

[The artifact manifest](../scripts/benchmarks/framework-pilot-tokenizer-v1/artifacts.json)
pins OpenAI's `tiktoken` 0.14.0 release, source commit
`4e71bbe0c078468e00fefbf94b39849389f346e5`, two wheel archives and every loaded
member. The official encoding asset is 3,613,922 bytes with SHA-256
`446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d`.
The manifest includes the download URLs and exact sizes and digests.

The isolated worker accepts standard-GIL CPython 3.14 on macOS arm64 or Linux
x86-64. Other versions, ABIs and platforms fail. Linux also needs the runtime
compatibility required by the pinned `manylinux_2_28` wheel. The parent records
the resolved interpreter path, executable digest, Python version, platform,
worker digest, wheel digest, native member digest and encoding digest.
Interpreter identity is an observation; it is not an attestation of the entire
Python toolchain or system libraries.

Counting requires local copies of the platform's wheel and encoding asset in
an explicitly selected directory. There is no automatic download, package
installation, network fallback or required Oh dependency. `package.json`, the
Bun lockfile and the published SDK are unaffected.

Before importing code, the worker verifies the archive and fixed native member
against their sizes and SHA-256 digests. It extracts only that member into an
empty directory owned by the parent. The parent removes the directory after
collecting the process, including failure and timeout paths. Python runs with
`-I -S -B`, without site packages or inherited credentials. A Python socket
guard adds defense in depth; it is not an operating-system network sandbox.

The worker uses the official native `CoreBPE.encode_ordinary` implementation
with the pinned source's pattern and local asset. It rejects lone Unicode
surrogates instead of applying replacement or normalization. It never trims
text, recognizes a literal special marker as a control token, or estimates
tokens from bytes.

## Count and pack a context

The [TypeScript adapter](../scripts/benchmarks/framework-pilot-tokenizer-v1.ts)
exports `countFrameworkPilotTokenBatchV1` and
`packFrameworkPilotContextWithTiktokenV1`. Both require explicit absolute
`python` and `artifactsDirectory` paths. The batch input is:

```ts
{
  protocol: "oh.framework-pilot-token-batch-input.v1",
  texts: ["the exact complete context string"]
}
```

Each batch contains 1–21 strings, each at most 262,144 UTF-8 bytes. Request
JSON is bounded at 12 MiB, process output at 32 KiB and process duration at 30
seconds. Failed, timed-out, malformed or mismatched responses fail the call;
there is no retry or approximate fallback. Every returned count is joined to
the exact input string's digest and byte length.

Context packing first validates the complete
[source-block context input](FRAMEWORK_PILOT_SOURCE_V1.md), including candidates
that may be omitted. It collects the empty string and every complete unique
JSON-lines prefix, counts them in one process, then applies the existing
rank-order packing policy using those exact counts. It stops at the first
overflow and preserves duplicate and omission reasons. It never sums
independently tokenized blocks or truncates a block. The existing context
result retains its own qualification disclaimer; the surrounding tokenized
context result carries the separate execution evidence.

This adapter does not establish that a retrieved block matches its source,
that the source projection is complete, or that a full model request fits.
Those are separate admission checks.

## Reproduce qualification

Download the wheel for the intended platform and `o200k_base.tiktoken` from the
manifest into a dedicated local directory. Qualification and counting then run
offline. Supply an installed CPython 3.14 executable; ordinary Bun commands do
not install or download it.

```sh
bun test tests/memory-benchmark-framework-pilot-tokenizer.test.ts

bun scripts/benchmarks/framework-pilot-tokenizer-v1/qualify.ts \
  --python /absolute/path/to/python3.14 \
  --artifacts /absolute/path/to/tokenizer-artifacts \
  --output /absolute/path/to/new-qualification-receipt.json
```

The output path must be new. Keep this receipt with the exact source, toolchain
and campaign admission evidence. The focused repository tests check schema,
Unicode, byte limits and artifact rejection without a native download.
Native qualification is a separate command and must pass on the selected
execution host before a benchmark relies on its counts.

Qualification compares 21
[frozen token-ID fixtures](../tests/fixtures/framework-pilot-tokenizer-v1.json)
with both the native path and OpenAI's public
`Encoding.encode(allowed_special=set(), disallowed_special=())` API, loaded from
the verified wheel. Three fixtures also preserve the archived cookbook's
published token IDs. The public constructor receives the verified local ranks;
plugin discovery and remote loading are disabled. Fixtures cover multilingual
text, combining characters, emoji, control characters, literal special markers
and complete JSON-lines contexts.

Additional cases verify 8,191, 8,192 and 8,193-token strings, actual context
acceptance at 8,192, rejection at 8,193, and ranked duplicate/overflow handling.
Passing establishes parity for this bounded fixture set and the observed
implementation. It supplies no reader accuracy result, provider qualification
or claim about full-request usage.
