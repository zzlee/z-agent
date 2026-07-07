import { Router, Request, Response } from 'express';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { SessionManager } from '../session/session-manager.js';
import { WebSocketManager } from './websocket.js';
import { AgentEngine } from '../engine/agent.js';
import { SessionSettings, UserMessage, SystemMessage, Message } from '../types.js';

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

      const prompt = engine.assemblePrompt();
      
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

  // 從指定訊息建立分支會話
  router.post('/sessions/:id/branch', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { messageId, name } = req.body;
      if (!messageId) {
        return res.status(400).json({ error: '必須提供要分支的起點訊息 ID "messageId"' });
      }

      const newSession = await sessionManager.branchSession(id, messageId, name);
      res.json(newSession);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 取得所有可用提示詞模板
  router.get('/templates', async (req: Request, res: Response) => {
    try {
      const templatesDir = './data/templates';
      await fs.mkdir(templatesDir, { recursive: true });
      const files = await fs.readdir(templatesDir);
      const names = files
        .filter(f => f.endsWith('.md'))
        .map(f => f.substring(0, f.length - 3));
      res.json(names);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 讀取全域設定
  router.get('/config', async (req: Request, res: Response) => {
    try {
      const configContent = await fs.readFile('./data/config.json', 'utf8');
      res.json(JSON.parse(configContent));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 儲存全域設定
  router.put('/config', async (req: Request, res: Response) => {
    try {
      await fs.mkdir('./data', { recursive: true });
      await fs.writeFile('./data/config.json', JSON.stringify(req.body, null, 2), 'utf8');
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 取得對話歷史壓縮提示詞
  router.post('/sessions/:id/compact/prompt', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const session = await sessionManager.getSession(id);
      if (!session) {
        return res.status(404).json({ error: `找不到會話: ${id}` });
      }
      const messages = await sessionManager.getMessages(id);
      const engine = new AgentEngine(session, messages);
      const formattedHistory = engine.assemblePrompt().sections.conversationHistory;

      const prompt = `You are currently assisting the user with programming tasks. Due to the conversation history being too long, we need to compress it to save context space.
Please summarize the conversation history below into a concise "Current Status & Accomplishments Summary".

--- CONVERSATION HISTORY TO COMPRESS ---
${formattedHistory || '(No history yet)'}

--- SUMMARY REQUIREMENTS ---
Please describe in a bulleted list (in English):
1. The accomplishments and deliverables achieved so far.
2. The current state of the file system (e.g. which files were created or modified).
3. Current pending items or the next steps to execute.

Please reply with the summary directly without any tool calls or conversational filler.`;

      res.json({ prompt });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 提交對話壓縮摘要並執行壓縮
  router.post('/sessions/:id/compact/submit', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { summary } = req.body;
      if (!summary) {
        return res.status(400).json({ error: '必須提供壓縮摘要內容 "summary"' });
      }

      const session = await sessionManager.getSession(id);
      if (!session) {
        return res.status(404).json({ error: `找不到會話: ${id}` });
      }

      const messages = await sessionManager.getMessages(id);
      if (messages.length === 0) {
        return res.json({ success: true });
      }

      // 保留最後一個訊息（如果是 user 或 tool_result，用來維持下一輪執行上下文）
      const lastMsg = messages[messages.length - 1];
      const keepsLast = lastMsg.role === 'user' || lastMsg.role === 'tool_result';

      const systemNotice: SystemMessage = {
        id: `msg_${Date.now()}_compact_notice`,
        sessionId: id,
        timestamp: Date.now(),
        role: 'system',
        level: 'info',
        content: `[Session history compressed. The following is a summary of the previous logs:]\n${summary}`
      };

      const newMessages: Message[] = [systemNotice];
      if (keepsLast) {
        newMessages.push(lastMsg);
      }

      await sessionManager.overwriteMessages(id, newMessages);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
