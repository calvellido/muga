import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { detectLocale, I18nProvider, loadMessages } from "./i18n/index.tsx";
import { RegistryContext } from "./radio/hooks.ts";
import { RadioRegistry, type StorageLike } from "./radio/registry.ts";
import "./styles/app.css";

function browserStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

registerSW({ immediate: true });

const registry = new RadioRegistry({ storage: browserStorage() });
const locale = detectLocale(
  navigator.languages?.length ? navigator.languages : [navigator.language],
);
const messages = await loadMessages(locale);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <I18nProvider locale={locale} messages={messages}>
      <RegistryContext.Provider value={registry}>
        <App />
      </RegistryContext.Provider>
    </I18nProvider>
  </StrictMode>,
);
