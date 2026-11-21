import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/app/providers";
import { ACCENT_BOOT_SCRIPT } from "@/lib/themes";
import { FONT_BOOT_SCRIPT } from "@/lib/fonts";
import { AVATAR_BOOT_SCRIPT } from "@/lib/avatar-shape";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Sussy Tavern", template: "%s · Sussy Tavern" },
  description: "Your private roleplay tavern.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Sussy Tavern", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/favicon-48.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1c1916" },
    { media: "(prefers-color-scheme: light)", color: "#fbf8f3" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${fontVariables} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: ACCENT_BOOT_SCRIPT + FONT_BOOT_SCRIPT + AVATAR_BOOT_SCRIPT }} />
      </head>
      <body className="h-full overflow-hidden">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
