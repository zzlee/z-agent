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
    
    // 正則表達式匹配 <tool_call name="name">JSON_ARGS</tool_call>
    // 支援單引號、雙引號，以及可能出現的多餘空白字元
    const toolCallRegex = /<tool_call\s+name=(['"])(.*?)\1\s*>([\s\S]*?)<\/tool_call>/gi;
    
    let textContent = rawResponse;
    let match: RegExpExecArray | null;
    
    // 為了避免 RegExp 的 state 問題，我們使用一個新正則在迴圈中匹配
    const matches: Array<{ fullMatch: string; name: string; content: string }> = [];
    
    while ((match = toolCallRegex.exec(rawResponse)) !== null) {
      matches.push({
        fullMatch: match[0],
        name: match[2],
        content: match[3]
      });
    }

    let callIdCounter = 1;

    for (const item of matches) {
      // 從文字內容中移除工具呼叫區塊，保留單純的對話文字
      textContent = textContent.replace(item.fullMatch, '');

      try {
        const cleanedArgsStr = item.content.trim();
        let parsedArgs: Record<string, any> = {};
        
        if (cleanedArgsStr) {
          parsedArgs = JSON.parse(cleanedArgsStr);
        }

        toolCalls.push({
          id: `call_${Date.now()}_${callIdCounter++}`,
          name: item.name.trim(),
          arguments: parsedArgs
        });
      } catch (err: any) {
        parseErrors.push(
          `解析工具 "${item.name}" 的參數失敗。原始參數字串: "${item.content.trim()}"。錯誤原因: ${err.message}`
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
