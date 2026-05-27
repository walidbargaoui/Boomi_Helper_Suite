import { prisma, seedSampleProject } from "../src/lib/db";

async function main() {
  await seedSampleProject();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
