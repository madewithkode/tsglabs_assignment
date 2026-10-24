/**
 * HTTP entry point. Chord is the MCP client: it POSTs JSON-RPC to /mcp over Streamable HTTP.
 *
 * Stateless transport — a fresh MCP server per request, no MCP session ids — because the state
 * that matters lives in the shared tool context (quotes) and in Paystack (bookings), not in the
 * protocol session. That also means any instance, or a freshly woken one, can serve any call.
 */

import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { maskContactDetails } from './diagnostics.js';
import { buildServer } from './mcp.js';
import { bearerAuth } from './middleware/bearer-auth.js';
import { createContext } from './tools/context.js';

const ctx = createContext();
const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'swiftbox-dispatch', time: new Date().toISOString() });
});

app.post('/mcp', bearerAuth(process.env.MCP_BEARER_TOKEN), async (req, res) => {
  // Logged before the MCP library validates the arguments: a call it rejects against the input
  // schema never reaches a tool, so this line is the only record of what the model actually sent.
  for (const message of [req.body].flat()) {
    if (message?.method === 'tools/call') {
      const args = JSON.stringify(maskContactDetails(message.params?.arguments ?? {}));
      console.log(`[mcp] call ${message.params?.name} args=${args}`);
    }
  }

  const server = buildServer(ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[mcp] request failed', error);
    if (!res.headersSent) {
      // The body parsed, so echo its id: JSON-RPC reserves a null id for requests whose id can't be read.
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: req.body?.id ?? null,
      });
    }
  }
});

// A body that isn't JSON gets a JSON-RPC parse error.
const parseError: express.ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type !== 'entity.parse.failed') return next(error);
  res.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
};
app.use(parseError);

// Stateless: no server-initiated stream to open (GET) and no session to end (DELETE).
const methodNotAllowed: express.RequestHandler = (_req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
};
app.get('/mcp', methodNotAllowed);
app.delete('/mcp', methodNotAllowed);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`swiftbox-dispatch MCP server listening on :${port}`));
