import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Message, Session } from '../types.js';

export class SessionStore {
  private dataDir: string;
  private sessionsDir: string;
  private indexFile: string;

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;
    this.sessionsDir = join(dataDir, 'sessions');
    this.indexFile = join(this.sessionsDir, 'index.json');
  }

  /**
   * 確保資料夾存在
   */
  async ensureDirs(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.sessionsDir, { recursive: true });
  }

  /**
   * 取得會話的訊息 JSONL 檔案路徑
   */
  private getMessagesPath(sessionId: string): string {
    return join(this.sessionsDir, sessionId, 'messages.jsonl');
  }

  /**
   * 取得會話的 metadata 檔案路徑
   */
  private getMetaPath(sessionId: string): string {
    return join(this.sessionsDir, sessionId, 'session.json');
  }

  /**
   * 載入會話清單（從索引檔讀取）
   */
  async listSessions(): Promise<Session[]> {
    await this.ensureDirs();
    try {
      const content = await fs.readFile(this.indexFile, 'utf8');
      return JSON.parse(content) || [];
    } catch {
      return [];
    }
  }

  /**
   * 寫入會話清單（更新索引檔）
   */
  private async saveIndex(sessions: Session[]): Promise<void> {
    await this.ensureDirs();
    await fs.writeFile(this.indexFile, JSON.stringify(sessions, null, 2), 'utf8');
  }

  /**
   * 載入會話 metadata
   */
  async loadSessionMeta(sessionId: string): Promise<Session | null> {
    await this.ensureDirs();
    const metaPath = this.getMetaPath(sessionId);
    try {
      const content = await fs.readFile(metaPath, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 儲存會話 metadata，並同步更新會話清單索引
   */
  async saveSessionMeta(session: Session): Promise<void> {
    await this.ensureDirs();
    const sessionFolder = join(this.sessionsDir, session.id);
    await fs.mkdir(sessionFolder, { recursive: true });

    // 儲存 session.json
    const metaPath = this.getMetaPath(session.id);
    await fs.writeFile(metaPath, JSON.stringify(session, null, 2), 'utf8');

    // 更新 index.json
    const sessions = await this.listSessions();
    const index = sessions.findIndex(s => s.id === session.id);
    if (index >= 0) {
      sessions[index] = session;
    } else {
      sessions.push(session);
    }
    await this.saveIndex(sessions);
  }

  /**
   * 載入會話的完整歷史訊息 (從 JSONL 檔案中一行行解析)
   */
  async loadMessages(sessionId: string): Promise<Message[]> {
    await this.ensureDirs();
    const messagesPath = this.getMessagesPath(sessionId);
    try {
      const content = await fs.readFile(messagesPath, 'utf8');
      return content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  /**
   * 新增一筆訊息到 JSONL 日誌檔案中
   */
  async appendMessage(sessionId: string, message: Message): Promise<void> {
    await this.ensureDirs();
    const sessionFolder = join(this.sessionsDir, sessionId);
    await fs.mkdir(sessionFolder, { recursive: true });

    const messagesPath = this.getMessagesPath(sessionId);
    const line = JSON.stringify(message) + '\n';
    await fs.appendFile(messagesPath, line, 'utf8');
  }

  /**
   * 重新寫入某會話的所有訊息（例如在執行 compact 或修改歷史時使用）
   */
  async overwriteMessages(sessionId: string, messages: Message[]): Promise<void> {
    await this.ensureDirs();
    const messagesPath = this.getMessagesPath(sessionId);
    const content = messages.map(m => JSON.stringify(m)).join('\n') + (messages.length > 0 ? '\n' : '');
    await fs.writeFile(messagesPath, content, 'utf8');
  }

  /**
   * 刪除會話（包含其實體資料夾與索引中的項目）
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.ensureDirs();
    const sessionFolder = join(this.sessionsDir, sessionId);
    
    // 刪除資料夾
    try {
      await fs.rm(sessionFolder, { recursive: true, force: true });
    } catch {}

    // 自 index.json 移除
    const sessions = await this.listSessions();
    const filtered = sessions.filter(s => s.id !== sessionId);
    await this.saveIndex(filtered);
  }
}
