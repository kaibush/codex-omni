import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/context/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import "@/styles/index.css";

const syncViewportHeight = () => {
  const height = window.visualViewport?.height ?? window.innerHeight;
  if (Number.isFinite(height) && height > 0) {
    document.documentElement.style.setProperty("--app-viewport-height", `${height}px`);
  }
};

syncViewportHeight();
window.visualViewport?.addEventListener("resize", syncViewportHeight);
window.addEventListener("resize", syncViewportHeight);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { staleTime: 5000, gcTime: 30_000, retry: 1 } } })}
    >
      <ThemeProvider>
        <TooltipProvider>
          <BrowserRouter>
            <App />
            <Toaster />
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
