import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PublicRecipePage, { shareTokenFrom } from "./components/share/PublicRecipePage";
import "./index.css";
import { keepPasswordManagersAway } from "./passwordManagers";
import { applyTheme, currentTheme } from "./themes";

applyTheme(currentTheme().id); // the theme and light/dark mode last used in this browser, before anything draws
// Shared from another app (Android's share sheet sends ?url=&text=&title=): open the import
const shared = new URLSearchParams(window.location.search);
const sharedText = shared.get("url") || shared.get("text") || shared.get("title");
if (sharedText) history.replaceState(null, "", `/#/recipes?import=${encodeURIComponent([shared.get("url"), shared.get("text")].filter(Boolean).join(" ") || sharedText)}`);

// /share/rcp_…: a recipe someone shared, for anyone (no sign-in, none of the app)
const shareToken = shareTokenFrom(window.location.pathname);
const root = document.getElementById("root")!;
keepPasswordManagersAway(document.body); // only the sign-in forms should offer to save passwords (body: popups live outside #root)
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {shareToken ? <PublicRecipePage token={shareToken} /> : <App />}
  </React.StrictMode>
);
