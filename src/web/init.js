import "../styles/mobile.css";
import { apiRequest, getClientId, installWebBridge } from "./bridge";
import { createServerStorage } from "./serverStorage";
import { PROFILE_SWITCH_KEY } from "./profiles/profilesApi";

export async function initWeb() {
  window.addEventListener("storage", (event) => {
    if (event.key === PROFILE_SWITCH_KEY) window.location.reload();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });
  let boot;
  try {
    boot = await apiRequest("/api/bootstrap", undefined, { allowPicker: true });
  } catch (error) {
    if (error.code === "profile" || error.status === 401) return { needsProfile: true };
    throw error;
  }
  const storage = createServerStorage({
    initial: boot.storage,
    fixed: { downloadPath: boot.downloadDir, downloaderFolder: boot.downloaderDir },
    post: (change) => apiRequest("/api/storage", { clientId: getClientId(), change }),
  });
  const announce = (keys) => window.dispatchEvent(new CustomEvent("streambert:storage-changed", { detail: { keys } }));
  installWebBridge(boot, {
    flushStorage: storage.flush,
    onStorageChanged: (change) => announce(storage.applyRemote(change)),
    onReconnect: async () => {
      try {
        announce(storage.replace((await apiRequest("/api/bootstrap")).storage));
        await storage.flush();
        window.dispatchEvent(new Event("streambert:downloads-refresh"));
      } catch {}
    },
  });
  const { setStorageBackend } = await import("../utils/storage");
  setStorageBackend(storage);
  window.addEventListener("pagehide", () => { void storage.flush(); });
  window.addEventListener("online", () => { void storage.flush(); });
  return { needsProfile: false };
}
