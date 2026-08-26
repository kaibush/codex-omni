import { useEffect, useState, type FormEvent } from "react";
import { Bot, Check, FolderOpen, KeyRound, Loader2, TerminalSquare } from "lucide-react";
import { api, setCsrf } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeSwitch } from "@/components/theme-switch";

const highlights = [
  { icon: FolderOpen, text: "通过文件夹弹框打开服务器上的工程目录" },
  { icon: TerminalSquare, text: "对话、文件和 Git 在同一个远程工作台里完成" },
  { icon: KeyRound, text: "供应商、模型和运行权限按会话持久保存" }
];

export function Login({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<"loading" | "setup" | "login">("loading");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ setupRequired: boolean }>("/api/auth/status")
      .then((result) => setMode(result.setupRequired ? "setup" : "login"))
      .catch(() => setMode("login"));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "setup") {
        if (password !== confirmPassword) throw new Error("两次输入的密码不一致");
        if (password.length < 8) throw new Error("密码至少 8 位");
      }
      const result = await api<{ csrfToken: string }>(
        mode === "setup" ? "/api/auth/setup" : "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ username, password })
        }
      );
      setCsrf(result.csrfToken);
      onLogin();
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setBusy(false);
    }
  };

  if (mode === "loading") {
    return (
      <main className="grid min-h-svh place-items-center bg-muted/30 text-sm text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </main>
    );
  }

  const isSetup = mode === "setup";
  return (
    <main className="grid min-h-svh bg-muted/30 lg:grid-cols-[minmax(23rem,.85fr)_minmax(32rem,1.15fr)]">
      <section className="relative hidden overflow-hidden border-r bg-[oklch(0.235_0_0)] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,color-mix(in_oklch,var(--primary)_28%,transparent),transparent_35%),radial-gradient(circle_at_80%_75%,oklch(0.7_0.12_163_/_0.16),transparent_32%)]" />
        <div className="relative flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Bot className="size-5" />
          </span>
          <div>
            <div className="font-semibold">Codex Omni</div>
            <div className="text-xs text-zinc-400">远程工程工作台</div>
          </div>
        </div>
        <div className="relative max-w-lg">
          <p className="text-xs font-medium tracking-[0.18em] text-primary uppercase">
            Remote coding workspace
          </p>
          <h1 className="mt-4 text-4xl leading-tight font-semibold tracking-tight xl:text-[2.75rem]">
            把项目、会话和 Codex 运行过程放在一个清晰的工作台。
          </h1>
          <div className="mt-9 space-y-4 text-sm text-zinc-300">
            {highlights.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <span className="flex size-6 items-center justify-center rounded-full bg-primary/20 text-primary-foreground">
                  <Icon className="size-3.5" />
                </span>
                {text}
              </div>
            ))}
          </div>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-zinc-500">
          <Check className="size-3.5" />
          支持本机与公网 IP 访问
        </div>
      </section>

      <section className="relative flex items-center justify-center px-4 py-8 sm:px-8">
        <div className="absolute right-4 top-4">
          <ThemeSwitch />
        </div>
        <Card className="w-full max-w-[28rem] gap-5 border-border/80">
          <CardHeader className="gap-3">
            <div className="mb-2 flex items-center gap-3 lg:hidden">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Bot className="size-5" />
              </span>
              <div>
                <div className="font-semibold">Codex Omni</div>
                <div className="text-xs text-muted-foreground">远程工程工作台</div>
              </div>
            </div>
            <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
              {isSetup ? "First-time setup" : "Sign in"}
            </p>
            <CardTitle className="text-2xl">{isSetup ? "设置管理员账户" : "登录工作台"}</CardTitle>
            <CardDescription>
              {isSetup
                ? "当前还没有账户。设置完成后即可通过本机或公网 IP 访问。"
                : "使用已创建的账户登录远程工程工作台。"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" method="post" onSubmit={submit}>
              <div className="grid gap-2">
                <Label htmlFor="username">账户</Label>
                <Input
                  id="username"
                  name="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoFocus
                  autoComplete="username"
                  placeholder={isSetup ? "admin" : ""}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  name="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={isSetup ? "new-password" : "current-password"}
                  placeholder={isSetup ? "至少 8 位" : ""}
                />
              </div>
              {isSetup && (
                <div className="grid gap-2">
                  <Label htmlFor="confirmPassword">确认密码</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    name="confirmPassword"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              )}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button className="mt-1 w-full" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {isSetup ? "创建并登录" : "登录"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
