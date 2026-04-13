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
        <nav className="px-6 py-3">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <Link href="/" className="text-sm font-medium text-zinc-500 hover:text-zinc-900 tracking-tight">
              Cortex
            </Link>
            <div className="flex gap-5 text-xs text-zinc-500">
              <Link href="/contacts" className="hover:text-zinc-700">Contacts</Link>
              <Link href="/rank" className="hover:text-zinc-700">Rank</Link>
              <Link href="/import" className="hover:text-zinc-700">Import</Link>
            </div>
          </div>
        </nav>
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  );
}
