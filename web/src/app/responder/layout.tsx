import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "FireResQ - Squad Portal",
  manifest: "/manifest-responder.json",
};

export const viewport: Viewport = {
  themeColor: "#dc2626",
};

export default function ResponderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}