/** Knowledge may be enabled independently without opening business/chat model invocation. */
export function knowledgeModelsEnabled() {
  return (process.env.KNOWLEDGE_MODEL_ENABLED ?? process.env.NATIVE_AI_MODEL_ENABLED) === 'true';
}
