import http from "node:http";
import https from "node:https";
import { pathToFileURL } from "node:url";

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
  if (/;\s*path=\/(?:;|$)/i.test(next)) return next.replace(/;\s*path=\/(?=;|$)/i, `; Path=${prefix}`);
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
  const attributes = new RegExp(
    `(\\s(?:href|src|action)=(["']))\\/(?!\\/|${segmentPattern}\\/)`,
    "gi"
  );
  // Do not add a cache-busting query to the entry module. Lazy chunks import
  // that file by its plain URL, and a different query creates a second React.
  return html.replace(attributes, `$1${prefix}/`);
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

function upstreamHeaders(incoming, extra) {
  const headers = stripHopHeaders(incoming);
  headers.host = upstreamName;
  headers["x-forwarded-host"] = publicHost;
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-prefix"] = prefix;
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
  const upstreamReq = transport.request(
    {
      host: upstreamHost,
      port: upstreamPort,
      servername: useTls ? upstreamName : undefined,
      method: req.method,
      path: upstreamPath,
      headers: upstreamHeaders(req.headers),
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
    headers: upstreamHeaders(req.headers, {
      connection: "upgrade",
      upgrade: req.headers.upgrade || "websocket"
    }),
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
