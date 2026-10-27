import assert from "node:assert/strict";
import test from "node:test";

process.env.PREFIX = "/ca";
process.env.UPSTREAM_TLS = "false";
const proxy = await import("./path-prefix-proxy.mjs");

test("prefixes root URLs once", () => {
  const html = '<link rel="icon" href="/favicon.svg" />';
  assert.equal(
    proxy.rewriteHtml(html),
    '<link rel="icon" href="/ca/favicon.svg" />'
  );
  assert.equal(
    proxy.rewriteHtml('<link rel="icon" href="/ca/favicon.svg" />'),
    '<link rel="icon" href="/ca/favicon.svg" />'
  );
});

test("prefixes API and preload base without doubling", () => {
  const source = 'fetch("/api/health");const pX="modulepreload",fX=function(e){return"/"+e}';
  const rewritten = proxy.rewriteJavascript(source);
  assert.match(rewritten, /fetch\("\/ca\/api\/health"\)/);
  assert.match(rewritten, /return"\/ca\/"\+e/);
  assert.equal(proxy.rewriteJavascript(rewritten), rewritten);
});

test("keeps an already mounted API path", () => {
  assert.equal(proxy.rewriteJavascript('fetch("/ca/api/health")'), 'fetch("/ca/api/health")');
});

test("splits cookies between prefixes", () => {
  assert.equal(
    proxy.rewriteSetCookie("codex_web_session=abc; Path=/; HttpOnly"),
    "codex_web_session_ca=abc; Path=/ca; HttpOnly"
  );
  assert.equal(
    proxy.rewriteRequestCookie("codex_web_session_ca=abc"),
    "codex_web_session=abc"
  );
});

test("strips only the configured prefix", () => {
  assert.equal(proxy.stripPrefix("/ca/api/health"), "/api/health");
  assert.equal(proxy.stripPrefix("/ca"), "/");
  assert.equal(proxy.stripPrefix("/assets/app.js"), "/assets/app.js");
});

test("prefixes branding icon literals and leaves the path check intact", () => {
  const source =
    "const href=`/api/branding/icon?v=${id}`;const ok=/^\\/(?:[A-Za-z0-9_-]+\\/)?api\\/branding\\/icon$/.test(path)";
  const rewritten = proxy.rewriteJavascript(source);
  assert.match(rewritten, /\/ca\/api\/branding\/icon\?v=/);
  assert.match(rewritten, /\?api\\\/branding\\\/icon/);
  assert.equal(rewritten.includes("/ca/api\\/branding"), false);
});
