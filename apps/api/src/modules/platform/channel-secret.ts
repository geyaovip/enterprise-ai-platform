import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

function key() {
  const value = Buffer.from(process.env.CHANNEL_ENCRYPTION_KEY ?? '', 'base64');
  if (value.length !== 32) throw new ServiceUnavailableException('渠道加密密钥未配置');
  return value;
}

export function encryptChannelSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64')).join('.');
}

export function decryptChannelSecret(value: string) {
  const parts = value.split('.').map(part => Buffer.from(part, 'base64'));
  if (parts.length !== 3 || parts[0].length !== 12 || parts[1].length !== 16) throw new ServiceUnavailableException('渠道凭据记录无效');
  const decipher = createDecipheriv('aes-256-gcm', key(), parts[0]);
  decipher.setAuthTag(parts[1]);
  return Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString('utf8');
}
