CREATE TABLE `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`subject` text NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`time` text,
	`content` text,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_exams_owner_date` ON `exams` (`owner`,`date`);