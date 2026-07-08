import { Session, SessionSettings, Message } from '../types.js';
import { SessionStore } from './session-store.js';
import { expandTilde } from '../tools/base.js';
import crypto from 'node:crypto';

export class SessionManager {
  private store: SessionStore;

  constructor(dataDir?: string) {
    this.store = new SessionStore(dataDir);
  }

  /**
   * 取得所有會話清單
   */
  async listSessions(): Promise<Session[]> {
    return this.store.listSessions();
  }

  /**
   * 建立新會話
   */
  async createSession(
    name: string, 
    workingDirectory: string, 
    settings?: Partial<SessionSettings>
  ): Promise<Session> {
    const id = `sess_${crypto.randomUUID()}`;
    const defaultSettings: SessionSettings = {
      systemPromptTemplate: 'coding-assistant',
      targetModel: 'claude-3-5-sonnet',
      enabledTools: ['read', 'write', 'edit', 'bash'],
      maxOutputLines: 1000,
      bashTimeout: 30,
      ...settings
    };

    const expandedWd = expandTilde(workingDirectory);

    const session: Session = {
      id,
      name: name || `會話 - ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workingDirectory: expandedWd,
      status: 'active',
      settings: defaultSettings
    };

    await this.store.saveSessionMeta(session);
    return session;
  }

  /**
   * 取得會話元資料
   */
  async getSession(sessionId: string): Promise<Session | null> {
    return this.store.loadSessionMeta(sessionId);
  }

  /**
   * 取得會話訊息歷史
   */
  async getMessages(sessionId: string): Promise<Message[]> {
    return this.store.loadMessages(sessionId);
  }

  /**
   * 新增訊息
   */
  async addMessage(sessionId: string, message: Message): Promise<void> {
    await this.store.appendMessage(sessionId, message);
    
    // 更新會話的最後更新時間
    const session = await this.getSession(sessionId);
    if (session) {
      session.updatedAt = Date.now();
      await this.store.saveSessionMeta(session);
    }
  }

  /**
   * 覆寫會話歷史訊息（如進行壓縮或清理）
   */
  async overwriteMessages(sessionId: string, messages: Message[]): Promise<void> {
    await this.store.overwriteMessages(sessionId, messages);
  }

  /**
   * 刪除會話
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.store.deleteSession(sessionId);
  }
}
