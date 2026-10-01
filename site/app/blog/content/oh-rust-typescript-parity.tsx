import { CodeBlock } from "../../code-block";

export const toc = [
  { href: "#one-different-byte-breaks-every-digest", label: "The same value needs the same bytes" },
  { href: "#the-typescript-encoder-is-the-reference", label: "The TypeScript encoder is the reference" },
  { href: "#five-rules-fix-the-bytes", label: "Five rules fix the bytes" },
  { href: "#generated-inputs-instead-of-chosen-examples", label: "Generated inputs instead of chosen examples" },
  { href: "#number-formatting-is-where-the-languages-differ", label: "Number formatting is where the languages differ" },
  { href: "#wordcell-runs-its-own-parity-checks", label: "Wordcell runs its own parity checks" },
  { href: "#what-the-parity-tests-do-not-prove", label: "What the parity tests do not prove" },
] as const;

export function ParityBody() {
  return (
    <>
      <p>A record fingerprint depends on the exact bytes being hashed. Two programs can agree about a value and still serialize it differently: one prints a number as <code>1.0</code>, another as <code>1</code>, or they sort object keys in different orders. A shared record format needs a precise encoding contract.</p>
      <h2 id="one-different-byte-breaks-every-digest">The same value needs the same bytes</h2>
      <p>Oh uses canonical JSON and SHA-256 fingerprints for its records. Its TypeScript encoder is the reference; an optional Rust encoder runs through WebAssembly. Comparing those implementations is a form of differential testing: the same accepted input should produce the same encoded text and digest.</p>
      <p>A fingerprint lets a reader check the contents against an expected record. It does not establish that the record’s claim is true or identify who authored it. Keeping those questions separate makes the storage guarantee easier to use correctly.</p>
      <h2 id="the-typescript-encoder-is-the-reference">The TypeScript encoder is the reference</h2>
      <p>Choose one definition of the format and compare every implementation against it. Matching a few convenient examples is insufficient: key ordering, escaping, and number formatting can differ on inputs that ordinary application tests never exercise.</p>
      <p>A runtime fallback and a comparison test serve different purposes. The fallback keeps a supported implementation available when an optional engine cannot load. The test must establish that the intended engine actually ran; otherwise it can pass by comparing the reference with itself.</p>
      <h2 id="five-rules-fix-the-bytes">Five rules fix the bytes</h2>
      <p>Oh’s record format is canonical JSON: each accepted value has a defined sequence of bytes. A record’s digest is the SHA-256 of those bytes, written as 64 lowercase hex characters. Five rules decide the bytes.</p>
      <ol>
        <li><strong>Object keys sort by UTF-16 code unit.</strong> This is how JavaScript’s <code>{"<"}</code> compares strings, and it is not the same as sorting by Unicode code point. The Rust encoder converts each key to UTF-16 before comparing, so both encoders agree even on keys where the two orders differ.</li>
        <li><strong>Strings are escaped exactly as <code>{"JSON.stringify"}</code> escapes them.</strong></li>
        <li><strong>Numbers are written exactly as JavaScript writes them.</strong> One number has one spelling.</li>
        <li><strong>Some values have no canonical form and are refused.</strong> Negative zero and non-finite numbers are errors in both encoders. The TypeScript reference also refuses strings with an unpaired surrogate, sparse arrays, cycles, and objects that aren’t plain.</li>
        <li><strong>Arrays keep their order.</strong> Only object keys are sorted.</li>
      </ol>
      <p>The Rust crate’s own unit tests pin these cases on JSON text. Here they are as the equivalent TypeScript calls:</p>
      <CodeBlock code={"canonicalJson({ b: 1, a: 2 });          // '{\"a\":2,\"b\":1}'\ncanonicalJson({ B: 1, A: 2, a: 3 });    // '{\"A\":2,\"B\":1,\"a\":3}'  uppercase sorts first\ncanonicalJson(JSON.parse(\"1.0\"));       // '1'\ncanonicalJson(1e20);                    // '100000000000000000000'\ncanonicalJson(1e21);                    // '1e+21'\ncanonicalJson(1e-7);                    // '1e-7'\ncanonicalJson(-0);                      // throws: negative zero is not canonical"} language="ts" />
      <p>Key sorting can trip up a careful port. Take the halfwidth ideographic full stop (U+FF61) and the grinning face emoji (U+1F600). By code point, the full stop comes first. In UTF-16 the emoji is stored as a surrogate pair starting at 0xD83D, which is smaller than 0xFF61, so JavaScript puts the emoji first. A Rust encoder that sorted Rust strings directly would follow code point order and produce different bytes for an object with both keys. Oh’s Rust encoder compares UTF-16 code units instead:</p>
      <CodeBlock code={"// Order keys the way JavaScript's `<` does: by UTF-16 code units.\nkeys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));"} language="rust" />
      <p>That line simplifies the crate’s comparison, which walks both UTF-16 sequences by hand. The ordering it enforces is what has to survive a refactor.</p>
      <h2 id="generated-inputs-instead-of-chosen-examples">Generated inputs instead of chosen examples</h2>
      <p>Examples like these only cover the cases someone already thought of. Oh’s parity suite uses property-based testing with fast-check: it states a property that must hold for every input, generates inputs, and reports the smallest failing input it can find if the property ever breaks.</p>
      <p>For every generated JSON text, the Rust encoder must return the same string as the reference, and the same digest. Simplified, the text check reads:</p>
      <CodeBlock code={"fc.assert(\n  fc.property(jsonText, (text) => {\n    const expected = canonicalJson(JSON.parse(text));   // TypeScript reference\n    const actual = rust.canonicalJson(text);            // Rust, through WebAssembly\n    expect(actual).toBe(expected);\n  }),\n  { numRuns: 1000 },\n);"} language="ts" />
      <p>Oh compares encoded documents and digests, exercises finite floating-point values, and keeps fixed edge cases for empty structures, escaped characters, Unicode keys, and negative zero. These checks provide evidence for the inputs exercised.</p>
      <p>Also test the installed package. A source-tree test can load a file from a path that does not exist in the distributed archive. Install the built package in an isolated directory, invoke its public loader, and check both the selected implementation and its output.</p>
      <h2 id="number-formatting-is-where-the-languages-differ">Number formatting is where the languages differ</h2>
      <p>Most of canonical JSON is bookkeeping. Numbers are where two languages disagree by default. JavaScript prints the shortest decimal string that reads back to the same 64-bit float, and switches to exponent notation at fixed thresholds: <code>{"1e20"}</code> prints as twenty-one digits, while <code>{"1e21"}</code> prints as <code>{"1e+21"}</code>. Rust’s standard formatting follows different rules.</p>
      <p>Oh’s Rust crate therefore carries its own number formatter that follows the ECMAScript specification’s steps for turning a number into a string. It uses the <code>{"ryu-js"}</code> crate to find the shortest digit string for the value, then applies the specification’s rules for where the decimal point and the exponent go. Generated finite doubles exercise that formatter against the reference; fixed boundary cases keep notation thresholds explicit.</p>
      <h2 id="wordcell-runs-its-own-parity-checks">Wordcell runs its own parity checks</h2>
      <p><a href="https://wordcell.io">Wordcell</a> uses Oh to derive a graph from Markdown notes and uses its optional Rust encoder when preparing a candidate for review. It checks the WebAssembly artifact’s fingerprint separately from encoder behavior.</p>
      <p>Its wrapper compares the Rust canonical text with the TypeScript text and returns <code>null</code> on a mismatch or load failure. The caller then uses the reference. That fallback protects the application path, but changes how a test must interpret the result: a generated-input test that skips <code>null</code> has not checked agreement for that input.</p>
      <p>Compare implementations directly where agreement is the property under test. Count rejected or skipped inputs, and keep strict cases that cannot pass through a fallback. A test that checks both text and digests also distinguishes an encoding disagreement from a hashing error.</p>
      <h2 id="what-the-parity-tests-do-not-prove">What the parity tests do not prove</h2>
      <p>A property test samples inputs. Its coverage depends on the generator as well as the number of runs. Thousands of values with one shape cannot exercise every nesting pattern, and ASCII strings do not cover Unicode ordering. Combine varied generated inputs with fixed cases chosen from the format’s difficult boundaries.</p>
      <p>The two encoders also take different inputs. The Rust engine reads JSON text, while the TypeScript reference encodes JavaScript values. The Rust crate’s own tests note that its JSON parser reads some extreme integer strings as a different float than JavaScript does, so text-level parity for those strings is not asserted. Oh’s generated tests use text that <code>{"JSON.stringify"}</code> produced, which is also what Wordcell’s wrapper passes to the Rust engine.</p>
      <p>Specify the accepted input domain, the canonical bytes, the fallback behavior, and the evidence each test supplies. Those contracts let another implementation evolve without quietly changing the meaning of a stored fingerprint.</p>
    </>
  );
}
