import { createReadStream, promises as fsPromises } from "node:fs";
import { createServer } from "node:http";
import { hostname as getHostname } from "node:os";
import { resolve, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "node:url";
import mime from "mime-types";
import next from "next";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const argv = new Set(process.argv.slice(2));
const devFlag = argv.has("--dev");
const prodFlag = argv.has("--prod");
const dev = prodFlag ? false : devFlag ? true : process.env.NODE_ENV !== "production";
process.env.NODE_ENV = dev ? "development" : "production";

const port = Number.parseInt(process.env.PORT ?? (dev ? "3000" : "3000"), 10);
const host = process.env.HOST ?? "0.0.0.0";

logging.set_level(logging.NONE);
Object.assign(wisp.options, {
  allow_udp_streams: false,
  hostname_blacklist: [/example\.com/],
  dns_servers: ["1.1.1.3", "1.0.0.3"],
});

const rootDir = resolve(fileURLToPath(new URL("./", import.meta.url)));
const publicDir = join(rootDir, "public");
const SCRAMJET_PROXY_PREFIX = "/scramjet/";
const scramjetUiDir = join(publicDir, "scramjet");

const nextApp = next({ dev, dir: rootDir });
const handle = nextApp.getRequestHandler();

await nextApp.prepare();

const server = createServer(async (req, res) => {
  const originalUrl = req.url ?? "/";
  const parsedUrl = parse(originalUrl, true);
  const pathname = parsedUrl.pathname ?? "/";

  try {
    if (pathname === "/scramjet") {
      res.statusCode = 308;
      res.setHeader("Location", SCRAMJET_PROXY_PREFIX);
      res.end();
      return;
    }

    if (pathname.startsWith(SCRAMJET_PROXY_PREFIX)) {
      const relativePath = pathname.slice(SCRAMJET_PROXY_PREFIX.length);
      if (await serveScramjetUi(res, relativePath)) {
        return;
      }
      await serveProxyResource(res, relativePath);
      return;
    }

    if (pathname.startsWith("/scram/")) {
      setCrossOriginIsolation(res);
      const relativePath = pathname.slice("/scram/".length);
      if (await serveStatic(res, scramjetPath, relativePath)) {
        return;
      }
    }

    if (pathname.startsWith("/epoxy/")) {
      setCrossOriginIsolation(res);
      const relativePath = pathname.slice("/epoxy/".length);
      if (await serveStatic(res, epoxyPath, relativePath)) {
        return;
      }
    }

    if (pathname.startsWith("/baremux/")) {
      setCrossOriginIsolation(res);
      const relativePath = pathname.slice("/baremux/".length);
      if (await serveStatic(res, baremuxPath, relativePath)) {
        return;
      }
    }

    await handle(req, res, parsedUrl);
  } catch (error) {
    console.error("Error handling request", { url: originalUrl, error });
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    res.end("Internal Server Error");
  }
});

server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/wisp/")) {
    wisp.routeRequest(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(port, host, () => {
  const address = server.address();
  const resolved = typeof address === "string" ? { address, family: "", port } : address;
  console.log(`Server ready on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  if (resolved && typeof resolved !== "string") {
    console.log("Listening on:");
    console.log(`\thttp://localhost:${resolved.port}`);
    console.log(`\thttp://${getHostname()}:${resolved.port}`);
    console.log(`\thttp://${resolved.family === "IPv6" ? `[${resolved.address}]` : resolved.address}:${resolved.port}`);
  }
});

async function serveScramjetUi(res, relativePath) {
  setCrossOriginIsolation(res);
  const normalized = relativePath?.length ? relativePath : "index.html";
  const headers = {};

  if (normalized === "sw.js") {
    headers["Service-Worker-Allowed"] = "/scramjet/";
  }

  if (normalized === "index.html" || normalized.endsWith(".html")) {
    headers["Cache-Control"] = dev ? "no-store" : "public, max-age=120";
  }

  return serveStatic(res, scramjetUiDir, normalized, { headers });
}

async function serveProxyResource(res, relativePath) {
  setCrossOriginIsolation(res);
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(`Scramjet resource not found: ${relativePath ?? ""}`);
}

function setCrossOriginIsolation(res) {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
}

async function serveStatic(res, baseDir, requestPath, options = {}) {
  const { headers = {} } = options;
  const sanitized = sanitizePath(requestPath);
  if (sanitized == null) {
    return false;
  }

  let targetPath = resolve(baseDir, sanitized);
  if (!targetPath.startsWith(resolve(baseDir))) {
    return false;
  }

  try {
    let stats = await fsPromises.stat(targetPath);
    if (stats.isDirectory()) {
      targetPath = join(targetPath, "index.html");
      stats = await fsPromises.stat(targetPath);
    }

    const stream = createReadStream(targetPath);
    const contentType = mime.lookup(targetPath) || "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    if (!("Cache-Control" in headers)) {
      res.setHeader("Cache-Control", dev ? "no-store" : "public, max-age=86400");
    }

    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }
    await new Promise((resolveStream, rejectStream) => {
      stream.on("error", rejectStream);
      stream.on("end", resolveStream);
      stream.on("close", resolveStream);
      stream.pipe(res);
    });
    return true;
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      console.error("Failed to serve static file", { baseDir, requestPath, error });
    }
    return false;
  }
}

function sanitizePath(pathname) {
  const decoded = decodeURI(pathname).split("?")[0].split("#")[0];
  const normalized = posix.normalize(decoded).replace(/^\/+/, "");
  if (normalized.includes("..")) {
    return null;
  }
  return normalized;
}
