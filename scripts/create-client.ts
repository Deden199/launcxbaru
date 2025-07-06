// scripts/create-client.ts
import { prisma } from '../src/core/prisma';
import crypto from 'crypto';

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error('Usage: ts-node create-client.ts <ClientName>');
    process.exit(1);
  }

  const apiKey = crypto.randomBytes(16).toString('hex');
  const apiSecret = crypto.randomBytes(32).toString('hex');

  const client = await prisma.partnerClient.create({
    data: {
      name,
      apiKey,
      apiSecret,
    },
  });

  console.log('✅ New client created:');
  console.log('  ID       :', client.id);
  console.log('  Name     :', client.name);
  console.log('  API Key  :', client.apiKey);
  console.log('  API Secret:', client.apiSecret);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
