import type { TerminalProfile } from "@/types";

export function defaultTerminalProfileId(profiles: Array<Pick<TerminalProfile, "id">>) {
  return profiles.find((profile) => profile.id === "shell")?.id ?? profiles[0]?.id ?? "";
}

export function terminalProfileCommandLabel(command: string) {
  const trimmed = command.trim();
  return trimmed || "登录 Shell";
}
