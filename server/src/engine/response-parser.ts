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
          // 先嘗試嚴格解析，失敗後嘗試修復常見的 JSON 錯誤（如未跳脫的巢狀引號）
          parsedArgs = JSON.parse(cleanedArgsStr);
        }

        toolCalls.push({
          id: toolId,
          name: toolName,
          arguments: parsedArgs
        });
      } catch (err: any) {
        // 嘗試修復：LLM 常在命令字串內使用未跳脫的引號
        const repaired = this.repairJSON(item.content.trim());
        if (repaired !== null) {
          toolCalls.push({
            id: toolId,
            name: toolName,
            arguments: repaired
          });
        } else {
          parseErrors.push(
            `解析工具 "${toolName}" 的參數失敗。原始參數字串: "${item.content.trim()}"。錯誤原因: ${err.message}`
          );
        }
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

  /**
   * 嘗試修復 LLM 產生的常見 JSON 錯誤：
   * 字串值內出現未跳脫的巢狀引號。
   * 例如：{"command": "git commit -m "my message""}
   * 應修正為：{"command": "git commit -m \"my message\""}
   */
  private repairJSON(str: string): Record<string, any> | null {
    // 嘗試多種修復策略
    const strategies = [
      // 策略 1：對字串值內的所有引號進行跳脫
      () => this.escapeInnerQuotes(str),
      // 策略 2：將最外層的雙引號替換為單引號（僅對簡單情況有效）
      () => {
        const s = str.replace(/:\s*"([^"]*?)"([^,\]}])/g, ': "$1\\"$2');
        return JSON.parse(s);
      },
      // 策略 3：嘗試移除 value 中所有未跳脫的引號
      () => {
        const s = str.replace(/(?<=":\s*"[^"]*)"(?=[^"]*"[,\s\]}])/g, '\\"');
        return JSON.parse(s);
      }
    ];

    for (const strategy of strategies) {
      try {
        const result = strategy();
        return result;
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * 使用狀態機走訪 JSON 字串，標記目前是否在字串值內，
   * 並對 value 內部的未跳脫引號加上反斜線跳脫。
   */
  private escapeInnerQuotes(str: string): Record<string, any> {
    let result = '';
    let inString = false;
    let afterColon = false;
    let escapeNext = false;

    for (let i = 0; i < str.length; i++) {
      const c = str[i];

      if (escapeNext) {
        result += c;
        escapeNext = false;
        continue;
      }

      if (c === '\\' && inString) {
        result += c;
        escapeNext = true;
        continue;
      }

      if (c === '"') {
        if (inString) {
          // 判斷此引號是否為字串結尾（後面是 , ] } 或空白後接這些符號）
          const remaining = str.slice(i + 1);
          const nextNonSpace = remaining.match(/^\s*([,\]}:]|$)/);
          if (nextNonSpace) {
            // 字串結束
            inString = false;
            afterColon = false;
            result += '"';
          } else {
            // 字串內部的巢狀引號 → 跳脫
            result += '\\"';
          }
        } else if (afterColon) {
          // value 的開頭引號
          inString = true;
          afterColon = false;
          result += '"';
        } else {
          result += '"';
        }
        continue;
      }

      if (c === ':' && !inString) {
        // 檢查是否為 key: value 的冒號
        const after = str.slice(i + 1).match(/^\s*"/);
        if (after) {
          afterColon = true;
        }
      } else if (c !== ' ' || inString) {
        afterColon = false;
      }

      result += c;
    }

    return JSON.parse(result);
  }
}
