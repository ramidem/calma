// The browser half of sign-in, shared by `calma auth` and `calma-write auth`: a one-shot local server that receives
// Google's redirect (RFC 8252) and PKCE values. No Google scope or token logic lives here.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { ToolError } from "./config.mjs";

const b64url = (buf) => buf.toString("base64url");

/** Fresh PKCE verifier and S256 challenge, and a random `state`. */
export function newPkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()), state: b64url(randomBytes(16)) };
}

/**
 * Listens on 127.0.0.1 (random port) for Google's callback. `code` resolves with the authorization code; it rejects on a
 * Google error or after `timeoutMs`. A callback with the wrong `state` is not Google answering us (a stray request, or
 * someone probing the port): it is ignored and the wait continues.
 */
export async function listenForCallback({ state, timeoutMs = 300_000 }) {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const code = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ToolError("auth_timeout", "No answer from Google within 5 minutes.")), timeoutMs);
    server.on("request", (req, res) => {
      const u = new URL(req.url, redirectUri);
      if (u.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      if (u.searchParams.get("state") !== state) {
        res.writeHead(400, { "content-type": "text/plain" }).end("Unexpected request. Ignored.");
        return;
      }
      if (u.searchParams.get("error")) {
        res.writeHead(400, { "content-type": "text/plain" }).end("Not authorised. You can close this tab.");
        clearTimeout(timer);
        reject(new ToolError("auth_failed", `Google returned an error: ${u.searchParams.get("error").replace(/[^a-z_]/gi, "")}`));
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" }).end("Authorised. You can close this tab.");
      clearTimeout(timer);
      resolve(u.searchParams.get("code"));
    });
  });
  return { redirectUri, code, close: () => server.close() };
}
