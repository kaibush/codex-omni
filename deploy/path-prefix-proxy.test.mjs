import assert from "node:assert/strict";
import test from "node:test";

process.env.PREFIX = "/ca";
process.env.UPSTREAM_TLS = "false";
process.env.REGION_NAV = "us:美国,ca:加拿大";
const proxy = await import("./path-prefix-proxy.mjs");

test("prefixes root URLs once", () => {
  const html = '<link rel="icon" href="/favicon.svg" />';
  assert.equal(proxy.rewriteHtml(html), '<link rel="icon" href="/ca/favicon.svg" />');
  assert.equal(
    proxy.rewriteHtml('<link rel="icon" href="/ca/favicon.svg" />'),
    '<link rel="icon" href="/ca/favicon.svg" />'
  );
});

test("injects the movable region switcher without touching app markup", () => {
  const html =
    '<!doctype html><html><head><title>App</title></head><body><div id="root"></div></body></html>';
  const rewritten = proxy.rewriteHtml(html);
  assert.match(rewritten, /<link rel="stylesheet" href="\/ca\/region-nav.css">/);
  assert.match(rewritten, /<script src="\/ca\/region-nav.js" defer><\/script><\/head>/);
  assert.match(
    rewritten,
    /<nav id="codex-region-nav" data-codex-region-nav data-current="ca" data-regions="[^"]+" aria-label="地区切换"><a href="\/us\/" aria-label="前往美国站点"[^>]*><img src="\/ca\/region-nav\/icons\/us.svg"[^>]*><span>US<\/span><\/a><a href="\/ca\/" aria-current="page"[^>]*><img src="\/ca\/region-nav\/icons\/ca.svg"[^>]*><span>CA<\/span><\/a><\/nav><div id="root"><\/div>/
  );
  assert.equal(proxy.rewriteHtml(rewritten), rewritten);
});

test("does not prefix region switcher assets", () => {
  assert.match(proxy.rewriteHtml('<img src="/region-nav/us.svg">'), /src="\/region-nav\/us.svg"/);
});

test("supports arbitrary configured regions and escapes labels", () => {
  assert.deepEqual(proxy.parseRegionNav("jp:日本, sg: 新加坡 ,jp:重复"), [
    { code: "jp", label: "日本" },
    { code: "sg", label: "新加坡" }
  ]);
  const switcher = proxy.buildRegionNav(
    [
      { code: "jp", label: '日本"><script>alert(1)</script>' },
      { code: "sg", label: "新加坡" }
    ],
    "jp"
  );
  assert.match(switcher, /data-current="jp"/);
  assert.match(switcher, /&quot;&gt;&lt;script&gt;/);
  assert.equal(switcher.includes("<script>alert"), false);
  assert.equal(proxy.buildRegionNav([{ code: "jp", label: "日本" }], "jp"), "");
});

test("keeps the region switcher active after client-side route changes", () => {
  const html = '<html><head></head><body><div id="root"></div></body></html>';
  const rewritten = proxy.rewriteHtml(html);
  assert.equal((rewritten.match(/id="codex-region-nav"/g) || []).length, 1);
  assert.match(rewritten, /src="\/ca\/region-nav\.js"/);
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
  assert.equal(proxy.rewriteRequestCookie("codex_web_session_ca=abc"), "codex_web_session=abc");
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

test("appends the proxy peer to X-Forwarded-For", () => {
  assert.equal(proxy.appendForwardedFor(undefined, "::ffff:203.0.113.8"), "203.0.113.8");
  assert.equal(proxy.appendForwardedFor("1.1.1.1", "203.0.113.8"), "1.1.1.1, 203.0.113.8");
  assert.equal(proxy.appendForwardedFor("203.0.113.8", "203.0.113.8"), "203.0.113.8");
  assert.equal(proxy.appendForwardedFor("1.1.1.1", ""), "1.1.1.1");
});
