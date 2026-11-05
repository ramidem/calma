// Opens the Google sign-in page in the default browser. No dependencies: the platform's own opener, run without a shell.
import { spawn } from "node:child_process";

/** Only Google's sign-in page is ever opened. Anything else is refused, so a bug cannot launch an arbitrary URL. */
export function isGoogleSignInUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "accounts.google.com" && u.pathname.startsWith("/o/oauth2/");
  } catch {
    return false;
  }
}

/** The opener command for a platform: [command, ...args-before-the-url]. */
export function openerFor(platform = process.platform) {
  if (platform === "darwin") return ["open"];
  if (platform === "win32") return ["rundll32", "url.dll,FileProtocolHandler"];
  return ["xdg-open"];
}

/** Opens `url` in the default browser. Resolves true if the opener started, false if it could not (headless, missing opener, refused URL). */
export function openUrl(url, { platform = process.platform, spawnFn = spawn } = {}) {
  if (!isGoogleSignInUrl(url)) return Promise.resolve(false);
  const [cmd, ...args] = openerFor(platform);
  return new Promise((resolve) => {
    try {
      const child = spawnFn(cmd, [...args, url], { stdio: "ignore", detached: true, shell: false });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
