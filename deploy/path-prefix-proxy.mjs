import http from "node:http";
import https from "node:https";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const prefix = normalizePrefix(process.env.PREFIX || "");
const listenHost = process.env.LISTEN_HOST || "127.0.0.1";
const listenPort = Number(process.env.LISTEN_PORT || 8792);
const upstreamHost = process.env.UPSTREAM_HOST || "127.0.0.1";
const upstreamPort = Number(process.env.UPSTREAM_PORT || 8791);
const upstreamName = process.env.UPSTREAM_NAME || upstreamHost;
const publicHost = process.env.PUBLIC_HOST || upstreamName;
const useTls = process.env.UPSTREAM_TLS
  ? !["0", "false", "no"].includes(process.env.UPSTREAM_TLS.toLowerCase())
  : upstreamPort === 443;
const transport = useTls ? https : http;
const segment = prefix.slice(1);
const segmentPattern = escapeRegExp(segment);
const prefixPattern = escapeRegExp(prefix);
const REGION_CODE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_REGIONS = 8;
const regionNavDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "region-nav");
const regionNavIconDir = process.env.REGION_NAV_ICON_DIR
  ? path.resolve(process.env.REGION_NAV_ICON_DIR)
  : path.join(regionNavDir, "icons");
const regionNav = parseRegionNav(
  process.env.REGION_NAV === undefined ? "us:美国,ca:加拿大" : process.env.REGION_NAV
);
const REGION_NAV_ASSETS = new Map([
  ["/region-nav.css", { file: "region-nav.css", type: "text/css; charset=utf-8" }],
  ["/region-nav.js", { file: "region-nav.js", type: "text/javascript; charset=utf-8" }]
]);

const upstreamAgent = useTls
  ? new https.Agent({ keepAlive: true, servername: upstreamName })
  : new http.Agent({ keepAlive: true });

function normalizePrefix(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") {
    throw new Error("PREFIX must be a path such as /ca");
  }
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+$/, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

export function parseRegionNav(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  const regions = [];
  for (const entry of value.split(/[,\n]/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    const code = (separator < 0 ? trimmed : trimmed.slice(0, separator)).trim().toLowerCase();
    if (!REGION_CODE.test(code) || regions.some((region) => region.code === code)) continue;
    const label = (separator < 0 ? "" : trimmed.slice(separator + 1)).trim();
    regions.push({ code, label: label || code.toUpperCase() });
    if (regions.length >= MAX_REGIONS) break;
  }
  return regions;
}

export function buildRegionNav(regions, current, prefixValue = prefix) {
  if (!Array.isArray(regions) || regions.length < 2) return "";
  const safeRegions = regions
    .filter((region) => REGION_CODE.test(region.code) && typeof region.label === "string")
    .slice(0, MAX_REGIONS);
  if (safeRegions.length < 2 || !safeRegions.some((region) => region.code === current)) return "";
  const payload = escapeHtml(
    JSON.stringify(safeRegions.map(({ code, label }) => ({ code, label })))
  );
  const links = safeRegions
    .map(
      (region) =>
        `<a href="/${region.code}/"${region.code === current ? ' aria-current="page"' : ""} aria-label="前往${escapeHtml(region.label)}站点" title="前往${escapeHtml(region.label)}站点 /${region.code}"><img src="${escapeHtml(prefixValue)}/region-nav/icons/${region.code}.svg" alt="" aria-hidden="true"><span>${region.code.toUpperCase()}</span></a>`
    )
    .join("");
  return `<nav id="codex-region-nav" data-codex-region-nav data-current="${current}" data-regions="${payload}" aria-label="地区切换">${links}</nav>`;
}

export function stripPrefix(url) {
  const parsed = new URL(url, "http://local");
  const path = parsed.pathname;
  let stripped = path;
  if (path === prefix || path === `${prefix}/`) stripped = "/";
  else if (path.startsWith(`${prefix}/`)) stripped = path.slice(prefix.length);
  return `${stripped}${parsed.search}`;
}

const cookieName = "codex_web_session";
const publicCookieName = `${cookieName}_${segment.replace(/[^a-zA-Z0-9]+/g, "_")}`;

export function rewriteRequestCookie(value) {
  return value.replace(new RegExp(`(^|;\\s*)${publicCookieName}=`, "g"), `$1${cookieName}=`);
}

export function rewriteSetCookie(value) {
  let next = value.replace(new RegExp(`(^|;\\s*)${cookieName}=`, "i"), `$1${publicCookieName}=`);
  if (new RegExp(`;\\s*path=${prefixPattern}(?:;|$)`, "i").test(next)) return next;
  if (/;\s*path=\/(?:;|$)/i.test(next))
    return next.replace(/;\s*path=\/(?=;|$)/i, `; Path=${prefix}`);
  return `${next}; Path=${prefix}`;
}

export function rewriteLocation(value) {
  if (value === prefix || value.startsWith(`${prefix}/`)) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return `${prefix}${value}`;
  try {
    const url = new URL(value);
    if (url.host === publicHost || url.host === upstreamName) {
      if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
        url.pathname = `${prefix}${url.pathname.startsWith("/") ? url.pathname : `/${url.pathname}`}`;
      }
      return url.toString();
    }
  } catch {
    // Keep values that are not absolute URLs.
  }
  return value;
}

export function rewriteJavascript(code) {
  const apiPattern = new RegExp(`(?<!${prefixPattern})\\/api(?=\\/|["'\`?#]|$)`, "g");
  let next = code.replace(apiPattern, `${prefix}/api`);
  const preloadBase =
    /("modulepreload"\s*,\s*[A-Za-z_$][\w$]*\s*=\s*)(?:function\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*return\s*"\/"\s*\+\s*\2\s*;?\s*\}|\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*"\/"\s*\+\s*\3)/g;
  next = next.replace(preloadBase, (_match, lead, fnArg, arrowArg) => {
    const arg = fnArg || arrowArg;
    return `${lead}function(${arg}){return${JSON.stringify(`${prefix}/`)}+${arg}}`;
  });
  const router = next.match(
    /function (\w+)\(\{basename:\w+,children:\w+,useTransitions:\w+,window:\w+\}\)/
  );
  if (!router) return next;
  const call = new RegExp(`((?:jsx|jsxs)\\(${router[1]},\\{)(?!basename:)`, "g");
  return next.replace(call, `$1basename:"${prefix}",`);
}

export function rewriteHtml(html) {
  if (html.includes("data-codex-region-nav")) return html;
  const attributes = new RegExp(
    `(\\s(?:href|src|action)=(["']))\\/(?!\\/|${segmentPattern}\\/|region-nav\\/)`,
    "gi"
  );
  // Do not add a cache-busting query to the entry module. Lazy chunks import
  // that file by its plain URL, and a different query creates a second React.
  const rewritten = html.replace(attributes, `$1${prefix}/`);
  if (!/<body[\s>]/i.test(rewritten)) return rewritten;
  const switcher = buildRegionNav(regionNav, segment);
  if (!switcher) return rewritten;
  // Keep the application build untouched. The edge proxy adds a standalone
  // switcher outside the React root, so it survives client-side navigation.
  return rewritten
    .replace(
      /<\/head\s*>/i,
      `<link rel="stylesheet" href="${prefix}/region-nav.css"><script src="${prefix}/region-nav.js" defer></script></head>`
    )
    .replace(/(<body\b[^>]*>)/i, `$1${switcher}`);
}

export function rewriteCss(css) {
  const urls = new RegExp(`url\\((["']?)\\/(?!\\/|${segmentPattern}\\/)`, "g");
  return css.replace(urls, `url($1${prefix}/`);
}

export function rewriteManifest(text) {
  const src = new RegExp(`"src"\\s*:\\s*"\\/(?!${segmentPattern}\\/)`, "g");
  return text
    .replace(/"start_url"\s*:\s*"\/"/, `"start_url": "${prefix}/"`)
    .replace(/"scope"\s*:\s*"\/"/, `"scope": "${prefix}/"`)
    .replace(src, `"src": "${prefix}/`);
}

function shouldRewrite(upstreamPath, contentType) {
  const path = upstreamPath.split("?")[0];
  if (path.startsWith("/api")) return "";
  const type = (contentType || "").toLowerCase();
  if (type.includes("text/html")) return "html";
  if (path.endsWith(".css") || type.includes("text/css")) return "css";
  if (path.endsWith(".webmanifest") || type.includes("manifest")) return "manifest";
  if (
    path.startsWith("/assets/") &&
    (path.endsWith(".js") || type.includes("javascript") || type.includes("ecmascript"))
  ) {
    return "js";
  }
  return "";
}

function stripHopHeaders(headers) {
  const next = { ...headers };
  for (const name of [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "accept-encoding"
  ]) {
    delete next[name];
  }
  return next;
}

export function appendForwardedFor(existing, remoteAddress) {
  const peer = normalizeForwardedPeer(remoteAddress);
  if (!peer) return existing;
  const prior = Array.isArray(existing)
    ? existing
        .map((item) => String(item).trim())
        .filter(Boolean)
        .join(", ")
    : String(existing ?? "").trim();
  if (!prior) return peer;
  const parts = prior
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts[parts.length - 1] === peer) return prior;
  return `${prior}, ${peer}`;
}

function normalizeForwardedPeer(remoteAddress) {
  if (remoteAddress == null) return "";
  const value = String(remoteAddress).trim();
  if (!value || value.toLowerCase() === "unknown") return "";
  return value.replace(/^::ffff:/i, "");
}

function upstreamHeaders(incoming, extra, remoteAddress) {
  const headers = stripHopHeaders(incoming);
  headers.host = upstreamName;
  headers["x-forwarded-host"] = publicHost;
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-prefix"] = prefix;
  const forwarded = appendForwardedFor(headers["x-forwarded-for"], remoteAddress);
  if (forwarded) headers["x-forwarded-for"] = forwarded;
  if (headers.cookie) headers.cookie = rewriteRequestCookie(String(headers.cookie));
  if (extra) Object.assign(headers, extra);
  return headers;
}

function sendRewritten(clientRes, upstreamRes, body) {
  const headers = { ...upstreamRes.headers };
  delete headers["content-length"];
  delete headers["content-encoding"];
  delete headers["transfer-encoding"];
  if (headers.location) {
    const location = headers.location;
    headers.location = Array.isArray(location)
      ? location.map(rewriteLocation)
      : rewriteLocation(String(location));
  }
  if (headers["set-cookie"]) {
    const cookies = Array.isArray(headers["set-cookie"])
      ? headers["set-cookie"]
      : [headers["set-cookie"]];
    headers["set-cookie"] = cookies.map(rewriteSetCookie);
  }
  headers["content-length"] = Buffer.byteLength(body);
  clientRes.writeHead(upstreamRes.statusCode || 502, headers);
  clientRes.end(body);
}

function proxyHttp(req, clientRes) {
  const upstreamPath = stripPrefix(req.url || "/");
  const navPath = upstreamPath.split("?")[0];
  const navAsset = REGION_NAV_ASSETS.get(navPath);
  if (navAsset && req.method === "GET") {
    readFile(path.join(regionNavDir, navAsset.file)).then(
      (body) => {
        clientRes.writeHead(200, {
          "content-type": navAsset.type,
          "cache-control": "no-cache",
          "content-length": body.byteLength
        });
        clientRes.end(body);
      },
      () => {
        clientRes.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        clientRes.end("Not Found");
      }
    );
    return;
  }
  const icon = navPath.match(/^\/region-nav\/icons\/([a-z0-9][a-z0-9_-]{0,31})\.svg$/);
  if (icon && req.method === "GET") {
    if (!regionNav.some((region) => region.code === icon[1])) {
      clientRes.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      clientRes.end("Not Found");
      return;
    }
    readFile(path.join(regionNavIconDir, `${icon[1]}.svg`)).then(
      (body) => {
        clientRes.writeHead(200, {
          "content-type": "image/svg+xml",
          "cache-control": "no-cache",
          "content-length": body.byteLength
        });
        clientRes.end(body);
      },
      () => {
        clientRes.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        clientRes.end("Not Found");
      }
    );
    return;
  }
  const upstreamReq = transport.request(
    {
      host: upstreamHost,
      port: upstreamPort,
      servername: useTls ? upstreamName : undefined,
      method: req.method,
      path: upstreamPath,
      headers: upstreamHeaders(req.headers, undefined, req.socket?.remoteAddress),
      agent: upstreamAgent
    },
    (upstreamRes) => {
      const kind = shouldRewrite(upstreamPath, upstreamRes.headers["content-type"]);
      if (!kind) {
        const headers = { ...upstreamRes.headers };
        if (headers.location) {
          const location = headers.location;
          headers.location = Array.isArray(location)
            ? location.map(rewriteLocation)
            : rewriteLocation(String(location));
        }
        if (headers["set-cookie"]) {
          const cookies = Array.isArray(headers["set-cookie"])
            ? headers["set-cookie"]
            : [headers["set-cookie"]];
          headers["set-cookie"] = cookies.map(rewriteSetCookie);
        }
        clientRes.writeHead(upstreamRes.statusCode || 502, headers);
        upstreamRes.pipe(clientRes);
        return;
      }
      const chunks = [];
      upstreamRes.on("data", (chunk) => chunks.push(chunk));
      upstreamRes.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const rewritten =
          kind === "html"
            ? rewriteHtml(text)
            : kind === "css"
              ? rewriteCss(text)
              : kind === "manifest"
                ? rewriteManifest(text)
                : rewriteJavascript(text);
        sendRewritten(clientRes, upstreamRes, rewritten);
      });
    }
  );
  upstreamReq.on("error", (error) => {
    if (!clientRes.headersSent) clientRes.writeHead(502, { "content-type": "text/plain" });
    clientRes.end(error.message);
  });
  req.pipe(upstreamReq);
}

function proxyUpgrade(req, socket, head) {
  const upstreamPath = stripPrefix(req.url || "/");
  const upstreamReq = transport.request({
    host: upstreamHost,
    port: upstreamPort,
    servername: useTls ? upstreamName : undefined,
    method: req.method,
    path: upstreamPath,
    headers: upstreamHeaders(
      req.headers,
      {
        connection: "upgrade",
        upgrade: req.headers.upgrade || "websocket"
      },
      req.socket?.remoteAddress
    ),
    agent: upstreamAgent
  });
  upstreamReq.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    const lines = [
      `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage || "Switching Protocols"}`
    ];
    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      if (value == null) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) lines.push(`${key}: ${item}`);
    }
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (upstreamHead?.length) socket.write(upstreamHead);
    if (head?.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
    const closeBoth = () => {
      upstreamSocket.destroy();
      socket.destroy();
    };
    upstreamSocket.on("error", closeBoth);
    socket.on("error", closeBoth);
    upstreamSocket.on("close", () => socket.end());
    socket.on("close", () => upstreamSocket.end());
  });
  upstreamReq.on("error", () => socket.destroy());
  upstreamReq.on("response", (upstreamRes) => {
    socket.write(
      `HTTP/1.1 ${upstreamRes.statusCode || 502} ${upstreamRes.statusMessage || "Bad Gateway"}\r\n\r\n`
    );
    upstreamRes.pipe(socket);
  });
  upstreamReq.end();
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const server = http.createServer(proxyHttp);
  server.on("upgrade", proxyUpgrade);
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.listen(listenPort, listenHost, () => {
    console.log(`prefix proxy ${prefix} listening on http://${listenHost}:${listenPort}`);
  });
}
