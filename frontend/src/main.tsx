import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./style.css";

const appRootElement: HTMLElement | null = document.getElementById("app");

if (appRootElement === null) {
  throw new Error("App root element '#app' was not found.");
}

createRoot(appRootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
