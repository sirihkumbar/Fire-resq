import type { Metadata } from 'next';
import './globals.css';
import { ApolloWrapper } from '@/lib/apollo-wrapper';

export const metadata = {
  title: 'FireResQ - Emergency Response System',
  description: 'Real-time emergency dispatch and squad management platform',
  manifest: '/manifest.json',
  themeColor: '#dc2626',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 antialiased min-h-screen">
        <ApolloWrapper>{children}</ApolloWrapper>
      </body>
    </html>
  );
}