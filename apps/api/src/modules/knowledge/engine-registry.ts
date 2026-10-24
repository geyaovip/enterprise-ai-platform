import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Binding } from '../platform/infrastructure-contract';
import type { KnowledgeEngine } from './knowledge-engine';
import { RagflowAdapter } from './ragflow.adapter';
import { NativeKnowledgeAdapter } from './native.adapter';
import { PrismaService } from '../prisma.service';
@Injectable()
export class KnowledgeEngineRegistry {
  private readonly factories = new Map<string, (binding: Binding) => KnowledgeEngine>([['ragflow', binding => new RagflowAdapter(binding)]]);
  constructor(db: PrismaService) { this.factories.set('native', binding => new NativeKnowledgeAdapter(binding, db)); }
  install(provider: string, factory: (binding: Binding) => KnowledgeEngine) { this.factories.set(provider, factory); }
  providers() { return [...this.factories.keys()]; }
  supports(provider: string) { return this.factories.has(provider); }
  create(binding: Binding) { const factory = this.factories.get(binding.provider); if (!factory) throw new ServiceUnavailableException('知识适配器尚未安装'); return factory(binding); }
}
