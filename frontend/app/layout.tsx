import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoadWatch | Road hazard dashboard",
  description:
    "Explore community-reported road hazards and pothole detections around Tampa, Florida.",
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
