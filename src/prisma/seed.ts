import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const password = 'supersecret';
  const hash     = await bcrypt.hash(password, 10);

  await prisma.partnerUser.upsert({
    where: { email: 'admin@launcx.com' },
    update: { password: hash, role: 'ADMIN' },
    create: {
      name:     'Admin Launcx',
      email:    'admin@launcx.com',
      password: hash,
      role:     'ADMIN',
      isActive: true,
    }
  });
  console.log('✅ Admin ready: admin@launcx.com / supersecret');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
