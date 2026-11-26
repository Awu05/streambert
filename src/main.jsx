import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import "./styles/global.css";

async function start() {
  if (import.meta.env.MODE === "web") {
    const { initWeb } = await import("./web/init");
    await initWeb();
    // i18n picked its language before server storage was ready; apply the saved one.
    const [{ default: i18n, resolveLanguage }, { storage, STORAGE_KEYS }] =
      await Promise.all([import("./i18n"), import("./utils/storage")]);
    await i18n.changeLanguage(resolveLanguage(storage.get(STORAGE_KEYS.UI_LANG)));
  }
  const { default: App } = await import("./App");
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode><App /></React.StrictMode>,
  );
}

start().catch((error) => {
  console.error(error);
  const root = document.getElementById("root");
  root.textContent = "Streambert could not start. Reload to try again.";
});
