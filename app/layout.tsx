import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import SiteHeader from "@/components/site-header";
import SiteHeaderServer from "@/components/site-header-server";
import { getActiveTheme } from "@/lib/services/theme";

export const metadata: Metadata = {
  title: "UniSlot — COMSATS Attock Campus",
  description:
    "Find available rooms, labs, and teachers by time slot, and browse faculty and batch timetables.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = await getActiveTheme();
  return (
    <html lang="en" data-theme={theme} className="h-full antialiased">
      <body>
        <Suspense fallback={<SiteHeader isAdmin={false} />}>
          <SiteHeaderServer />
        </Suspense>
        {children}
        <footer className="copyright">
          <span>© 2026 UniSlot · COMSATS University Islamabad, Attock Campus. All rights reserved.</span>
          <span className="copyright-dev">
            Built by Shahid Zahoor Khan ·{" "}
            <a
              href="https://instagram.com/shahi.khan.io1"
              target="_blank"
              rel="noopener noreferrer"
            >
              @shahi.khan.io1
            </a>
          </span>
        </footer>
      </body>
    </html>
  );
}
