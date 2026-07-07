import { Session, SessionSettings, Message } from '../types.js';
import { SessionStore } from './session-store.js';
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
      enabledTools: ['read', 'write', 'edit', 'bash', 'search'],
      maxOutputLines: 1000,
      bashTimeout: 30,
      ...settings
    };

    const session: Session = {
      id,
      name: name || `會話 - ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workingDirectory,
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

  /**
   * 從特定歷史訊息位置 (messageId) 分支出一個新的會話
   */
  async branchSession(
    parentSessionId: string, 
    messageId: string, 
    newBranchName: string
  ): Promise<Session> {
    const parentSession = await this.getSession(parentSessionId);
    if (!parentSession) {
      throw new Error(`找不到父會話: ${parentSessionId}`);
    }

    const messages = await this.getMessages(parentSessionId);
    const msgIdx = messages.findIndex(m => m.id === messageId);
    if (msgIdx === -1) {
      throw new Error(`在父會話中找不到目標訊息 ID: ${messageId}`);
    }

    // 截取目標訊息之前的歷史（包含目標訊息本身）
    const branchMessages = messages.slice(0, msgIdx + 1);

    // 建立新會話，繼承父會話屬性
    const branchedSession = await this.createSession(
      newBranchName || `${parentSession.name} - 分支`,
      parentSession.workingDirectory,
      parentSession.settings
    );

    // 將截取的訊息寫入新會話，並將它們的 sessionId 重新設定
    const updatedMessages = branchMessages.map(m => ({
      ...m,
      sessionId: branchedSession.id,
      parentId: parentSessionId // 紀錄來源會話
    }));

    await this.overwriteMessages(branchedSession.id, updatedMessages);

    return branchedSession;
  }
}
