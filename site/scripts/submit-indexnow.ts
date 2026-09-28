import { ohIndexNowKey, ohIndexNowPayload } from "./indexnow";

// Usage: bun run search:notify -- / /compare /blog
const endpoint = process.env.INDEX_NOW_ENDPOINT ?? "https://api.indexnow.org/indexnow";
const payload = ohIndexNowPayload(process.argv.slice(2));

const keyResponse = await fetch(payload.keyLocation);
if (!keyResponse.ok || (await keyResponse.text()).trim() !== ohIndexNowKey) {
  throw new Error(`The IndexNow key is not served at ${payload.keyLocation}.`);
}

const response = await fetch(endpoint, {
  body: JSON.stringify(payload),
  headers: { "Content-Type": "application/json; charset=utf-8" },
  method: "POST",
});

if (response.status !== 200 && response.status !== 202) {
  throw new Error(`IndexNow rejected ${payload.urlList.length} URLs with HTTP ${response.status}: ${await response.text()}`);
}

console.log(`IndexNow accepted ${payload.urlList.length} oh.computer URLs with HTTP ${response.status}.`);
