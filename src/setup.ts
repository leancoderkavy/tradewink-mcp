#!/usr/bin/env node

/**
 * @tradewink/mcp setup — Auto-configure Tradewink MCP in your IDE/LLM client.
 *
 * Usage:
 *   npx @tradewink/mcp setup
 *   tradewink-mcp-setup
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function green(s: string) {
  return `\x1b[32m${s}\x1b[0m`;
}
function yellow(s: string) {
  return `\x1b[33m${s}\x1b[0m`;
}
function red(s: string) {
  return `\x1b[31m${s}\x1b[0m`;
}
function dim(s: string) {
  return `\x1b[2m${s}\x1b[0m`;
}
function bold(s: string) {
  return `\x1b[1m${s}\x1b[0m`;
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// MCP config snippet
// ---------------------------------------------------------------------------

function mcpServerConfig(apiKey: string | null) {
  const config: {
    command: string;
    args: string[];
    env?: Record<string, string>;
  } = {
    command: "npx",
    args: ["-y", "@tradewink/mcp"],
  };
  if (apiKey) {
    config.env = { TRADEWINK_API_KEY: apiKey };
  }
  return config;
}

// ---------------------------------------------------------------------------
// Client installers
// ---------------------------------------------------------------------------

interface Client {
  name: string;
  detect: () => boolean;
  install: (apiKey: string | null) => boolean; // returns true if installed
}

function mergeJsonConfig(
  filePath: string,
  serverKey: string,
  serversPath: string[],
  apiKey: string | null,
): boolean {
  let config: Record<string, unknown> = {};

  if (existsSync(filePath)) {
    try {
      config = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      console.log(red(`  Could not parse ${filePath} — skipping`));
      return false;
    }
  }

  // Navigate to the servers object, creating intermediate keys
  let current: Record<string, unknown> = config;
  for (const key of serversPath) {
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  if (current[serverKey]) {
    console.log(yellow(`  Already configured in ${filePath}`));
    return true;
  }

  current[serverKey] = mcpServerConfig(apiKey);

  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n");
  console.log(green(`  Configured in ${filePath}`));
  return true;
}

const clients: Client[] = [
  {
    name: "Claude Code",
    detect: () => commandExists("claude"),
    install: (apiKey) => {
      try {
        const envFlag = apiKey ? `-e TRADEWINK_API_KEY=${apiKey} ` : "";
        execSync(
          `claude mcp add tradewink ${envFlag}-- npx -y @tradewink/mcp`,
          { stdio: "ignore" },
        );
        console.log(green("  Added via: claude mcp add tradewink"));
        return true;
      } catch {
        console.log(red("  Failed to run claude mcp add — add manually"));
        return false;
      }
    },
  },
  {
    name: "Claude Desktop",
    detect: () => {
      const paths = [
        join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
        join(homedir(), "AppData", "Roaming", "Claude", "claude_desktop_config.json"),
      ];
      return paths.some((p) => existsSync(p) || existsSync(p.replace("/claude_desktop_config.json", "")));
    },
    install: (apiKey) => {
      const mac = join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
      const win = join(homedir(), "AppData", "Roaming", "Claude", "claude_desktop_config.json");
      const filePath = process.platform === "win32" ? win : mac;
      return mergeJsonConfig(filePath, "tradewink", ["mcpServers"], apiKey);
    },
  },
  {
    name: "VS Code (Copilot)",
    detect: () => commandExists("code") || existsSync(join(homedir(), ".vscode")),
    install: (apiKey) => {
      // Write to global VS Code settings
      const settingsDir =
        process.platform === "darwin"
          ? join(homedir(), "Library", "Application Support", "Code", "User")
          : process.platform === "win32"
            ? join(homedir(), "AppData", "Roaming", "Code", "User")
            : join(homedir(), ".config", "Code", "User");

      const filePath = join(settingsDir, "settings.json");
      return mergeJsonConfig(filePath, "tradewink", ["mcp", "servers"], apiKey);
    },
  },
  {
    name: "Cursor",
    detect: () => {
      return (
        commandExists("cursor") ||
        existsSync(join(homedir(), ".cursor")) ||
        existsSync("/Applications/Cursor.app")
      );
    },
    install: (apiKey) => {
      const filePath = join(homedir(), ".cursor", "mcp.json");
      return mergeJsonConfig(filePath, "tradewink", ["mcpServers"], apiKey);
    },
  },
  {
    name: "Windsurf",
    detect: () => {
      return (
        commandExists("windsurf") ||
        existsSync(join(homedir(), ".codeium", "windsurf")) ||
        existsSync("/Applications/Windsurf.app")
      );
    },
    install: (apiKey) => {
      const filePath = join(homedir(), ".codeium", "windsurf", "mcp_config.json");
      return mergeJsonConfig(filePath, "tradewink", ["mcpServers"], apiKey);
    },
  },
  {
    name: "OpenAI Codex CLI",
    detect: () => commandExists("codex"),
    install: (apiKey) => {
      try {
        execSync(`codex mcp add tradewink -- npx -y @tradewink/mcp`, {
          stdio: "ignore",
          env: apiKey
            ? { ...process.env, TRADEWINK_API_KEY: apiKey }
            : { ...process.env },
        });
        console.log(green("  Added via: codex mcp add tradewink"));
        return true;
      } catch {
        console.log(red("  Failed to run codex mcp add — add manually"));
        return false;
      }
    },
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("");
  console.log(bold("  Tradewink MCP Setup"));
  console.log(dim("  Connect your AI assistant to Tradewink\n"));

  // Auth mode: OAuth 2.1 is default; users can opt into a manual API key.
  const envKey = process.env.TRADEWINK_API_KEY ?? "";
  let apiKey: string | null = null;
  if (envKey) {
    if (!envKey.startsWith("tw_")) {
      console.log(red('\n  Invalid TRADEWINK_API_KEY. Keys start with "tw_".'));
      process.exit(1);
    }
    apiKey = envKey;
    console.log(green(`  API key found in env: ${envKey.slice(0, 6)}... (skipping OAuth)\n`));
  } else {
    console.log(
      dim(
        "  Using OAuth — on first run a browser will open to authorize your account.\n  (Set TRADEWINK_API_KEY=tw_... to use a manual key instead.)\n",
      ),
    );
    const useKey = (await ask("  Use a manual API key instead? [y/N]: "))
      .trim()
      .toLowerCase();
    if (useKey === "y" || useKey === "yes") {
      const entered = (await ask("  Enter your Tradewink API key (tw_...): ")).trim();
      if (!entered.startsWith("tw_")) {
        console.log(red('\n  Invalid API key. Keys start with "tw_".'));
        console.log(dim("  Get yours at https://tradewink.com/dashboard/api-keys\n"));
        process.exit(1);
      }
      apiKey = entered;
    }
    console.log("");
  }

  // 2. Detect clients
  const detected = clients.filter((c) => c.detect());
  const notDetected = clients.filter((c) => !c.detect());

  if (detected.length === 0) {
    console.log(yellow("  No supported AI clients detected.\n"));
    console.log("  Supported clients: Claude Code, Claude Desktop, VS Code,");
    console.log("  Cursor, Windsurf, OpenAI Codex CLI\n");
    console.log("  Manual setup: add this to your MCP config:\n");
    console.log(dim(JSON.stringify({ mcpServers: { tradewink: mcpServerConfig(apiKey) } }, null, 2)));
    console.log("");
    rl.close();
    process.exit(0);
  }

  console.log(`  Detected ${detected.length} client(s):\n`);

  // 3. Install into each detected client
  let installed = 0;
  for (const client of detected) {
    console.log(`  ${bold(client.name)}`);
    if (client.install(apiKey)) {
      installed++;
    }
    console.log("");
  }

  if (notDetected.length > 0) {
    console.log(dim(`  Not detected: ${notDetected.map((c) => c.name).join(", ")}`));
    console.log("");
  }

  // 4. Summary
  console.log(green(`  Done! Configured ${installed} client(s).`));
  console.log(dim("  Restart your AI client to connect to Tradewink.\n"));

  rl.close();
}

main().catch((err) => {
  console.error("Error:", err);
  rl.close();
  process.exit(1);
});
