import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Binding } from '../platform/infrastructure-contract';
import type { AgentRuntime } from './agent.runtime';
import { OpenClawAdapter } from './openclaw.adapter';
@Injectable()
export class RuntimeAdapterRegistry {
  private readonly factories = new Map<string, (binding: Binding) => AgentRuntime>([['openclaw', binding => new OpenClawAdapter(binding)]]);
  install(provider: string, factory: (binding: Binding) => AgentRuntime) { this.factories.set(provider, factory); }
  providers() { return [...this.factories.keys()]; }
  supports(provider: string) { return this.factories.has(provider); }
  create(binding: Binding) { const factory = this.factories.get(binding.provider); if (!factory) throw new ServiceUnavailableException('执行适配器尚未安装'); return factory(binding); }
}
