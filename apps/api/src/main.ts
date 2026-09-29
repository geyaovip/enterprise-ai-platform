import 'dotenv/config';
import { createApp } from './server';

async function main() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 4600);
  await app.listen(port, process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
}

void main();
