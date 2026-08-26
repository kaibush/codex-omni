export type CliStartOptions = {
  host?: string;
  port?: string;
  data?: string;
  origin?: string;
  staticDir?: string;
};

export type CliCommand =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "start"; options: CliStartOptions }
  | { kind: "user-create"; username: string; password: string }
  | { kind: "error"; message: string };

function takeValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} 需要参数`);
  }
  return { value, consumed: 2 };
}

export function parseCliArgs(argv: string[]): CliCommand {
  const args = argv.slice(2);
  try {
    if (args.length === 0) return { kind: "start", options: {} };
    const first = args[0] ?? "";
    if (first === "-h" || first === "--help" || first === "help") return { kind: "help" };
    if (first === "-v" || first === "--version" || first === "version") return { kind: "version" };

    if (first === "user") {
      const action = args[1];
      if (action !== "create") {
        return { kind: "error", message: "用法: codex-omni user create --username NAME --password PASSWORD" };
      }
      let username = "";
      let password = "";
      for (let index = 2; index < args.length; ) {
        const flag = args[index] ?? "";
        if (flag === "--username" || flag === "--password") {
          const taken = takeValue(args, index, flag);
          if (flag === "--username") username = taken.value;
          else password = taken.value;
          index += taken.consumed;
          continue;
        }
        return { kind: "error", message: `未知参数 ${flag}` };
      }
      if (!username || !password || password.length < 8) {
        return {
          kind: "error",
          message: "用法: codex-omni user create --username NAME --password PASSWORD（密码至少 8 位）"
        };
      }
      return { kind: "user-create", username, password };
    }

    const startArgs = first === "start" ? args.slice(1) : args;
    if (first !== "start" && !first.startsWith("-")) {
      return { kind: "error", message: `未知命令 ${first}` };
    }
    const options: CliStartOptions = {};
    for (let index = 0; index < startArgs.length; ) {
      const flag = startArgs[index] ?? "";
      if (flag === "-h" || flag === "--help") return { kind: "help" };
      if (flag === "-v" || flag === "--version") return { kind: "version" };
      if (flag === "--host" || flag === "--port" || flag === "--data" || flag === "--origin" || flag === "--static") {
        const taken = takeValue(startArgs, index, flag);
        if (flag === "--host") options.host = taken.value;
        if (flag === "--port") options.port = taken.value;
        if (flag === "--data") options.data = taken.value;
        if (flag === "--origin") options.origin = taken.value;
        if (flag === "--static") options.staticDir = taken.value;
        index += taken.consumed;
        continue;
      }
      return { kind: "error", message: `未知参数 ${flag}` };
    }
    return { kind: "start", options };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

export function applyStartOptions(options: CliStartOptions) {
  if (options.host) process.env.CODEX_OMNI_HOST = options.host;
  if (options.port) process.env.CODEX_OMNI_PORT = options.port;
  if (options.data) process.env.CODEX_OMNI_DATABASE = options.data;
  if (options.origin) process.env.CODEX_OMNI_ORIGIN = options.origin;
  if (options.staticDir) process.env.CODEX_OMNI_STATIC = options.staticDir;
}

export const CLI_HELP = `Codex Omni

用法:
  codex-omni [start] [选项]
  codex-omni user create --username NAME --password PASSWORD

选项:
  --host <addr>     监听地址，默认 0.0.0.0
  --port <port>     端口，默认 8790
  --data <file>     SQLite 路径，默认 ./data/codex-omni.db
  --origin <url>    CORS Origin 白名单，逗号分隔
  --static <dir>    前端静态目录；不传则自动使用打包内的 public
  -h, --help        显示帮助
  -v, --version     显示版本

示例:
  npx @kaibush/codex-omni
  codex-omni start --port 8790
  codex-omni user create --username admin --password 'change-this-password'
`;
