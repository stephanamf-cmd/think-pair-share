import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/montserrat";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Think · Pair · Share — Network International School",
    template: "%s · Think · Pair · Share",
  },
  description:
    "Live Think-Pair-Share for NIS classrooms. Students post ideas, talk in pairs, then link ideas together on a class graph.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1F3864",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
