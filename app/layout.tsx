import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Real-Time Fake Review Detection System",
  description:
    "Production-ready real-time fake review detector powered by FastAPI, Scikit-learn TF-IDF + Behavioral Feature Engineering, and Next.js on Vercel.",
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
