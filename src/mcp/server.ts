/**
 * Optional: exposes the tool registry (src/tools) over MCP Streamable-HTTP for an external
 * harness such as TrueForge. The standalone local harness never needs this process.
 */
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TOOLS, loadStore, type Store } from '../tools/index.js';

export { loadStore, type Store } from '../tools/index.js';

export const MCP_PORT = 8799;
export const MCP_URL = `http://localhost:${MCP_PORT}/mcp`;

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] });

export function buildMcpServer(store: Store, dataDir = 'data'): McpServer {
  const server = new McpServer({ name: 'lighthouse-tools', version: '0.1.0' });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.readOnly ? { readOnlyHint: true } : { readOnlyHint: false, destructiveHint: false },
      },
      async (args: Record<string, unknown>) => text(await tool.handler(args, { store, dataDir })),
    );
  }
  return server;
}

export async function startMcpServer(store: Store, port = MCP_PORT): Promise<() => Promise<void>> {
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  // Stateless transport: one server instance per request keeps the demo simple and restart-safe.
  app.post('/mcp', async (req, res) => {
    const server = buildMcpServer(store);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.get('/mcp', (_req, res) => {
    res.status(405).json({ error: 'stateless server; use POST' });
  });
  const httpServer = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });
  return () => new Promise((resolve) => httpServer.close(() => resolve()));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const store = loadStore();
  await startMcpServer(store);
  console.log(`lighthouse MCP server on ${MCP_URL} (${store.applicants.size} applicants)`);
}
