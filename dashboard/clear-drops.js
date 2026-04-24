const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.transaction.deleteMany();
  await prisma.item.deleteMany();
  await prisma.store.deleteMany();
  console.log('Successfully cleared all drops!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
