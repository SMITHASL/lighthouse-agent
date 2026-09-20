/**
 * Optional: exposes the tool registry (src/tools) to an external harness such as TrueForge over
 * MCP Streamable HTTP (JSON-RPC 2.0 over POST, stateless). Implements the three methods a
 * client needs — initialize, tools/list, tools/call — on node:http; no SDK.
 * The standalone local runtime never needs this process.
 */
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { TOOLS, callTool, loadStore, type Store } from '../tools/index.ts';
import { z } from '../lib/schema.ts';

export { loadStore, type Store } from '../tools/index.ts';

export const MCP_PORT = 8799;
export const MCP_URL = `http://localhost:${MCP_PORT}/mcp`;
const PROTOCOL_VERSION = '2025-06-18';

type RpcRequest = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> };
type RpcResponse = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

export function listToolsResult() {
  return {
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: z.object(t.inputSchema).toJsonSchema(),
      annotations: t.readOnly ? { readOnlyHint: true } : { readOnlyHint: false, destructiveHint: false },
    })),
  };
}

export async function handleRpc(req: RpcRequest, ctx: { store: Store; dataDir: string }): Promise<RpcResponse | null> {
  const id = req.id ?? null;
  const ok = (result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result });
  const err = (code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });
  switch (req.method) {
    case 'initialize':
      return ok({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'lighthouse-tools', version: '0.1.0' } });
    case 'notifications/initialized':
    case 'ping':
      return req.id === undefined ? null : ok({});
    case 'tools/list':
      return ok(listToolsResult());
    case 'tools/call': {
      const { name, arguments: args } = (req.params ?? {}) as { name?: string; arguments?: unknown };
      if (!name || !TOOLS.some((t) => t.name === name)) return err(-32602, `unknown tool ${name}`);
      const result = await callTool(name, args ?? {}, ctx);
      const isError = typeof result === 'object' && result !== null && 'error' in result;
      return ok({ content: [{ type: 'text', text: JSON.stringify(result) }], isError });
    }
    default:
      return err(-32601, `method not found: ${req.method}`);
  }
}

export async function startMcpServer(store: Store, port = MCP_PORT, dataDir = 'data'): Promise<() => Promise<void>> {
  const server: Server = createServer(async (req, res) => {
    if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'stateless server; use POST' })); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed: RpcRequest | RpcRequest[];
    try { parsed = JSON.parse(body) as RpcRequest | RpcRequest[]; } catch {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }));
      return;
    }
    const batch = Array.isArray(parsed);
    const requests: RpcRequest[] = Array.isArray(parsed) ? parsed : [parsed];
    const responses = (await Promise.all(requests.map((r) => handleRpc(r, { store, dataDir })))).filter((r): r is RpcResponse => r !== null);
    if (!responses.length) { res.writeHead(202).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(batch ? responses : responses[0]));
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return () => new Promise((resolve) => server.close(() => resolve()));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const store = loadStore();
  await startMcpServer(store);
  console.log(`lighthouse MCP server on ${MCP_URL} (${store.applicants.size} applicants)`);
}
