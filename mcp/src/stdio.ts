import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMesMcpServer } from './server.js';

const server = createMesMcpServer();
await server.connect(new StdioServerTransport());
