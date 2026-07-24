import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMesMcpServer } from './server.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const allowedHosts = (process.env.MES_MCP_ALLOWED_HOSTS ?? '127.0.0.1,localhost')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const host = String(req.headers.host ?? '').split(':')[0];
  if (!allowedHosts.includes(host)) return res.status(403).json({ error: 'Host is not allowed' });

  const expected = process.env.MES_MCP_BEARER_TOKEN;
  if (!expected) return res.status(503).json({ error: 'MES_MCP_BEARER_TOKEN is not configured' });
  if (req.headers.authorization !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Invalid MCP bearer token' });
  }
  next();
});

app.post('/mcp', async (req, res) => {
  const server = createMesMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get('/mcp', (_req, res) => res.status(405).json({ error: 'Use POST for stateless MCP' }));
app.delete('/mcp', (_req, res) => res.status(405).json({ error: 'Stateless MCP has no session to delete' }));

const port = Number(process.env.MES_MCP_PORT ?? 3100);
app.listen(port, '0.0.0.0', () => {
  process.stderr.write(`MES MCP Streamable HTTP listening on port ${port}\\n`);
});
