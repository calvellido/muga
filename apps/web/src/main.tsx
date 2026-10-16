import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { loadPreferences, PreferencesProvider } from "./preferences.tsx";
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

const storage = browserStorage();
const registry = new RadioRegistry({ storage });
const preferences = await loadPreferences(storage);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <PreferencesProvider storage={storage} initial={preferences}>
      <RegistryContext.Provider value={registry}>
        <App />
      </RegistryContext.Provider>
    </PreferencesProvider>
  </StrictMode>,
);
