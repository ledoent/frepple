import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "frePPLe",
  description: "frePPLe planning UI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
