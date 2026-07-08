import { Message, Session, ToolDefinition } from '../types.js';

export interface AssembledPrompt {
  fullText: string;
  sections: {
    systemPrompt: string;
    toolDescriptions: string;
    conversationHistory: string;
    currentRequest: string;
  };
  promptSources: {
    systemPrompt: string;
    agentsMd?: string;
    skills?: string;
  };
  estimatedTokens: number;
}

export class PromptAssembler {
  /**
   * 估算 Token 數
   */
  estimateTokens(text: string): number {
    let tokens = 0;
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      if (charCode > 127) {
        // 非 ASCII 字元（如中文），大約 1 個字元 0.67 token (1.5 字元 1 token)
        tokens += 0.67;
      } else {
        // ASCII 字元（如英文與程式碼），大約 1 個字元 0.3 token (3 字元 1 token)
        tokens += 0.3;
      }
    }
    return Math.ceil(tokens);
  }

  /**
   * 產生工具描述區塊
   */
  generateToolDescriptions(tools: ToolDefinition[]): string {
    return tools.map(t => {
      const paramsList = Object.entries(t.parameters.properties || {})
        .map(([name, schema]: [string, any]) => {
          const isRequired = (t.parameters.required || []).includes(name);
          return `- **${name}** (${schema.type}, ${isRequired ? 'required' : 'optional'}): ${schema.description || ''}`;
        })
        .join('\n');

      return `### ${t.name}\n${t.description}\n\nParameters:\n${paramsList || 'No parameters'}`;
    }).join('\n\n');
  }

  /**
   * 格式化對話歷史
   */
  formatHistory(messages: Message[]): string {
    if (messages.length === 0) return '';

    const formattedParts: string[] = [];

    for (const msg of messages) {
      switch (msg.role) {
        case 'user':
          formattedParts.push(`User: ${msg.content}`);
          break;
        case 'llm_response':
          let responseText = `Assistant: ${msg.parsedContent.textContent}`;
          if (msg.parsedContent.toolCalls.length > 0) {
            responseText += '\n\nInitiated tool calls:';
            for (const call of msg.parsedContent.toolCalls) {
              responseText += `\n<tool_call name="${call.name}" id="${call.id}">\n${JSON.stringify(call.arguments, null, 2)}\n</tool_call>`;
            }
          }
          formattedParts.push(responseText);
          break;
        case 'tool_result':
          const status = msg.isError ? 'error' : 'success';
          const resultObj = {
            toolCallId: msg.toolCallId,
            toolName: msg.toolName,
            status: status,
            content: msg.content
          };
          formattedParts.push(
            `<tool_result>\n${JSON.stringify(resultObj, null, 2)}\n</tool_result>`
          );
          break;
        case 'system':
          formattedParts.push(`System Notice: [${msg.level.toUpperCase()}] ${msg.content}`);
          break;
        default:
          break;
      }
    }

    return formattedParts.join('\n\n');
  }

  /**
   * 組裝提示詞
   */
  assemble(
    session: Session,
    messages: Message[],
    tools: ToolDefinition[],
    templateContent: string,
    agentsMdContent?: string,
    skillsContent?: string
  ): AssembledPrompt {
    const cwd = session.workingDirectory;
    const date = new Date().toISOString().split('T')[0];
    const os = process.platform;
    
    const toolDescriptions = this.generateToolDescriptions(tools);

    // 1. 組裝系統提示詞（不含 AGENTS.md 與 Skills，它們獨立顯示）
    let systemPrompt = templateContent
      .replace(/{cwd}/g, cwd)
      .replace(/{date}/g, date)
      .replace(/{os}/g, os)
      .replace(/{tool_descriptions}/g, toolDescriptions);

    const hasAgentsMd = !!agentsMdContent;
    const hasSkills = !!skillsContent;

    // 2. 歷史與最新請求分離
    // 我們將最後一個訊息視為「當前請求」（除非它是 assembled_prompt 或 system_notice 等）
    // 如果最後幾條是工具執行結果（在並行執行的情況下），則把它們全部作為當前請求。
    let historyMessages: Message[] = [];
    let currentRequestMessages: Message[] = [];

    // 從後往前找出所有連續的 tool_result 作為當前請求的一部分
    let idx = messages.length - 1;
    while (idx >= 0 && messages[idx].role === 'tool_result') {
      currentRequestMessages.unshift(messages[idx]);
      idx--;
    }

    // 如果最後不是 tool_result，且有至少一條訊息，就把最後那一條作為當前請求
    if (currentRequestMessages.length === 0 && messages.length > 0) {
      currentRequestMessages.push(messages[messages.length - 1]);
      historyMessages = messages.slice(0, messages.length - 1);
    } else {
      historyMessages = messages.slice(0, idx + 1);
    }

    const conversationHistory = this.formatHistory(historyMessages);
    const currentRequest = this.formatHistory(currentRequestMessages);

    // 3. 組合全文
    const fullTextParts = [
      systemPrompt,
      agentsMdContent ? `--- AGENTS.md ---\n\n${agentsMdContent}` : '',
      skillsContent ? `--- SKILLS ---\n\n${skillsContent}` : '',
      conversationHistory ? `--- CONVERSATION HISTORY & CONTEXT ---\n\n${conversationHistory}` : '',
      currentRequest ? `--- CURRENT STATUS / LATEST RESULTS ---\n\n${currentRequest}\n\nPlease proceed based on the latest status above, or reply with your final answer.` : ''
    ].filter(Boolean);

    const fullText = fullTextParts.join('\n\n========================================\n\n');
    const estimatedTokens = this.estimateTokens(fullText);

    return {
      fullText,
      sections: {
        systemPrompt,
        toolDescriptions,
        conversationHistory,
        currentRequest
      },
      promptSources: {
        systemPrompt,
        ...(hasAgentsMd ? { agentsMd: agentsMdContent } : {}),
        ...(hasSkills ? { skills: skillsContent } : {})
      },
      estimatedTokens
    };
  }
}
