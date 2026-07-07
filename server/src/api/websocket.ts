import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'node:http';

export interface WsMessage {
  type: string;
  sessionId: string;
  payload: any;
}

export class WebSocketManager {
  private wss: WebSocketServer;
  // sessionId -> Set of active WebSocket connections
  private subscriptions = new Map<string, Set<WebSocket>>();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ noServer: true });
    
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      if (url.pathname === '/ws') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws) => {
      let currentSessionId: string | null = null;

      ws.on('message', (message) => {
        try {
          const data: WsMessage = JSON.parse(message.toString());
          if (data.type === 'subscribe') {
            currentSessionId = data.sessionId;
            if (!this.subscriptions.has(currentSessionId)) {
              this.subscriptions.set(currentSessionId, new Set());
            }
            this.subscriptions.get(currentSessionId)!.add(ws);
          } else if (data.type === 'unsubscribe') {
            if (currentSessionId && this.subscriptions.has(currentSessionId)) {
              this.subscriptions.get(currentSessionId)!.delete(ws);
            }
            currentSessionId = null;
          }
        } catch (e) {
          console.error('WebSocket 訊息解析失敗:', e);
        }
      });

      ws.on('close', () => {
        if (currentSessionId && this.subscriptions.has(currentSessionId)) {
          this.subscriptions.get(currentSessionId)!.delete(ws);
        }
      });

      ws.on('error', (e) => {
        console.error('WebSocket 連線出錯:', e);
      });
    });
  }

  /**
   * 向指定會話訂閱者廣播即時訊息
   */
  broadcast(sessionId: string, type: string, payload: any): void {
    const clients = this.subscriptions.get(sessionId);
    if (!clients || clients.size === 0) return;

    const data = JSON.stringify({ type, sessionId, payload });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }
}
