import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Instrument_Serif, Noto_Sans_Devanagari, Noto_Sans_Kannada } from "next/font/google";
import { Providers } from "@/components/shell/Providers";
import "./globals.css";

const hanken = Hanken_Grotesk({ variable: "--font-hanken", subsets: ["latin"] });
const instrument = Instrument_Serif({ variable: "--font-instrument", subsets: ["latin"], weight: "400" });
// Transcript lines in Kannada and Hindi render in a face designed for them.
const kannada = Noto_Sans_Kannada({ variable: "--font-kannada", subsets: ["kannada"], display: "swap" });
const devanagari = Noto_Sans_Devanagari({ variable: "--font-devanagari", subsets: ["devanagari"], display: "swap" });

export const metadata: Metadata = {
  title: "Envoy",
  description: "Tell it what you want. It makes the call.",
};

export const viewport: Viewport = {
  themeColor: "#0c0e1a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${hanken.variable} ${instrument.variable} ${kannada.variable} ${devanagari.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-bg text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
