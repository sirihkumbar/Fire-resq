import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "FireResQ - Citizen SOS",
  manifest: "/manifest-sos.json",
};

export const viewport: Viewport = {
  themeColor: "#dc2626",
};

export default function SosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}