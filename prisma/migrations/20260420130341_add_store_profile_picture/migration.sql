-- AlterTable
ALTER TABLE "Image" ADD COLUMN     "storeId" TEXT;

-- AlterTable
ALTER TABLE "store" ADD COLUMN     "profilePicture" TEXT;

-- AddForeignKey
ALTER TABLE "Image" ADD CONSTRAINT "Image_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
