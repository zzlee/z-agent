#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from './server.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';
const MCP_PATH = process.env.MCP_PATH ?? '/mcp';

/** 作用中的 session：sessionId -> transport */
const transports = new Map<string, StreamableHTTPServerTransport>();

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: '2.0' as const, error: { code, message }, id: null };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') return undefined;
  return JSON.parse(raw);
}

function getSessionId(req: IncomingMessage): string | undefined {
  const header = req.headers['mcp-session-id'];
  return typeof header === 'string' ? header : undefined;
}

async function handlePost(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const sessionId = getSessionId(req);

  if (sessionId && transports.has(sessionId)) {
    await transports.get(sessionId)!.handleRequest(req, res, body);
    return;
  }

  if (!sessionId && isInitializeRequest(body)) {
    let transport: StreamableHTTPServerTransport;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport);
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) transports.delete(sid);
    };

    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    return;
  }

  sendJson(res, 400, jsonRpcError(-32000, 'Bad Request: No valid session ID provided'));
}

async function handleSessionRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessionId = getSessionId(req);
  if (!sessionId || !transports.has(sessionId)) {
    sendJson(res, 400, jsonRpcError(-32000, 'Bad Request: No valid session ID provided'));
    return;
  }
  await transports.get(sessionId)!.handleRequest(req, res);
}

const httpServer = createHttpServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      if (url.pathname === '/health') {
        sendJson(res, 200, { status: 'ok', name: 'z-agent' });
        return;
      }

      if (url.pathname !== MCP_PATH) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }

      switch (req.method) {
        case 'POST': {
          let body: unknown;
          try {
            body = await readJsonBody(req);
          } catch {
            sendJson(res, 400, jsonRpcError(-32700, 'Parse error'));
            return;
          }
          await handlePost(req, res, body);
          return;
        }
        case 'GET':
        case 'DELETE':
          await handleSessionRequest(req, res);
          return;
        default:
          res.writeHead(405, { allow: 'GET, POST, DELETE' });
          res.end();
          return;
      }
    } catch (err) {
      console.error('[z-agent] request error:', err);
      if (!res.headersSent) {
        sendJson(res, 500, jsonRpcError(-32603, 'Internal server error'));
      } else {
        res.end();
      }
    }
  })();
});

httpServer.listen(PORT, HOST, () => {
  console.error(`[z-agent] MCP server (streamable HTTP) listening on http://${HOST}:${PORT}${MCP_PATH}`);
  console.error(`[z-agent] working directory: ${process.cwd()}`);
});
