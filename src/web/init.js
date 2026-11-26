import "../styles/mobile.css";
import { apiRequest, getClientId, installWebBridge } from "./bridge";
import { createServerStorage } from "./serverStorage";

export async function initWeb() {
  const boot = await apiRequest("/api/bootstrap");
  const storage = createServerStorage({
    initial: boot.storage,
    fixed: { downloadPath: boot.downloadDir, downloaderFolder: boot.downloaderDir },
    post: (change) => apiRequest("/api/storage", { profileId: boot.profileId, clientId: getClientId(), change }),
  });
  const announce = (keys) => window.dispatchEvent(new CustomEvent("streambert:storage-changed", { detail: { keys } }));
  installWebBridge(boot, {
    onStorageChanged: (change) => announce(storage.applyRemote(change)),
    onReconnect: async () => {
      try {
        announce(storage.replace((await apiRequest("/api/bootstrap")).storage));
        await storage.flush();
      } catch {}
    },
  });
  const { setStorageBackend } = await import("../utils/storage");
  setStorageBackend(storage);
  window.addEventListener("pagehide", () => { void storage.flush(); });
  window.addEventListener("online", () => { void storage.flush(); });
}
