import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({
  src: "../../public/fonts/inter-variable.ttf",
  variable: "--font-inter",
  display: "swap",
  weight: "100 900",
});
const bricolage = localFont({
  src: "../../public/fonts/bricolage-grotesque-variable.ttf",
  variable: "--font-bricolage",
  display: "swap",
  weight: "200 800",
});

export const metadata: Metadata = {
  title: { default: "Detali | Cada peça conta.", template: "%s | Detali" },
  description: "Gestão de locações para eventos. Reservas, estoque e devoluções: cada peça conta.",
  icons: { icon: "/brand/detali-symbol.svg", apple: "/brand/detali-touch.png" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Detali", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FFF3E4",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${bricolage.variable}`}>
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
