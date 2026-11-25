import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/global.css";

async function start() {
  if (import.meta.env.MODE === "web") {
    const { initWeb } = await import("./web/init");
    await initWeb();
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
