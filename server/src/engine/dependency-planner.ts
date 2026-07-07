import { ToolCallMessage, ExecutionPlan } from '../types.js';
import { resolve, normalize } from 'node:path';

/**
 * 分析多個工具呼叫之間的依賴關係，並生成一個包含多個 Stage 的執行計畫。
 * 在同一個 Stage 內的工具呼叫可以安全地並行執行。
 */
export class DependencyPlanner {
  
  /**
   * 取得工具呼叫所操作的標準化絕對路徑。
   * 如果工具不操作特定檔案（如 bash），回傳 null。
   */
  private getTargetPath(toolName: string, args: Record<string, any>, workingDir: string): string | null {
    if (!args || !args.path) return null;
    try {
      return normalize(resolve(workingDir, args.path));
    } catch {
      return null;
    }
  }

  /**
   * 判斷某工具是否為寫入/修改型操作
   */
  private isWriteOperation(toolName: string): boolean {
    return toolName === 'write' || toolName === 'edit';
  }

  /**
   * 判斷某工具是否為讀取型操作
   */
  private isReadOperation(toolName: string): boolean {
    return toolName === 'read' || toolName === 'search';
  }

  /**
   * 分析並生成執行計畫
   * @param toolCalls 需要執行的工具呼叫列表（按 LLM 回傳的原始順序）
   * @param workingDir 目前工作目錄
   */
  generatePlan(toolCalls: ToolCallMessage[], workingDir: string): ExecutionPlan {
    if (toolCalls.length === 0) {
      return { stages: [] };
    }

    const n = toolCalls.length;
    // dependencies[j] 記錄第 j 個工具呼叫所依賴的先前工具呼叫的索引集合
    const dependencies: Set<number>[] = Array.from({ length: n }, () => new Set<number>());

    // 建立依賴關係
    // 因為工具原本有順序（由 0 到 n-1），我們只會建立 j -> i (j > i) 的依賴，這保證是 DAG
    for (let j = 0; j < n; j++) {
      const callJ = toolCalls[j];
      const pathJ = this.getTargetPath(callJ.toolName, callJ.arguments, workingDir);

      for (let i = 0; i < j; i++) {
        const callI = toolCalls[i];
        const pathI = this.getTargetPath(callI.toolName, callI.arguments, workingDir);

        let hasDependency = false;

        // 規則 1：Bash 命令是黑盒子屏障。
        // 如果先前有 bash (i)，或者當前是 bash (j)，則 j 必須依賴 i。
        if (callI.toolName === 'bash' || callJ.toolName === 'bash') {
          hasDependency = true;
        }

        // 規則 2：相同檔案的路徑衝突。
        if (!hasDependency && pathI && pathJ && pathI === pathJ) {
          // 如果至少有一個是寫入操作，則有依賴關係
          if (this.isWriteOperation(callI.toolName) || this.isWriteOperation(callJ.toolName)) {
            hasDependency = true;
          }
        }

        if (hasDependency) {
          dependencies[j].add(i);
        }
      }
    }

    // 將節點進行分組 Stage 處理
    const stages: { stageIndex: number; toolCalls: ToolCallMessage[] }[] = [];
    const processed = new Set<number>();
    let currentStageIndex = 1;

    while (processed.size < n) {
      const stageCalls: ToolCallMessage[] = [];
      const stageIndices: number[] = [];

      for (let j = 0; j < n; j++) {
        if (processed.has(j)) continue;

        // 檢查 j 的所有依賴是否都已經被處理（分配到先前的 Stage 中）
        let allDependenciesMet = true;
        for (const dep of dependencies[j]) {
          if (!processed.has(dep)) {
            allDependenciesMet = false;
            break;
          }
        }

        if (allDependenciesMet) {
          stageCalls.push(toolCalls[j]);
          stageIndices.push(j);
        }
      }

      if (stageCalls.length === 0) {
        // 理論上因為是 DAG，不可能死結。如果發生，就安全地把剩下的一股腦依序放入
        for (let j = 0; j < n; j++) {
          if (!processed.has(j)) {
            stages.push({
              stageIndex: currentStageIndex++,
              toolCalls: [toolCalls[j]]
            });
            processed.add(j);
          }
        }
        break;
      }

      stages.push({
        stageIndex: currentStageIndex++,
        toolCalls: stageCalls
      });

      for (const idx of stageIndices) {
        processed.add(idx);
      }
    }

    return { stages };
  }
}
