/**
 * Script para limpiar profilePicture de entidades cuya URL ya no existe en Image[]
 * Uso: node scripts/fix-stale-profile-picture.js
 */
const prisma = require("../db/database.prisma");

const MODELS_WITH_IMAGES = [
  { model: "user", entityKey: "userId" },
  { model: "product", entityKey: "productId" },
  { model: "client", entityKey: "clientId" },
  { model: "supplier", entityKey: "supplierId" },
  { model: "categories", entityKey: "categoryId" },
];

async function fixStaleProfilePictures() {
  for (const { model, entityKey } of MODELS_WITH_IMAGES) {
    let entities;
    try {
      entities = await prisma[model].findMany({
        where: { profilePicture: { not: null } },
        include: { Image: true },
      });
    } catch (e) {
      console.log(`[SKIP] Model ${model} may not have Image relation or profilePicture: ${e.message}`);
      continue;
    }

    for (const entity of entities) {
      const imageUrls = entity.Image.map((img) => img.url);
      if (entity.Image.length === 0 || !imageUrls.includes(entity.profilePicture)) {
        const newProfilePicture = entity.Image.length > 0 ? entity.Image[0].url : null;
        await prisma[model].update({
          where: { id: entity.id },
          data: { profilePicture: newProfilePicture },
        });
        console.log(
          `[FIXED] ${model} id=${entity.id} | old=${entity.profilePicture} -> new=${newProfilePicture}`
        );
      }
    }
  }
  console.log("✅ Done");
  await prisma.$disconnect();
}

fixStaleProfilePictures().catch((e) => {
  console.error(e);
  process.exit(1);
});
