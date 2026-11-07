export type CapabilityState = { delivered: boolean; enabled: boolean };
export type ExecutionState = { state?: string; managed?: boolean; available?: boolean; enabled?: boolean };

// Configuration and observed runtime state are distinct from a successful model request.
export function executionStatus(state?: ExecutionState, capability?: CapabilityState, invocationEnabled?: boolean): string {
  if (capability && !capability.delivered) return '尚未开通';
  if (capability && !capability.enabled) return '企业未启用';
  if (invocationEnabled === false) return '服务暂未开放';
  if (!state) return '状态待确认';
  if (state.state === 'unavailable') return '状态读取失败';
  if (state.state === 'disabled') return '执行环境已停用';
  if (state.state === 'failed') return '执行环境启动失败';
  if (state.managed && state.available) {
    return ({ ready: '运行中', preparing: '正在启动', queued: '等待资源', suspended: '按需启动', unprovisioned: '首次使用时启动' } as Record<string, string>)[state.state ?? ''] ?? '执行环境已配置';
  }
  return state.enabled || state.available ? '执行环境已配置' : '执行环境未配置';
}
export function knowledgeStatus(configured?: boolean, capability?: CapabilityState): string {
  if (capability && !capability.delivered) return '尚未开通';
  if (capability && !capability.enabled) return '企业未启用';
  return configured === undefined ? '状态待确认' : configured ? '已配置' : '未配置';
}
