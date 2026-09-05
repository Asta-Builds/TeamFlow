import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { QueryProvider } from "@/lib/providers/query-provider";
import { Toaster } from "sonner";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TeamFlow — Enterprise Multi-Agent Virtual Tech Management",
  description:
    "Autonomous software engineering management platform with LangGraph orchestration, pgvector RAG, and Langfuse tracing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-slate-950 text-slate-100">
        <AuthProvider>
          <QueryProvider>
            {children}
          </QueryProvider>
          <Toaster
            position="top-right"
            richColors
            theme="dark"
            closeButton
            toastOptions={{
              style: {
                background: "#0f172a",
                border: "1px solid #1e293b",
                color: "#f8fafc",
              },
            }}
          />
        </AuthProvider>
      </body>
    </html>
  );
}
