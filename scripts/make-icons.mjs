import sharp from "sharp";

const svg = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7b955"/><stop offset="1" stop-color="#d97a1e"/></linearGradient></defs>
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#1c1916"/>
  <g transform="translate(256 256) scale(${pad ? 0.62 : 0.78}) translate(-256 -256)">
    <rect x="56" y="56" width="400" height="400" rx="110" fill="url(#g)"/>
    <path d="M176 196c0-22 18-40 40-40h80c22 0 40 18 40 40v52c0 60-36 108-80 108s-80-48-80-108z" fill="#1c1916" opacity=".92"/>
    <circle cx="222" cy="236" r="14" fill="#f7b955"/><circle cx="290" cy="236" r="14" fill="#f7b955"/>
    <path d="M222 292c20 18 48 18 68 0" stroke="#f7b955" stroke-width="12" stroke-linecap="round" fill="none"/>
  </g>
</svg>`;

await sharp(Buffer.from(svg(512, false))).png().toFile("public/icons/icon-512.png");
await sharp(Buffer.from(svg(512, false))).resize(192, 192).png().toFile("public/icons/icon-192.png");
await sharp(Buffer.from(svg(512, true))).png().toFile("public/icons/maskable-512.png");
await sharp(Buffer.from(svg(512, false))).resize(180, 180).png().toFile("public/icons/apple-touch-icon.png");
await sharp(Buffer.from(svg(512, false))).resize(48, 48).png().toFile("public/icons/favicon-48.png");
console.log("icons written");
