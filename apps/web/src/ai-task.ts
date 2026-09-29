import { api, aiApi } from './api';

type Task<T> = { id: string; status: string; result?: T; errorCode?: string };

export async function runAiTask<T>(tenantKey: string, kind: 'analyze' | 'extract', input: unknown): Promise<T> {
  const base = aiApi(tenantKey, '/tasks');
  const task = await api.post<Task<T>>(base, { kind, input });
  for (let attempt = 0; attempt < 90; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const latest = await api.get<Task<T>>(`${base}/${task.id}`);
    if (latest.status === 'completed') {
      if (latest.result === undefined || latest.result === null) throw new Error('AI 任务完成但没有结果');
      return latest.result;
    }
    if (latest.status === 'failed') throw new Error(`AI 任务未完成（${latest.errorCode ?? 'UNKNOWN'}），请核对模型配置后重试`);
  }
  throw new Error('AI 任务仍在处理中，请稍后重试或联系管理员');
}
