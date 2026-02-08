# SAP ADT MCP Server

An MCP (Model Context Protocol) server that provides AI assistants like Claude with access to SAP ABAP systems via the ADT (ABAP Development Tools) API.

## Features

- **Search** - Find ABAP objects (classes, programs, packages, tables, etc.)
- **Read Source Code** - Get the source code of any ABAP object
- **Browse Packages** - List package contents and metadata
- **Object Info** - Get detailed metadata about ABAP objects
- **Connection Check** - Verify SAP system connectivity

## Prerequisites

- Node.js 18+
- SAP BTP ABAP Environment (Trial or Enterprise)
- Chrome browser (for authentication)

## Installation

```bash
npm install
```

## Authentication Setup

This server uses browser-based authentication with session cookies. You need to authenticate periodically when cookies expire.

### On Windows:

1. Navigate to the project folder:
   ```powershell
   cd C:\Users\<your-user>\sap-test
   ```

2. Run the authentication script:
   ```powershell
   node auth.js
   ```

3. A browser window will open - login to SAP with your credentials (including 2FA)

4. Cookies will be saved to `.sap-cookies.json`

5. Copy cookies to WSL if needed:
   ```powershell
   Copy-Item .sap-cookies.json \\wsl$\Ubuntu\home\<user>\personal\sap-mcp-server\
   ```

## Configuration

The `.env` file contains:

```env
SAP_ADT_URL=https://<your-instance>.abap-web.us10.hana.ondemand.com
```

**Important:** Use the `abap-web` URL, not `abap` URL.

## Usage with Claude Desktop

Add to your Claude Desktop config (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sap-adt": {
      "command": "node",
      "args": ["/path/to/sap-mcp-server/src/index.js"],
      "env": {}
    }
  }
}
```

## Available Tools

### sap_search
Search for ABAP objects.

```json
{
  "query": "Z*",
  "maxResults": 20,
  "objectType": "CLAS"
}
```

### sap_read_source
Read source code of an ABAP object.

```json
{
  "objectType": "class",
  "objectName": "ZFIRST_CLASS"
}
```

Supported types: `class`, `interface`, `program`, `function`, `table`

### sap_get_package
Get package info and contents.

```json
{
  "packageName": "Z_AI_TRIAL"
}
```

### sap_get_object_info
Get detailed object metadata.

```json
{
  "uri": "/sap/bc/adt/oo/classes/zfirst_class"
}
```

### sap_check_connection
Verify SAP connection is working.

```json
{}
```

## Testing

```bash
# Test connection
npm test

# Test MCP server
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node src/index.js
```

## Troubleshooting

### 401 Unauthorized
- Session cookies have expired
- Re-run the authentication script

### 406 Not Acceptable
- Wrong Accept header (handled automatically by the client)

### Connection Timeout
- Check your SAP instance is running
- Verify the URL in `.env`

## License

MIT
