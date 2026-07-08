import { Router, Request, Response } from 'express';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { SessionManager } from '../session/session-manager.js';
import { WebSocketManager } from './websocket.js';
import { AgentEngine } from '../engine/agent.js';
import { UserMessage } from '../types.js';

export function createRouter(
  sessionManager: SessionManager, 
  wsManager: WebSocketManager
): Router {
  const router = Router();

  // 列出所有會話
  router.get('/sessions', async (req: Request, res: Response) => {
    try {
      const list = await sessionManager.listSessions();
      res.json(list);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 建立新會話
  router.post('/sessions', async (req: Request, res: Response) => {
    try {
      const { name, workingDirectory, settings } = req.body;
      if (!workingDirectory) {
        return res.status(400).json({ error: '必須提供工作目錄路徑 "workingDirectory"' });
      }
      const session = await sessionManager.createSession(name, workingDirectory, settings);
      res.json(session);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 取得會話詳情與歷史訊息
  router.get('/sessions/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const session = await sessionManager.getSession(id);
      if (!session) {
        return res.status(404).json({ error: `找不到會話: ${id}` });
      }
      const messages = await sessionManager.getMessages(id);
      res.json({ session, messages });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 刪除會話
  router.delete('/sessions/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      await sessionManager.deleteSession(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 取得目前組裝好的提示詞
  router.get('/sessions/:id/prompt', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const session = await sessionManager.getSession(id);
      if (!session) {
        return res.status(404).json({ error: `找不到會話: ${id}` });
      }
      const messages = await sessionManager.getMessages(id);
      
      const engine = new AgentEngine(session, messages);

      // 動態讀取模板檔案或配置檔中的模板內容
      const templateName = session.settings.systemPromptTemplate || 'coding-assistant';
      let templateContent = '';
      try {
        templateContent = await fs.readFile(join('./data/templates', `${templateName}.md`), 'utf8');
      } catch {
        try {
          const configContent = await fs.readFile('./data/config.json', 'utf8');
          const config = JSON.parse(configContent);
          templateContent = config.promptTemplates[templateName] || '';
        } catch {
          // 讀取失敗時，沿用 Engine 內部的預設模板
        }
      }

      if (templateContent) {
        engine.setPromptTemplate(templateContent);
      }

      const prompt = await engine.assemblePrompt();
      
      // 更新 Session 的目前狀態為 waiting_for_llm
      session.updatedAt = Date.now();
      res.json(prompt);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 提交使用者最新訊息 (對話指令)
  router.post('/sessions/:id/message', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { content } = req.body;
      if (!content) {
        return res.status(400).json({ error: '必須提供訊息內容 "content"' });
      }
      
      const session = await sessionManager.getSession(id);
      if (!session) {
        return res.status(404).json({ error: `找不到會話: ${id}` });
      }

      const userMsg: UserMessage = {
        id: `msg_${Date.now()}_user`,
        sessionId: id,
        timestamp: Date.now(),
        role: 'user',
        content
      };

      await sessionManager.addMessage(id, userMsg);
      res.json(userMsg);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 提交手動複製貼回的 LLM 回應
  router.post('/sessions/:id/response', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { rawResponse } = req.body;
      if (rawResponse === undefined) {
        return res.status(400).json({ error: '必須提供原始 LLM 回應內容 "rawResponse"' });
      }

      const session = await sessionManager.getSession(id);
      if (!session) {
        return res.status(404).json({ error: `找不到會話: ${id}` });
      }

      const messages = await sessionManager.getMessages(id);
      const engine = new AgentEngine(session, messages);
      
      const parsed = engine.parseResponse(rawResponse);

      // 保存更新後的對話歷史（包含 LLMResponseMessage）
      await sessionManager.overwriteMessages(id, engine.state.messages);

      // 分析工具並生成執行計畫
      const plan = engine.generateExecutionPlan(parsed.toolCalls);

      res.json({
        textContent: parsed.parsedTextContent,
        toolCalls: parsed.toolCalls,
        parseErrors: parsed.parseErrors,
        plan
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 確認並執行計畫中的批次工具呼叫
  router.post('/sessions/:id/execute', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { plan } = req.body;
      if (!plan || !plan.stages) {
        return res.status(400).json({ error: '必須提供完整的執行計畫 "plan"' });
      }

      const session = await sessionManager.getSession(id);
      if (!session) {
        return res.status(404).json({ error: `找不到會話: ${id}` });
      }

      const messages = await sessionManager.getMessages(id);
      const engine = new AgentEngine(session, messages);

      // 通知 WebSocket 訂閱者開始執行工具
      wsManager.broadcast(id, 'execution_start', { plan });

      // 執行並廣播進度
      const results = await engine.executeExecutionPlan(plan, (progress) => {
        wsManager.broadcast(id, 'execution_progress', progress);
      });

      // 追加工具結果到歷史中
      engine.appendToolResults(results);
      await sessionManager.overwriteMessages(id, engine.state.messages);

      // 通知執行完成
      wsManager.broadcast(id, 'execution_end', { results });

      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
