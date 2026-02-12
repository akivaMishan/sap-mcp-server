# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server that exposes SAP ABAP systems to AI assistants via the ADT (ABAP Development Tools) REST API. The server runs on stdio and is consumed by Claude Desktop or Claude Code as an MCP tool provider. All SAP communication goes through the Eclipse ADT Bridge.

## Commands

```bash
npm start              # Run MCP server (stdio transport)

# Check Eclipse bridge health (from WSL2, localhost won't work — use gateway IP)
curl http://$(ip route | grep default | awk '{print $3}'):19456/health

# Full MCP smoke test (must send initialize first; use timeout since server stays alive on stdio)
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"sap_check_connection","arguments":{}}}' | timeout 15 node src/index.js 2>/dev/null

# Build Eclipse ADT bridge plugin (from WSL)
bash eclipse-adt-bridge/build.sh
# After build, restart Eclipse, then verify with health check above
```

## Architecture

### Eclipse ADT Bridge (required)

The server requires the Eclipse ADT Bridge plugin running on port 19456. All requests are proxied through Eclipse's internal ADT APIs (`com.sap.adt.communication`), which provides `S_DEVELOP` authorization for full read/write access. The bridge is auto-detected at startup by probing `localhost`, `127.0.0.1`, and the WSL2 gateway IP.

### MCP Server (`src/index.js`)

Registers MCP tools: `sap_search`, `sap_read_source`, `sap_get_package`, `sap_get_object_info`, `sap_check_connection`, `sap_create_class`, `sap_create_program`. Each tool delegates to `SapAdtClient`.

**Write operations:** `sap_create_class` is an upsert — it tries to POST-create the class first. If it already exists (SAP returns 400 with `ExceptionResourceAlreadyExists`), it falls back to updating the source code (lock → PUT → unlock → activate). The creation XML includes `adtcore:abapLanguageVersion="cloudDevelopment"` which is required on BTP trial (without it, `S_ABPLNGVS` auth check fails). Default package is `Z_AI_TRIAL` since `$TMP` doesn't support cloud language version. We avoid a GET existence check because the bridge's enqueue session auto-locks objects on any access. Activation must happen after unlock — SAP rejects activation with 403 "currently editing" if the object is still locked. `sap_create_program` may fail on BTP trial accounts due to `S_DEVELOP` restrictions on program objects.

### SAP ADT Client (`src/sap-adt-client.js`)

Core HTTP client. Handles:
- Bridge detection (WSL2-aware: checks `/etc/resolv.conf` and `ip route` for gateway IP)
- XML response parsing via `xml2js`
- ADT URI construction for different object types (class, interface, program, function, table)

### Eclipse ADT Bridge Plugin (`eclipse-adt-bridge/`)

Java Eclipse plugin (OSGi bundle) that runs an HTTP server on port 19456 inside Eclipse. Acts as a proxy: receives JSON requests from the MCP server and executes them through Eclipse's internal ADT communication APIs (`com.sap.adt.communication`). This gives the same authorization level as the logged-in Eclipse user.

Key classes:
- `BridgeHttpServer` — HTTP server bound to `0.0.0.0:19456` with `/health` and `/proxy` endpoints
- `ProxyHandler` — Parses JSON proxy requests, delegates to `AdtConnectionManager`
- `AdtConnectionManager` — Finds the first open ABAP project in the Eclipse workspace, creates REST resources using `AdtRestResourceFactory`, handles session management (enqueue/stateful/stateless). All methods (GET/POST/PUT/DELETE) are proxied via REST resources.
- `EarlyStartup` — `IStartup` implementation that starts the bridge on Eclipse boot

Build requires JDK 11+ and Eclipse ADT plugin JARs from the p2 pool (`~/.p2/pool/plugins/`).

## Repository Structure

```
sap-mcp-server/
├── src/
│   ├── index.js                  — MCP server entry point, tool registration
│   └── sap-adt-client.js         — HTTP client, bridge detection, ADT API logic
├── eclipse-adt-bridge/
│   ├── src/.../adtbridge/        — 6 Java source files (plugin)
│   ├── META-INF/MANIFEST.MF      — OSGi bundle manifest
│   ├── plugin.xml                — Eclipse startup extension point
│   ├── feature/feature.xml       — p2 feature definition
│   ├── build.sh                  — Local JAR build script
│   ├── build-p2.sh               — p2 repository builder
│   └── build/release/            — Pre-built JAR (committed for CI)
├── .github/workflows/
│   └── build-update-site.yml     — CI: build p2 site → deploy to GitHub Pages
├── docs/
│   ├── architecture.html         — Visual architecture documentation
│   └── capture-eclipse-traffic.md
├── package.json
└── .env                          — optional BRIDGE_URL
```

## Build Pipeline

The plugin build is split between local and CI because SAP ADT plugin JARs (e.g., `com.sap.adt.communication`) are proprietary and only available in a local Eclipse installation's p2 pool. CI runners don't have them.

1. **Local build** (`eclipse-adt-bridge/build.sh`): Compiles Java sources against Eclipse ADT JARs from `~/.p2/pool/plugins/`, produces an OSGi bundle JAR.
2. **Commit pre-built JAR** to `eclipse-adt-bridge/build/release/` — this is the CI input.
3. **Git tag** (`v*`) or manual workflow dispatch triggers GitHub Actions.
4. **GitHub Actions** (`build-update-site.yml`): Downloads Eclipse SDK, runs `build-p2.sh` with the pre-built JAR, produces a p2 update site repository.
5. **GitHub Pages** deploys the p2 repository to `https://akivamishan.github.io/sap-mcp-server/`.

## Installation

### MCP Server

1. `npm install`
2. Configure Claude Desktop or Claude Code to use `node src/index.js` (see [Running on Windows](#running-on-windows-with-claude-desktop) below)

### Eclipse Plugin

- **p2 update site (recommended):** In Eclipse, go to Help > Install New Software, add the URL `https://akivamishan.github.io/sap-mcp-server/`, and install the "Eclipse ADT Bridge for MCP" feature.
- **Manual:** Copy the JAR from `eclipse-adt-bridge/build/release/` to your Eclipse `dropins/` folder and restart Eclipse.

### Verification

```bash
curl http://$(ip route | grep default | awk '{print $3}'):19456/health
```

## GitHub Pages

- **URL:** `https://akivamishan.github.io/sap-mcp-server/`
- **Serves:** p2 update site (`artifacts.jar`, `content.jar`, plugin JAR, feature JAR) plus a landing page (`index.html`).
- Eclipse consumes it via Help > Install New Software.
- Deployed by the `build-update-site.yml` workflow on `v*` tags or manual dispatch.

## Configuration

The `.env` file uses:
- `BRIDGE_URL` — (optional) Eclipse ADT Bridge URL. If set, skips auto-detection and connects directly. Example: `http://localhost:19456`. Useful if the bridge runs on a non-default host/port.

The Eclipse ADT Bridge must be running for the server to function. See the health check command above.

## Running on Windows with Claude Desktop

The MCP server can run natively on Windows (same PC as Eclipse), which is simpler than the WSL2 setup since `localhost` reaches Eclipse directly.

### Setup

1. Install Node.js v18+ on Windows (from nodejs.org)
2. Copy this project to a Windows folder (e.g., `C:\sap-mcp-server\`)
3. Run `npm install` in that folder
### Claude Desktop Configuration

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sap-adt": {
      "command": "node",
      "args": ["C:\\sap-mcp-server\\src\\index.js"]
    }
  }
}
```

Restart Claude Desktop. The SAP tools will appear in Claude's tool list. Ensure Eclipse is running with the ADT Bridge plugin before using any SAP tools.

## Key Patterns

- All SAP ADT responses are XML. Parsing uses `xml2js.parseStringPromise` with `{ explicitArray: false }`.
- ADT object names are lowercased for URI construction but uppercased in ABAP conventions.
- The bridge plugin uses a response filter pattern (`IRestResourceResponseFilter`) to capture status, headers, and body from Eclipse's ADT REST resources since the API doesn't return them directly.
- The bridge handles CSRF tokens internally.
- **Lock handles** must be passed as query parameters (`params`), not as headers. Eclipse's `IRestResource.put()` does not forward custom headers like `X-sap-adt-lockhandle`.
- **Bridge session strategy**: GET requests use stateless sessions (avoids accidental auto-locking). POST/PUT/DELETE use enqueue sessions (shared lock context for LOCK → PUT → UNLOCK sequences). Enqueue sessions auto-lock any object accessed via them, so avoid using them for read-only checks.
- **BTP trial requires `abapLanguageVersion="cloudDevelopment"`** in class creation XML. Without it, the `S_ABPLNGVS` auth check fails with 403. The `$TMP` package does not support cloud language version — use `Z_AI_TRIAL` instead.
- **SAP returns 400 (not 409) for duplicate objects**, with exception type `ExceptionResourceAlreadyExists`. Do not treat 403 as "already exists" — that indicates a real authorization error.
- **Unlock before activate.** Activation POST fails with 403 "currently editing" if the object is still locked. Correct write sequence: Lock → PUT → Unlock → Activate.

## WSL2 Networking

This project runs in WSL2 while Eclipse runs on the Windows host. Key networking facts:
- `localhost` / `127.0.0.1` from WSL2 do **not** reach Windows. The bridge auto-detection code handles this, but for manual `curl` testing you must use the gateway IP.
- Gateway IP: `ip route | grep default | awk '{print $3}'` (e.g. `172.20.208.1`)
- The bridge binds to `0.0.0.0:19456` so it's reachable from WSL2 via the gateway IP.
- The nameserver IP from `/etc/resolv.conf` is a different address and does **not** reliably reach the bridge.
