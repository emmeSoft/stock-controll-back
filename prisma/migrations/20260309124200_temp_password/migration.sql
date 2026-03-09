-- AlterTable
ALTER TABLE `user` ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `tempPassword` VARCHAR(191) NULL;
