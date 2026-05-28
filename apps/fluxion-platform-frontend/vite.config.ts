import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The API origin the app connects to comes from VITE_APPSYNC_URL — injected
// into the CSP connect-src at build/serve time so no concrete endpoint is
// hardcoded in source. Falls back to the AppSync regional wildcard, which
// already covers a default (non-custom-domain) deployment.
function apiConnectSrc(mode: string): string {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const region = env.VITE_AWS_REGION || "ap-southeast-1";
  const origins = [
    `https://*.appsync-api.${region}.amazonaws.com`,
    // Real-time subscriptions open a WebSocket to the AppSync realtime host
    // (distinct from the appsync-api host) — required for the GraphQL push link.
    `wss://*.appsync-realtime-api.${region}.amazonaws.com`,
    `https://cognito-idp.${region}.amazonaws.com`,
  ];
  try {
    const u = new URL(env.VITE_APPSYNC_URL);
    origins.unshift(u.origin);
    // Custom-domain case: the realtime WebSocket rides the same host over wss.
    origins.unshift(`wss://${u.host}`);
  } catch {
    /* no custom URL — wildcards above suffice */
  }
  return origins.join(" ");
}

function csp(mode: string, dev: boolean): string {
  const connect = `'self' ${dev ? "ws://localhost:* " : ""}${apiConnectSrc(mode)}`;
  const script = dev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'";
  const style = dev ? "'self' 'unsafe-inline'" : "'self'";
  const tail = dev
    ? ""
    : " frame-ancestors 'none'; base-uri 'self'; form-action 'self';";
  return (
    `default-src 'self'; script-src ${script}; style-src ${style}; ` +
    `connect-src ${connect}; img-src 'self' data:; font-src 'self' data:;${tail}`
  );
}

// Rewrites the placeholder CSP in index.html with the env-derived policy.
// Dev (`vite serve`) needs inline/eval for HMR; production stays strict.
function injectCsp(mode: string): Plugin {
  return {
    name: "fluxion-csp",
    transformIndexHtml(html) {
      const dev = process.env.NODE_ENV !== "production";
      return html.replace(
        /<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/,
        `<meta http-equiv="Content-Security-Policy" content="${csp(mode, dev)}" />`,
      );
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), injectCsp(mode)],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // amazon-cognito-identity-js ships a CommonJS bundle that references the
  // Node-only `global` identifier (via its `buffer` polyfill). In the
  // browser there's no `global`, so the module throws at import time and
  // the entire React tree fails to mount. Build-time replacement is the
  // standard Vite fix — much safer than re-adding an inline polyfill script
  // (which would conflict with our strict prod CSP).
  define: {
    global: "globalThis",
  },
  server: { port: 5173, strictPort: false },
}));
