import { Atkinson_Hyperlegible, Comic_Neue, EB_Garamond, Geist_Mono, Inter, JetBrains_Mono, Literata, Lora, Merriweather, Nunito } from "next/font/google";

// next/font needs literal options here (no spreads or shared objects).
// Defaults are preloaded; the optional fonts only download once a setting actually uses them.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const literata = Literata({ variable: "--font-literata", subsets: ["latin"], style: ["normal", "italic"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], style: ["normal", "italic"], preload: false });
const atkinson = Atkinson_Hyperlegible({ variable: "--font-atkinson", subsets: ["latin"], style: ["normal", "italic"], weight: ["400", "700"], preload: false });
const comic = Comic_Neue({ variable: "--font-comic", subsets: ["latin"], style: ["normal", "italic"], weight: ["300", "400", "700"], preload: false });
const lora = Lora({ variable: "--font-lora", subsets: ["latin"], style: ["normal", "italic"], preload: false });
const merriweather = Merriweather({ variable: "--font-merriweather", subsets: ["latin"], style: ["normal", "italic"], preload: false });
const garamond = EB_Garamond({ variable: "--font-garamond", subsets: ["latin"], style: ["normal", "italic"], preload: false });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], style: ["normal", "italic"], preload: false });

export const fontVariables = [inter, literata, mono, nunito, atkinson, comic, lora, merriweather, garamond, jetbrains].map((f) => f.variable).join(" ");
