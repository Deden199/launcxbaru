import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const [ name, email, plainPwd, role ] = process.argv.slice(2);
  if (!name || !email || !plainPwd || !role) {
    console.error('Usage: ts-node scripts/create-admin-user.ts <name> <email> <password> <role>');
    process.exit(1);
  }

  const hashed = await bcrypt.hash(plainPwd, 10);
  const user = await prisma.partnerUser.create({
    data: { name, email, password: hashed, role, isActive: true }
  });

  console.log('✅ Admin user created:', { id: user.id, name: user.name, email: user.email, role: user.role });
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
