// Fetches an authenticated portal file as a Blob (retries once after refreshing the token).
import { API, ApiError, refreshAccess, sessionHooks, tokens } from "./client";

export async function webFetchBlob(path: string): Promise<Blob> {
  const get = (t: string | null) => fetch(`${API}${path}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  let res = await get(tokens.access);
  if (res.status === 401 && tokens.refresh) {
    try {
      res = await get(await refreshAccess());
    } catch {
      sessionHooks.onExpired();
      throw new ApiError(401, "Your session expired. Please sign in again.");
    }
  }
  if (!res.ok) {
    let msg = res.status === 404 ? "This file is not available yet." : "Could not open the file.";
    try {
      const j = await res.json();
      if (typeof j?.detail === "string") msg = j.detail;
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.blob();
}
