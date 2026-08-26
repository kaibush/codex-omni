import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type Database from "better-sqlite3";
import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string; username: string; role: "admin" | "user" };
    authSessionId?: string;
  }
}
export function initAuth(db: Database.Database) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,role TEXT NOT NULL,created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS login_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,csrf_token TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);`
  );
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function hasUsers(db: Database.Database) {
  return Boolean(db.prepare("SELECT 1 FROM users LIMIT 1").get());
}
export async function createUser(
  db: Database.Database,
  username: string,
  password: string,
  role: "admin" | "user" = "admin"
) {
  const id = randomBytes(12).toString("hex");
  const passwordHash = await hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 1 });
  db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)").run(
    id,
    username,
    passwordHash,
    role,
    Date.now()
  );
  return id;
}
export async function createInitialAdmin(
  db: Database.Database,
  username: string,
  password: string
) {
  const passwordHash = await hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 1 });
  const insert = db.transaction(() => {
    if (hasUsers(db)) return null;
    const id = randomBytes(12).toString("hex");
    db.prepare(
      "INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)"
    ).run(id, username, passwordHash, "admin", Date.now());
    return id;
  });
  return insert();
}
export async function login(db: Database.Database, username: string, password: string) {
  const user = db
    .prepare("SELECT id,username,password_hash as passwordHash,role FROM users WHERE username=?")
    .get(username) as any;
  if (!user || !(await verify(user.passwordHash, password))) return null;
  const token = randomBytes(32).toString("base64url"),
    csrf = randomBytes(24).toString("base64url"),
    id = randomBytes(12).toString("hex");
  db.prepare(
    "INSERT INTO login_sessions(id,user_id,token_hash,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?,?)"
  ).run(id, user.id, digest(token), csrf, Date.now() + 14 * 86400000, Date.now());
  return { token, csrf, user: { id: user.id, username: user.username, role: user.role } };
}
export function authenticate(db: Database.Database) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies.codex_web_session;
    if (!token) {
      reply.code(401).send({ error: "Authentication required" });
      return;
    }
    const row = db
      .prepare(
        "SELECT s.id as sessionId,s.csrf_token as csrf,s.expires_at as expiresAt,u.id,u.username,u.role FROM login_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?"
      )
      .get(digest(token)) as any;
    if (!row || row.expiresAt < Date.now()) {
      reply.code(401).send({ error: "Session expired" });
      return;
    }
    request.user = { id: row.id, username: row.username, role: row.role };
    request.authSessionId = row.sessionId;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers["x-csrf-token"] !== row.csrf
    ) {
      reply.code(403).send({ error: "Invalid CSRF token" });
    }
  };
}
