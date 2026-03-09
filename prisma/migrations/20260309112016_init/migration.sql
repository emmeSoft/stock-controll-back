-- AlterTable
ALTER TABLE `cashregister` ADD COLUMN `observation` TEXT NULL;

-- AlterTable
ALTER TABLE `order` ADD COLUMN `userId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `order` ADD CONSTRAINT `order_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
