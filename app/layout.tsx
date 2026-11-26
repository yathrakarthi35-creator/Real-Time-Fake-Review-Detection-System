import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrustGuard AI | Real-Time Fake Review Detection System",
  description:
    "Real-time e-commerce review fraud detection platform with SSE streaming, TF-IDF + 16 behavioral NLP signals, near-duplicate botnet detection, and live moderation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen transition-colors duration-200">{children}</body>
    </html>
  );
}
