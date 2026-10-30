# Changelog

## 0.3.1 (unreleased, HOLD-PUBLISH)

- Add `mcpName: io.github.leancoderkavy/tradewink` so the Official MCP Registry can verify the npm package (KAV-91).
- Document the recommended Tradewink signals + official Alpaca MCP execution workflow, with paper trading enabled by default and a risk disclaimer.
- Update package metadata to highlight agent signals, Alpaca pairing, and paper trading.

## 0.3.0 — 2026-05-12

- Bridge `tradewink-mcp-bridge` and stdio server now report `version: "0.3.0"`.
- `TRADEWINK_ENDPOINT` env var continues to override `DEFAULT_ENDPOINT` (`https://tradewink-mcp.fly.dev/mcp`); `--endpoint <url>` CLI flag also supported. Set this for self-hosted backends or while the production endpoint is being restored.
- Compliance copy on https://tradewink.com/mcp updated to comply with FINRA Rule 2210 / SEC Marketing Rule 206(4)-1: prominent risk disclosure in hero, "informational only — not a recommendation" on multi-agent capability, AI-misinterpretation warning on order-placement capability, broker-capability variance note, comparison-table data-as-of footnote, dedicated FAQs for liability / PDT / crypto-CFTC / discretion.

## 0.2.0 — 2026-04

- OAuth 2.1 + PKCE flow (replaces API-key-only mode).
- Token cache at `~/.tradewink/mcp/<host>.json`, mode 0600.
- Auto-refresh via SDK auth provider.

## 0.1.x — 2026-03/04

- Initial stdio bridge.
- API-key auth via `TRADEWINK_API_KEY`.
