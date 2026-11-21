import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoadWatch | Smarter roads start with better data",
  description:
    "RoadWatch collects real-world motion and GPS data to help communities understand road conditions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
