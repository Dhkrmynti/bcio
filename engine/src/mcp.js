// BCIO engine sebagai MCP server (stdio). Tool yang sama dengan agent terminal,
// sehingga Claude Desktop atau agent lain bisa memakai data & korelasi BCIO.
//
//   node src/mcp.js
//
// Contoh di konfigurasi MCP client:
//   { "mcpServers": { "bcio": { "command": "node", "args": ["/path/to/bcio/engine/src/mcp.js"] } } }
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS, runTool } from './tools.js';

const server = new McpServer({ name: 'bcio-engine', version: '0.1.0' });

for (const t of TOOLS) {
  server.registerTool(t.name, { description: t.description, inputSchema: t.schema.shape }, async (args) => {
    const r = await runTool(t.name, args);
    return {
      content: [{ type: 'text', text: JSON.stringify(r.ok ? r.result : { error: r.error }) }],
      isError: !r.ok,
    };
  });
}

await server.connect(new StdioServerTransport());
