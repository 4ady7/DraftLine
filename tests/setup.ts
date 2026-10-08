import { beforeEach } from "vitest";
import { getDb } from "@/server/db";

beforeEach(async () => {
  await getDb().project.deleteMany();
});
