import { prepareDatabase } from "../../helpers/db-setup";

export default async function globalSetup(): Promise<void> {
  await prepareDatabase();
}
