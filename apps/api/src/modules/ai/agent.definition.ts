import type { RequestContext } from '../platform/context';

export type AgentDefinition = {
  id: string;
  appId: string;
  usePermission: string;
  skillIds: readonly string[];
  instructions: string;
};

export type SkillDefinition = {
  id: string;
  appId: string;
  agentId: string;
  purpose: string;
  evidence: string;
};

export type AIExecutionContext = {
  request: RequestContext;
  sessionId: string;
  currentResource?: { appId: string; type: string; id: string; version?: number };
};

