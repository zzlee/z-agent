import { ToolCallData } from '../types.js';

interface ParsedResponse {
  textContent: string;
  toolCalls: ToolCallData[];
  parseErrors: string[];
}

export class ResponseParser {
  /**
   * 解析 LLM 回應，提取文字說明與工具呼叫
   */
  parse(rawResponse: string): ParsedResponse {
    const toolCalls: ToolCallData[] = [];
    const parseErrors: string[] = [];
    
    // 正則表達式匹配 <tool_call ...>JSON_ARGS</tool_call>
    const toolCallRegex = /<tool_call([\s\S]*?)>([\s\S]*?)<\/tool_call>/gi;
    
    let textContent = rawResponse;
    let match: RegExpExecArray | null;
    
    const matches: Array<{ fullMatch: string; attrs: string; content: string }> = [];
    
    while ((match = toolCallRegex.exec(rawResponse)) !== null) {
      matches.push({
        fullMatch: match[0],
        attrs: match[1],
        content: match[2]
      });
    }

    let callIdCounter = 1;

    for (const item of matches) {
      // 從文字內容中移除工具呼叫區塊，保留單純的對話文字
      textContent = textContent.replace(item.fullMatch, '');

      const nameMatch = /name=(['"])(.*?)\1/i.exec(item.attrs);
      const idMatch = /id=(['"])(.*?)\1/i.exec(item.attrs);
      
      const toolName = nameMatch ? nameMatch[2].trim() : '';
      const toolId = idMatch ? idMatch[2].trim() : `call_${Date.now()}_${callIdCounter++}`;

      try {
        const cleanedArgsStr = item.content.trim();
        let parsedArgs: Record<string, any> = {};
        
        if (cleanedArgsStr) {
          parsedArgs = JSON.parse(cleanedArgsStr);
        }

        toolCalls.push({
          id: toolId,
          name: toolName,
          arguments: parsedArgs
        });
      } catch (err: any) {
        parseErrors.push(
          `解析工具 "${toolName}" 的參數失敗。原始參數字串: "${item.content.trim()}"。錯誤原因: ${err.message}`
        );
      }
    }

    // 清理多餘的空白與換行
    textContent = textContent
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return {
      textContent,
      toolCalls,
      parseErrors
    };
  }
}
