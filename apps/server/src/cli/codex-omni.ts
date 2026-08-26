#!/usr/bin/env node
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "@codex-omni/db";
import { createUser, initAuth } from "../auth.js";
import { applyStartOptions, CLI_HELP, parseCliArgs } from "./args.js";
import { resolveDatabasePath } from "../database-path.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function readVersion() {
  const pkgPath = path.resolve(here, "../../package.json");
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

async function createAdmin(username: string, password: string) {
  const database = resolveDatabasePath();
  await mkdir(path.dirname(database), { recursive: true });
  const store = new Store(database);
  initAuth(store.db);
  await createUser(store.db, username, password, "admin");
  store.db.close();
  console.log(`已创建管理员 ${username}`);
}

const command = parseCliArgs(process.argv);
if (command.kind === "help") {
  console.log(CLI_HELP.trimEnd());
  process.exit(0);
}
if (command.kind === "version") {
  console.log(await readVersion());
  process.exit(0);
}
if (command.kind === "error") {
  console.error(command.message);
  process.exit(1);
}
if (command.kind === "user-create") {
  await createAdmin(command.username, command.password);
  process.exit(0);
}

applyStartOptions(command.options);
await import("../index.js");
