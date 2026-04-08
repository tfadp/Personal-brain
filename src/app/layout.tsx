import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cortex",
  description: "Personal knowledge and network intelligence",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-white text-zinc-900">
        <nav className="border-b border-zinc-200 px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Cortex
            </Link>
            <div className="flex gap-6 text-sm text-zinc-600">
              <Link href="/contacts" className="hover:text-zinc-900">
                Contacts
              </Link>
              <Link href="/import" className="hover:text-zinc-900">
                Import
              </Link>
            </div>
          </div>
        </nav>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
