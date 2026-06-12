# @tradewink/mcp

Connect any LLM to the [Tradewink](https://tradewink.com) autonomous trading platform via the [Model Context Protocol](https://modelcontextprotocol.io).

Get real-time quotes, manage your portfolio, execute trades, run AI analysis, and more — all from your AI assistant.

## Quick Start

### 1. Configure Your Client

No API key needed — `@tradewink/mcp` uses OAuth 2.1. The first time you run it, a browser window opens to authorize your [tradewink.com](https://tradewink.com) account. Tokens are cached in `~/.tradewink/mcp/` and refresh automatically.

#### Automatic Setup (Recommended)

Auto-detect and configure all your installed AI clients with one command:

```bash
npx @tradewink/mcp setup
```

This detects and configures: Claude Code, Claude Desktop, VS Code (Copilot), Cursor, Windsurf, and OpenAI Codex CLI.

#### Manual Setup

<details>
<summary>Claude Code</summary>

```bash
claude mcp add tradewink -- npx -y @tradewink/mcp
```
</details>

<details>
<summary>Claude Desktop</summary>

Add to your `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "tradewink": {
      "command": "npx",
      "args": ["-y", "@tradewink/mcp"]
    }
  }
}
```
</details>

<details>
<summary>VS Code (Copilot)</summary>

Add to your VS Code settings (`.vscode/settings.json` or global settings):

```json
{
  "mcp": {
    "servers": {
      "tradewink": {
        "command": "npx",
        "args": ["-y", "@tradewink/mcp"],
        "env": {
          "TRADEWINK_API_KEY": "tw_your_key_here"
        }
      }
    }
  }
}
```
</details>

<details>
<summary>Cursor</summary>

Add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "tradewink": {
      "command": "npx",
      "args": ["-y", "@tradewink/mcp"]
    }
  }
}
```
</details>

<details>
<summary>OpenAI Codex CLI</summary>

```bash
codex mcp add tradewink -- npx -y @tradewink/mcp
```
</details>

<details>
<summary>Windsurf</summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "tradewink": {
      "command": "npx",
      "args": ["-y", "@tradewink/mcp"]
    }
  }
}
```
</details>

<details>
<summary>Any MCP-Compatible Client</summary>

Any client that supports MCP stdio servers works:

```bash
npx @tradewink/mcp
```
</details>

### 2. Start Using It

Ask your AI assistant things like:

- "What's my account balance?"
- "Show me my open positions"
- "Get a quote for AAPL"
- "What are today's top market movers?"
- "Analyze NVDA with AI"
- "Add TSLA to my watchlist"
- "What are my active trading strategies?"
- "Show my trade history for the past week"

## Available Tools

| Category | Tools |
|----------|-------|
| **Account** | `get_account`, `get_positions`, `get_portfolio_live` |
| **Watchlist** | `get_watchlist`, `add_to_watchlist`, `remove_from_watchlist` |
| **Market Data** | `get_quote`, `batch_quote`, `get_historical`, `get_news`, `get_analyst_ratings`, `get_earnings`, `get_technical_analysis` |
| **Screener** | `get_market_movers`, `get_screener_results` |
| **Trading** | `place_order`, `close_position`, `get_open_orders`, `cancel_order` |
| **Strategies** | `get_strategies`, `get_strategy`, `get_exit_strategies`, `get_sell_confidence` |
| **Trade History** | `get_trades`, `get_trade_analytics`, `get_trade_executions`, `get_audit_log` |
| **AI Analysis** | `ask_ai`, `analyze_ticker`, `get_insights` |
| **Preferences** | `get_preferences`, `list_preference_options`, `update_preference`, `reset_preference` |
| **Scheduling** | `schedule_analysis`, `list_scheduled_jobs`, `cancel_scheduled_job` |

## Configuration

| Environment Variable | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `TRADEWINK_API_KEY` | No | — | Skip the OAuth flow and use a manual API key (`tw_...`). Useful for headless CI. |
| `TRADEWINK_ENDPOINT` | No | `https://tradewink-mcp.fly.dev/mcp` | Custom MCP server endpoint |

You can also pass `--endpoint` as a CLI argument:

```bash
npx @tradewink/mcp --endpoint https://custom.example.com/mcp
```

## Auth

OAuth 2.1 is the default. On first run a browser window opens to `tradewink.com/mcp/authorize`, you approve the request, and the bridge caches an access + refresh token pair at `~/.tradewink/mcp/<host>.json`. Access tokens live for 1 hour and refresh automatically for 60 days. You can revoke access anytime from your [dashboard](https://tradewink.com/dashboard/api-keys).

Set `TRADEWINK_API_KEY=tw_...` to skip OAuth and use a manual key (e.g. for CI, sandboxes, or pinned long-lived access).

## How It Works

This package runs a local MCP server over stdio and proxies every tool/resource call to the remote Tradewink MCP server over HTTPS. OAuth tokens are minted per-device and scoped to your account.

```
Your LLM Client ←stdio→ @tradewink/mcp ←HTTPS (Bearer token)→ Tradewink MCP Server
```

## License

MIT
