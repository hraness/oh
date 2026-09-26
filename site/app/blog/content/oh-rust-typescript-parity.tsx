// Converted from the reviewed draft. Keep the prose; edit facts only with a new review.
import publishedRelease from "../../../published-release.json";

export const toc = [
  { href: "#a-port-that-passes-every-example-still-breaks", label: "A port that passes every example still breaks" },
  { href: "#what-it-looks-like-when-the-two-cannot-quietly-disagree", label: "What it looks like when the two cannot quietly disagree" },
  { href: "#the-laws-both-encoders-follow", label: "The laws both encoders follow" },
  { href: "#generated-inputs-instead-of-chosen-examples", label: "Generated inputs instead of chosen examples" },
  { href: "#numbers-are-the-hard-corner", label: "Numbers are the hard corner" },
  { href: "#wordcell-checks-again-on-its-side", label: "Wordcell checks again on its side" },
  { href: "#what-the-parity-test-does-not-prove", label: "What the parity test does not prove" },
] as const;

export function ParityBody() {
  const releaseVersion = publishedRelease.version;
  return (
    <>
      <p>Oh ships two encoders for its record format: a TypeScript encoder, which is the reference and the one Oh’s own store uses, and an optional Rust encoder compiled to WebAssembly. A property-based test suite compares the two on thousands of generated inputs, so a developer who opts into the Rust engine can expect the digest the reference would produce. That matters because every record Oh stores carries a SHA-256 digest of its encoded bytes, and a digest is only useful if every program that computes it encodes the record the same way.</p>
      <h2 id="a-port-that-passes-every-example-still-breaks">A port that passes every example still breaks</h2>
      <p>Most people who have shipped software know this bug. A team rewrites a piece of code in a faster language. The new version passes every test someone wrote for the old one. Weeks later a customer reports that a record saved from the new service fails to verify on the old one, and only for some records. The cause turns out to be one character: a number printed as <code>{"1.0"}</code> where the old code printed <code>{"1"}</code>, or two keys sorted in a different order because one of them started with an accented letter.</p>
      <p>AI coding tools make this failure cheaper to create. A model can translate a module in minutes, and the result looks finished. It compiles, it reads well, and it agrees with the handful of examples in the old test file. Nobody checked the inputs that nobody thought to write down. That is vibe-coded slop in its most convincing form, and a storage format is the worst place for it, because a mismatch shows up long after the write, on a different machine, as history that no longer checks out.</p>
      <p>In a memory store, the digest says “this record has not changed.” If the two encoders disagree by one byte about the same record, the store can’t tell a tampered record from a record written by the other implementation.</p>
      <h2 id="what-it-looks-like-when-the-two-cannot-quietly-disagree">What it looks like when the two cannot quietly disagree</h2>
      <p>One implementation is the reference. Any second implementation earns its place only by agreeing with the reference, byte for byte, on a large supply of inputs that a machine invents rather than a person. If it disagrees once, the test fails and names the input. If a second implementation is missing or can’t load, the system uses the reference instead of guessing.</p>
      <p>For someone building on Oh, a digest from the opt-in Rust engine matches the digest from the TypeScript package on every input the tests have tried. If the engine can’t load, the loader hands back the TypeScript reference, so the answer doesn’t depend on which one ran.</p>
      <p>The Hraness plan for shared Rust code sets this as the rule for every Rust replacement it covers: the TypeScript implementation stays the reference, and the Rust version has to match it byte for byte in property tests.</p>
      <h2 id="the-laws-both-encoders-follow">The laws both encoders follow</h2>
      <p>Oh’s record format is canonical JSON: for any value there is exactly one sequence of bytes. A record’s digest is the SHA-256 of those bytes, written as 64 lowercase hex characters. Five rules pin the bytes down.</p>
      <ol>
        <li><strong>Object keys sort by UTF-16 code unit.</strong> This is how JavaScript’s <code>{"<"}</code> compares strings, and it is not the same as sorting by Unicode code point. The Rust encoder converts each key to UTF-16 before comparing, so both encoders agree even on keys where the two orders differ.</li>
        <li><strong>Strings are escaped exactly as <code>{"JSON.stringify"}</code> escapes them.</strong></li>
        <li><strong>Numbers are written exactly as JavaScript writes them.</strong> One number has one spelling.</li>
        <li><strong>Some values have no canonical form and are refused.</strong> Negative zero and non-finite numbers are errors in both encoders. The TypeScript reference also refuses strings with an unpaired surrogate, sparse arrays, cycles, and objects that aren’t plain.</li>
        <li><strong>Arrays keep their order.</strong> Only object keys are sorted.</li>
      </ol>
      <p>A few examples make the rules concrete. The Rust crate’s own unit tests pin these cases on JSON text; they are written here as the equivalent TypeScript calls:</p>
      <pre data-language="ts"><code>{"canonicalJson({ b: 1, a: 2 });          // '{\"a\":2,\"b\":1}'\ncanonicalJson({ B: 1, A: 2, a: 3 });    // '{\"A\":2,\"B\":1,\"a\":3}'  uppercase sorts first\ncanonicalJson(JSON.parse(\"1.0\"));       // '1'\ncanonicalJson(1e20);                    // '100000000000000000000'\ncanonicalJson(1e21);                    // '1e+21'\ncanonicalJson(1e-7);                    // '1e-7'\ncanonicalJson(-0);                      // throws: negative zero is not canonical"}</code></pre>
      <p>Key sorting can trip up a careful port. Take the halfwidth ideographic full stop (U+FF61) and the grinning face emoji (U+1F600). By code point, the full stop comes first. In UTF-16 the emoji is stored as a surrogate pair starting at 0xD83D, which is smaller than 0xFF61, so JavaScript puts the emoji first. A Rust encoder that sorted Rust strings directly would follow code point order and produce different bytes for an object with both keys. Oh’s Rust encoder compares UTF-16 code units instead:</p>
      <pre data-language="rust"><code>{"// Order keys the way JavaScript's `<` does: by UTF-16 code units.\nkeys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));"}</code></pre>
      <p>That line is a simplified version of the crate’s comparison, which walks both UTF-16 sequences by hand. The law it enforces is the part that stays true after a refactor.</p>
      <h2 id="generated-inputs-instead-of-chosen-examples">Generated inputs instead of chosen examples</h2>
      <p>Examples like these only cover the cases someone already thought of. Oh’s parity suite uses property-based testing with fast-check: it states a property that must hold for every input, generates inputs, and reports the smallest failing input it can find if the property ever breaks.</p>
      <p>The property is one line of intent. For every generated JSON text, the Rust encoder must return the same string as the reference, and the same digest. Simplified, the text check reads:</p>
      <pre data-language="ts"><code>{"fc.assert(\n  fc.property(jsonText, (text) => {\n    const expected = canonicalJson(JSON.parse(text));   // TypeScript reference\n    const actual = rust.canonicalJson(text);            // Rust, through WebAssembly\n    expect(actual).toBe(expected);\n  }),\n  { numRuns: 1000 },\n);"}</code></pre>
      <p>As of 2026-09-26 the suite in Oh’s repository runs:</p>
      <ul>
        <li>1,000 generated documents comparing canonical JSON text,</li>
        <li>1,000 generated documents comparing SHA-256 digests,</li>
        <li>20,000 generated finite floating-point numbers, each of which the Rust encoder must print exactly as <code>{"JSON.stringify"}</code> does,</li>
        <li>a fixed list of edge cases, including empty objects and arrays, escaped control characters, an emoji written as an escaped surrogate pair, mixed-case keys, and the two keys above, whose UTF-16 and code-point orders differ,</li>
        <li>and a check that both <code>{"-0"}</code> and <code>{"-0.0"}</code> are refused.</li>
      </ul>
      <p>The suite also asserts that the Rust engine loaded at all. Oh’s loader, the <code>{"@hraness/oh/canonical-rust"}</code> export, reports which implementation it is using, <code>{"rust-wasm"}</code> or <code>{"typescript"}</code>, and falls back to the TypeScript reference when the WebAssembly module isn’t available. Without that first assertion, a parity test could pass by comparing the reference with itself.</p>
      <p>That assertion runs from Oh’s source tree, where the Rust build sits in a different folder than in the published package. From v0.10.3, the first release with this loader, until a fix merged on 2026-09-26, the packaged loader looked for its WebAssembly files one folder above the one they ship in, so installed copies of those releases fall back and run the reference. The digests stayed correct, because the fallback is the reference, and that is also why nothing failed. The fix loads the files from the packaged folder and adds a check that installs the packed package and fails unless the loader reports <code>{"rust-wasm"}</code>.</p>
      <h2 id="numbers-are-the-hard-corner">Numbers are the hard corner</h2>
      <p>Most of canonical JSON is bookkeeping. Numbers are where two languages disagree by default. JavaScript prints the shortest decimal string that reads back to the same 64-bit float, and switches to exponent notation at fixed thresholds: <code>{"1e20"}</code> prints as twenty-one digits, while <code>{"1e21"}</code> prints as <code>{"1e+21"}</code>. Rust’s standard formatting follows different rules.</p>
      <p>Oh’s Rust crate therefore carries its own number formatter that follows the ECMAScript specification’s steps for turning a number into a string. It uses the <code>{"ryu-js"}</code> crate to find the shortest digit string for the value, then applies the specification’s rules for where the decimal point and the exponent go. The 20,000 generated numbers in the parity suite exist to test that one function against the reference across the full range of finite doubles.</p>
      <h2 id="wordcell-checks-again-on-its-side">Wordcell checks again on its side</h2>
      <p>Wordcell, the Markdown knowledge base, uses Oh to build a disposable graph from your notes, and it uses the Rust engine when it computes an adoption candidate’s digest. It loads a different build of the same Rust crate: a plain WebAssembly binary with no JavaScript glue, which Oh’s package also exports as embedded bytes. Wordcell runs its own parity checks against the <code>{"@hraness/oh"}</code> release it pins:</p>
      <ul>
        <li>It confirms that the embedded WebAssembly bytes match the packaged binary and have the SHA-256 digest Oh exports for that artifact.</li>
        <li>It generates nested JSON values (nulls, booleans, integers, doubles, printable-ASCII strings, arrays, and objects, nested inside one another) and compares the Rust output with Oh’s TypeScript output: 300 runs for the canonical text and 200 for the digest. Inputs the reference refuses are skipped, and so are inputs where the Rust wrapper returns nothing. The wrapper returns nothing whenever the Rust text differs from the reference, so neither generated check can fail on an encoding mismatch; the digest check compares the two SHA-256 steps on matching text, and the edge cases below are the strict comparisons.</li>
        <li>It checks a list of edge cases, each of which must match exactly with no fallback allowed, such as the empty-string key, a key containing a null character, accented and emoji keys, and the numbers <code>{"1e21"}</code>, <code>{"1e-21"}</code>, and <code>{"5e-324"}</code>.</li>
      </ul>
      <p>At run time Wordcell adds a guard. Its wrapper computes the reference canonical text too, and returns nothing if the Rust text differs or the engine fails to load. If the two texts match, it then asks the Rust engine for the digest. When the wrapper returns nothing, the calling code uses Oh’s TypeScript digest and writes a one-line notice, once per kind of failure:</p>
      <pre data-language="ts"><code>{"const rustDigest = canonicalSha256Rust(candidate);           // null if the text differs or the engine fails\nconst digest = rustDigest ?? canonicalSha256(candidate);     // TypeScript reference"}</code></pre>
      <p>The plan for shared Rust code calls this an optional fast path, but the guard computes the reference text on every call, and Oh publishes no performance figures for it. For a Wordcell user, a disagreement between the two encoders about the canonical text can’t change an adoption candidate’s digest; at worst it produces a notice. The guard compares text, not digests, so the digest itself relies on the parity tests above.</p>
      <h2 id="what-the-parity-test-does-not-prove">What the parity test does not prove</h2>
      <p>A property test samples inputs; it does not check all of them. Passing 1,000 or 20,000 generated cases is evidence, not a proof. Oh’s own generator also produces documents of one fixed shape (a short array of integers, a small map from short string keys to strings, booleans, or nulls, and one nested boolean), and every generated string in both suites is printable ASCII. Only Wordcell’s suite generates nesting of varying depth; control-character escapes and non-ASCII keys appear only as fixed edge cases.</p>
      <p>The two encoders also take different inputs. The Rust engine reads JSON text, while the TypeScript reference encodes JavaScript values. The Rust crate’s own tests note that its JSON parser reads some extreme integer strings as a different float than JavaScript does, so text-level parity for those strings is not asserted. Oh’s generated tests use text that <code>{"JSON.stringify"}</code> produced, which is also what Wordcell’s wrapper passes to the Rust engine.</p>
      <p>The TypeScript encoder is the reference, and the Rust engine is an opt-in export: Oh’s base package has no required runtime dependencies. Latest release: v{releaseVersion}.</p>
    </>
  );
}
