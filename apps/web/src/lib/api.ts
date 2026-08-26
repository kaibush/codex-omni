let csrf = "";
export const setCsrf = (value: string) => {
  csrf = value;
};
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (csrf) headers.set("x-csrf-token", csrf);
  if (init.body != null && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? data.error ?? `HTTP ${response.status}`);
  return data as T;
}
export const wsUrl = () =>
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`;
export const terminalWsUrl = () =>
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal/ws`;

export async function apiUpload<T>(url: string, body: BodyInit): Promise<T> {
  const headers = new Headers();
  if (csrf) headers.set("x-csrf-token", csrf);
  headers.set("content-type", "application/octet-stream");
  const response = await fetch(url, {
    method: "PUT",
    credentials: "include",
    headers,
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      (data as { message?: string }).message ??
        (data as { error?: string }).error ??
        `HTTP ${response.status}`
    );
  return data as T;
}

export async function apiDownload(url: string, filename: string) {
  const headers = new Headers();
  if (csrf) headers.set("x-csrf-token", csrf);
  const response = await fetch(url, { credentials: "include", headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      (data as { message?: string }).message ??
        (data as { error?: string }).error ??
        `HTTP ${response.status}`
    );
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
