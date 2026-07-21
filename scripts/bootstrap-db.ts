import { applyMigrations } from "./apply-migrations";
import { seedDemoData } from "./seed-demo";

export async function bootstrapDb() {
  await applyMigrations();
  await seedDemoData();
}

if (import.meta.main) {
  bootstrapDb()
    .then(() => {
      console.log("Database bootstrapped");
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
