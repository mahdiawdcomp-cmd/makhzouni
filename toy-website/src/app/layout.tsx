import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import BackToTop from "@/components/ui/BackToTop";

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Best Resource Toys | Wholesale Toy Manufacturer",
    template: "%s | Best Resource Toys",
  },
  description:
    "Leading wholesale toy manufacturer. CE, ASTM & EN71 certified. OEM/ODM services. 5000+ products exported to 50+ countries.",
  keywords: "wholesale toys, toy manufacturer, OEM toys, educational toys, baby toys, outdoor toys",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={nunito.variable}>
      <body className={`${nunito.className} min-h-screen flex flex-col`}>
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <BackToTop />
      </body>
    </html>
  );
}
