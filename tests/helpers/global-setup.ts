import { prepareDatabase } from "./db-setup";

export default async function setup(): Promise<void> {
  await prepareDatabase();
}
