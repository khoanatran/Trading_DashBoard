import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trading Performance Dashboard",
  description: "Comprehensive trading performance analysis dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

