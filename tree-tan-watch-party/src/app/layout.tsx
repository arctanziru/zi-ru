import type { Metadata } from "next";
import { Bree_Serif, Nunito } from "next/font/google";
import { FarmDecorations } from "@/components/farm-decorations";
import "./globals.css";

const cozySans = Nunito({
  variable: "--font-cozy-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const cozyDisplay = Bree_Serif({
  variable: "--font-cozy-display",
  weight: ["400"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tree-Tan Watch Party",
  description: "Cozy anime watch-party app with synced playback rooms",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${cozySans.variable} ${cozyDisplay.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div aria-hidden className="farm-backdrop" />
        <FarmDecorations />
        <div className="relative z-10 flex min-h-full flex-col">{children}</div>
      </body>
    </html>
  );
}
