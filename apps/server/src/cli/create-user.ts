import path from "node:path";
import { mkdir } from "node:fs/promises";
import { Store } from "@codex-omni/db";
import { createUser, initAuth } from "../auth.js";
import { resolveDatabasePath } from "../database-path.js";
const args = process.argv.slice(2);
const value = (name: string) => args[args.indexOf(name) + 1];
const username = value("--username"),
  password = value("--password");
if (!username || !password || password.length < 8)
  throw new Error("Use --username NAME --password PASSWORD (8+ chars)");
const database = resolveDatabasePath();
await mkdir(path.dirname(database), { recursive: true });
const store = new Store(database);
initAuth(store.db);
await createUser(store.db, username, password, "admin");
console.log(`Created admin ${username}`);
