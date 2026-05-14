import "./global.css";

import { RootProvider } from "fumadocs-ui/provider";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: {
    default: "GemmaPod docs",
    template: "%s · GemmaPod docs",
  },
  description:
    "Composable, portable AI agent capsules — signed HTML+JS+WASM blobs you can email, embed, or deploy. Build with the GemmaPodRuntime SDK over DARTC.",
  metadataBase: new URL("https://docs.gemmapod.com"),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
