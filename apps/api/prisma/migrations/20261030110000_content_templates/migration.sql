ALTER TABLE "ContentDocument" DROP CONSTRAINT "ContentDocument_kind_check";
ALTER TABLE "ContentDocument" ADD CONSTRAINT "ContentDocument_kind_check" CHECK ("kind" IN ('brand','product','template'));
