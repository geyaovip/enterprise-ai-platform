import { ServiceUnavailableException } from '@nestjs/common';
export const AI_NOT_OPEN_MESSAGE='AI 服务暂未开放，你可以先使用应用内的业务功能。';
export function nativeModelsEnabled(){return process.env.NATIVE_AI_MODEL_ENABLED==='true';}

export function assertNativeModelsEnabled(){
  if(!nativeModelsEnabled())throw new ServiceUnavailableException({code:'AI_NOT_OPEN',message:AI_NOT_OPEN_MESSAGE});
}
