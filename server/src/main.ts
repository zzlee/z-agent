import express from 'express';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import { SessionManager } from './session/session-manager.js';
import { WebSocketManager } from './api/websocket.js';
import { createRouter } from './api/routes.js';
import { GlobalConfig } from './types.js';
import { expandTilde } from './tools/base.js';

async function bootstrap() {
  const app = express();
  const server = createServer(app);

  app.use(express.json());

  // 載入全域設定
  const configPath = './data/config.json';
  let config: GlobalConfig;
  try {
    const configContent = await fs.readFile(configPath, 'utf8');
    config = JSON.parse(configContent);
  } catch {
    console.warn('找不到或讀取 config.json 失敗，使用預設值。');
    config = {
      server: { port: 3000, host: 'localhost' },
      defaults: {
        workingDirectory: './workspace',
        systemPromptTemplate: 'coding-assistant',
        targetModel: 'claude-3-5-sonnet',
        enabledTools: ['read', 'write', 'edit', 'bash']
      },
      security: {
        allowedPaths: ['./workspace'],
        bashBlacklist: ['sudo', 'su', 'rm -rf /', 'nano', 'vim', 'vi'],
        maxOutputSize: 102400
      },
      promptTemplates: {}
    };
  }

  // 展開預設工作目錄中的 tilde
  const defaultWd = expandTilde(config.defaults.workingDirectory);

  // 確保工作目錄與資料儲存目錄存在
  await fs.mkdir(defaultWd, { recursive: true });
  await fs.mkdir('./data/sessions', { recursive: true });

  // 初始化元件
  const sessionManager = new SessionManager('./data');
  const wsManager = new WebSocketManager(server);

  // 靜態檔案託管 (前端 Web UI)
  const webDir = resolve('./web');
  app.use(express.static(webDir));

  // REST API 路由
  app.use('/api', createRouter(sessionManager, wsManager));

  // 前端單頁應用 (SPA) 路由回退，使任何重新整理操作正常
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(join(webDir, 'index.html'));
  });

  const port = config.server.port || 3000;
  const host = config.server.host || '0.0.0.0';

  server.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`================ Z-Agent 啟動完成 ================`);
    console.log(`  工作目錄: ${resolve(defaultWd)}`);
    console.log(`  資料目錄: ${resolve('./data')}`);
    console.log(`  Web 介面: http://${displayHost}:${port} (已綁定所有網路介面)`);
    console.log(`=================================================`);
  });
}

bootstrap().catch(err => {
  console.error('Z-Agent 啟動失敗:', err);
  process.exit(1);
});
