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
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://teamflow.dev"),
  title: {
    default: "TeamFlow — Enterprise Multi-Agent Virtual Tech Management",
    template: "%s | TeamFlow",
  },
  description:
    "Autonomous software engineering management platform with LangGraph orchestration, pgvector RAG, and Langfuse tracing.",
  keywords: [
    "AI agents",
    "virtual tech company",
    "LangGraph",
    "pgvector",
    "Kanban",
    "software engineering",
    "autonomous devops",
  ],
  authors: [{ name: "TeamFlow Core Architecture Guild" }],
  openGraph: {
    title: "TeamFlow — Enterprise Multi-Agent Virtual Tech Management",
    description:
      "Autonomous software engineering management platform with LangGraph orchestration, pgvector RAG, and Langfuse tracing.",
    url: "https://teamflow.dev",
    siteName: "TeamFlow",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TeamFlow — Enterprise Multi-Agent Virtual Tech Management",
    description:
      "Autonomous software engineering management platform with LangGraph orchestration, pgvector RAG, and Langfuse tracing.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-slate-950 text-slate-100">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-lg focus:shadow-xl focus:ring-2 focus:ring-indigo-400 font-bold text-sm focus:outline-none"
        >
          Skip to main content
        </a>
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
