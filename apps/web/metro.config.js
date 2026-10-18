const { getDefaultConfig } = require("expo/metro-config");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { URL } = require("node:url");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const API_PROXY = process.env.RECLINARR_API_PROXY || process.env.STREAMERR_API_PROXY || "http://127.0.0.1:8787";

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.extraNodeModules = {
  "@reclinarr/client": path.resolve(workspaceRoot, "packages/client"),
  "@reclinarr/native-ui": path.resolve(workspaceRoot, "packages/native-ui"),
  "@reclinarr/player-web": path.resolve(workspaceRoot, "packages/player-web"),
  "@reclinarr/shared": path.resolve(workspaceRoot, "packages/shared"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
  "react-native-web": path.resolve(projectRoot, "node_modules/react-native-web"),
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    for (const ext of [".ts", ".tsx"]) {
      try {
        return context.resolveRequest(context, moduleName.replace(/\.js$/, ext), platform);
      } catch {
        // try next
      }
    }
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

/** Proxy /api/* to the Reclinarr API so Expo web can use same-origin fetch. */
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      const url = req.url || "";
      if (!url.startsWith("/api")) {
        return middleware(req, res, next);
      }
      const target = new URL(url, API_PROXY);
      const lib = target.protocol === "https:" ? https : http;
      const headers = { ...req.headers, host: target.host };
      // Avoid compression surprises on live MPEG-TS.
      if (url.includes("/playback/dispatcharr/live/")) {
        headers["accept-encoding"] = "identity";
      }
      const proxyReq = lib.request(
        target,
        { method: req.method, headers },
        (proxyRes) => {
          const outHeaders = { ...proxyRes.headers };
          if (url.includes("/playback/dispatcharr/live/")) {
            outHeaders["cache-control"] = "no-store, no-transform";
            outHeaders["x-accel-buffering"] = "no";
            delete outHeaders["content-length"];
          }
          res.writeHead(proxyRes.statusCode || 502, outHeaders);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on("error", (err) => {
        res.statusCode = 502;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: `API proxy failed: ${err.message}` }));
      });
      req.pipe(proxyReq);
    };
  },
};

module.exports = config;
