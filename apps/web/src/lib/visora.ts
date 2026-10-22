type VisoraUser = {
  id: string | number;
  name?: string | null;
  email?: string | null;
};

let latestUser: VisoraUser | null | undefined;
let waitingForTracker = false;

function applyUser() {
  waitingForTracker = false;
  if (latestUser !== undefined) window.visora?.identify(latestUser);
}

/** undefined 表示登录状态尚未确定；null 表示已确认匿名。 */
export function syncVisoraUser(user: VisoraUser | null | undefined) {
  if (typeof window === "undefined" || user === undefined) return;
  if (user === null) {
    latestUser = null;
  } else {
    const next: VisoraUser = { id: user.id };
    if (user.name != null) next.name = user.name;
    if (user.email != null) next.email = user.email;
    latestUser = next;
  }
  if (window.visora) {
    applyUser();
  } else if (!waitingForTracker) {
    waitingForTracker = true;
    window.addEventListener("visora:ready", applyUser, { once: true });
  }
}

declare global {
  interface Window {
    visora?: {
      disabled: boolean;
      pageview(): void;
      track(name: string): void;
      identify(user: VisoraUser | null): boolean;
      reset(): void;
    };
  }
}
