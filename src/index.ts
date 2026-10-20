#!/usr/bin/env node

/**
 * @tradewink/mcp — MCP stdio-to-HTTP bridge for the Tradewink trading platform.
 *
 * Runs as a local stdio MCP server and proxies every tool/resource call to the
 * remote Tradewink MCP server over Streamable HTTP.
 *
 * Two auth modes, in order of preference:
 *   1. OAuth 2.1 (default)          — on first run, opens a browser to
 *      https://tradewink.com/mcp/authorize, completes PKCE + code exchange,
 *      caches tokens at ~/.tradewink/mcp/<host>.json, auto-refreshes.
 *   2. TRADEWINK_API_KEY=tw_…        — falls back to a manual API key if set
 *      (useful for headless CI / sandboxes with no browser).
 *
 * Usage:
 *   npx @tradewink/mcp                                  # OAuth flow
 *   TRADEWINK_API_KEY=tw_xxx npx @tradewink/mcp         # API key fallback
 *   npx @tradewink/mcp --endpoint https://...           # custom endpoint
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
  type Resource,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const DEFAULT_ENDPOINT = "https://tradewink-mcp.fly.dev/mcp";
const CLIENT_NAME = "Tradewink MCP Bridge";

interface Config {
  endpoint: string;
  apiKey: string | null;
}

function loadConfig(): Config {
  let endpoint = DEFAULT_ENDPOINT;
  const endpointIdx = process.argv.indexOf("--endpoint");
  if (endpointIdx !== -1 && process.argv[endpointIdx + 1]) {
    endpoint = process.argv[endpointIdx + 1];
  }
  endpoint = process.env.TRADEWINK_ENDPOINT ?? endpoint;

  const apiKey = process.env.TRADEWINK_API_KEY || null;
  if (apiKey && !apiKey.startsWith("tw_")) {
    console.error(
      'Error: Invalid TRADEWINK_API_KEY format. Keys start with "tw_".',
    );
    process.exit(1);
  }
  return { endpoint, apiKey };
}

// ---------------------------------------------------------------------------
// Disk-backed OAuth client provider
// ---------------------------------------------------------------------------

interface SessionState {
  clientInformation?: OAuthClientInformationFull;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  redirectUri?: string;
}

function sessionFilePath(endpoint: string): string {
  const host = new URL(endpoint).host.replace(/[^a-z0-9._-]/gi, "_");
  const dir = join(homedir(), ".tradewink", "mcp");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, `${host}.json`);
}

function loadSession(path: string): SessionState {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SessionState;
  } catch {
    return {};
  }
}

function saveSession(path: string, state: SessionState): void {
  writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    // Best-effort — we always print the URL too.
  }
}

class TradewinkOAuthProvider implements OAuthClientProvider {
  private sessionPath: string;
  private session: SessionState;
  private _redirectUri: string;
  private pendingCode: Promise<string> | null = null;

  constructor(endpoint: string) {
    this.sessionPath = sessionFilePath(endpoint);
    this.session = loadSession(this.sessionPath);
    this._redirectUri =
      this.session.redirectUri || "http://127.0.0.1:33418/callback";
    if (!this.session.redirectUri) {
      this.session.redirectUri = this._redirectUri;
      this.flush();
    }
  }

  private flush() {
    saveSession(this.sessionPath, this.session);
  }

  get redirectUrl(): string {
    return this._redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: CLIENT_NAME,
      redirect_uris: [this._redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp",
    };
  }

  clientInformation(): OAuthClientInformation | undefined {
    return this.session.clientInformation;
  }

  saveClientInformation(info: OAuthClientInformationFull): void {
    this.session.clientInformation = info;
    this.flush();
  }

  tokens(): OAuthTokens | undefined {
    return this.session.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.session.tokens = tokens;
    this.flush();
  }

  saveCodeVerifier(verifier: string): void {
    this.session.codeVerifier = verifier;
    this.flush();
  }

  codeVerifier(): string {
    if (!this.session.codeVerifier) {
      throw new Error("No PKCE code verifier cached — restart sign-in");
    }
    return this.session.codeVerifier;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Spawn a one-shot loopback server on the fixed redirect port, open the
    // browser to the authorize URL, and wait for the OAuth callback.
    const redirect = new URL(this._redirectUri);
    const port = Number(redirect.port) || 33418;

    this.pendingCode = new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        if (!req.url) {
          res.writeHead(400).end("bad request");
          return;
        }
        const u = new URL(req.url, this._redirectUri);
        if (u.pathname !== redirect.pathname) {
          res.writeHead(404).end();
          return;
        }
        // KAV-245: reject callbacks whose `state` doesn't match the value we
        // sent on the authorize URL (CSRF / code-injection protection).
        const expectedState = authorizationUrl.searchParams.get("state");
        const gotState = u.searchParams.get("state");
        if (!expectedState || !gotState || !safeEqual(gotState, expectedState)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("OAuth state mismatch. Close this window and retry sign-in.");
          return;
        }
        const code = u.searchParams.get("code");
        const err = u.searchParams.get("error");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        if (err) {
          res.end(
            `<!doctype html><meta charset=utf-8><title>Tradewink MCP</title><body style="font-family:system-ui;padding:2rem;background:#0b0e1a;color:#fafafa"><h1>Authorization failed</h1><p>${escapeHtml(err)}</p></body>`,
          );
          server.close();
          reject(new Error(`OAuth error: ${err}`));
          return;
        }
        if (!code) {
          res.end("<p>Missing code</p>");
          return;
        }
        res.end(
          `<!doctype html><meta charset=utf-8><title>Tradewink MCP</title><body style="font-family:system-ui;padding:2rem;background:#0b0e1a;color:#fafafa"><h1>Connected</h1><p>You can close this window and return to your MCP client.</p><script>window.close()</script></body>`,
        );
        server.close();
        resolve(code);
      });
      server.on("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const urlStr = authorizationUrl.toString();
        console.error(
          `\nOpening browser to authorize Tradewink MCP…\n  ${urlStr}\n`,
        );
        openBrowser(urlStr);
      });
      // 15-minute timeout — long enough to create a Tradewink account
      // mid-flow without the loopback port going dead under the user.
      setTimeout(
        () => {
          server.close();
          reject(
            new Error(
              `OAuth callback timed out after 15 minutes. Re-run to get a fresh authorize URL:\n  ${authorizationUrl.toString()}`,
            ),
          );
        },
        15 * 60 * 1000,
      ).unref();
    });
  }

  async waitForCode(): Promise<string> {
    if (!this.pendingCode) {
      throw new Error("No pending authorization flow");
    }
    const code = await this.pendingCode;
    this.pendingCode = null;
    return code;
  }

  state(): string {
    return randomBytes(16).toString("base64url");
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

// ---------------------------------------------------------------------------
// Remote MCP client (HTTP connection to Tradewink)
// ---------------------------------------------------------------------------

async function createRemoteClient(config: Config): Promise<Client> {
  const client = new Client(
    { name: "tradewink-mcp-bridge", version: "0.3.0" },
    { capabilities: {} },
  );

  if (config.apiKey) {
    // Legacy path — plain bearer header, no OAuth.
    const transport = new StreamableHTTPClientTransport(
      new URL(config.endpoint),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        },
      },
    );
    await client.connect(transport);
    return client;
  }

  // OAuth 2.1 flow. The SDK will:
  //  - Read tokens from the provider and try them first
  //  - Refresh with refresh_token if access is expired
  //  - Fall back to redirectToAuthorization() for a full sign-in
  const provider = new TradewinkOAuthProvider(config.endpoint);
  const transport = new StreamableHTTPClientTransport(
    new URL(config.endpoint),
    { authProvider: provider },
  );

  try {
    await client.connect(transport);
    return client;
  } catch (err) {
    // The SDK throws UnauthorizedError when it needs an interactive flow. We
    // wait for the loopback callback and finish the exchange, then retry.
    const name = err instanceof Error ? err.name : "";
    if (name !== "UnauthorizedError") throw err;

    const code = await provider.waitForCode();
    await transport.finishAuth(code);

    // Re-connect with fresh tokens
    const retryTransport = new StreamableHTTPClientTransport(
      new URL(config.endpoint),
      { authProvider: provider },
    );
    await client.connect(retryTransport);
    return client;
  }
}

// ---------------------------------------------------------------------------
// Local MCP server (stdio, exposed to the user's LLM client)
// ---------------------------------------------------------------------------

async function main() {
  const config = loadConfig();

  let remote: Client;
  try {
    remote = await createRemoteClient(config);
  } catch (err) {
    console.error(
      `Failed to connect to Tradewink MCP server at ${config.endpoint}:`,
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }

  const [remoteTools, remoteResources] = await Promise.all([
    remote.listTools().catch(() => ({ tools: [] as Tool[] })),
    remote.listResources().catch(() => ({ resources: [] as Resource[] })),
  ]);

  const server = new Server(
    { name: "tradewink", version: "0.3.0" },
    {
      capabilities: {
        tools: remoteTools.tools.length > 0 ? {} : undefined,
        resources: remoteResources.resources.length > 0 ? {} : undefined,
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await remote.listTools();
    return { tools: result.tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await remote.callTool({
      name: request.params.name,
      arguments: request.params.arguments,
    });
    return result;
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const result = await remote.listResources();
    return { resources: result.resources };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const result = await remote.readResource({ uri: request.params.uri });
    return result;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await server.close();
    await remote.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[2] === "setup") {
  import("./setup.js");
} else {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
