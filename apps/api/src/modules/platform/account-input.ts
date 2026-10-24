import { z } from 'zod';
export const accountInput = z.string().trim().toLowerCase().min(4).max(40).regex(/^[a-z0-9][a-z0-9_-]*$/, '账号须为 4–40 位字母、数字、下划线或短横线');
export const identityInput = z.string().trim().pipe(z.union([z.email(), accountInput])).transform(value => value.trim().toLowerCase());
export const identityWhere = (value: string) => value.includes('@') ? { email: value.toLowerCase() } : { account: value.toLowerCase() };
