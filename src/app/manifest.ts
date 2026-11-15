import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "Detali — Gestão de locações", short_name: "Detali", description: "Gestão integrada de locações para eventos",
    start_url: "/gestao", scope: "/", display: "standalone", background_color: "#FFF3E4", theme_color: "#251B23", lang: "pt-BR",
    icons: [{ src: "/brand/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/brand/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" }] };
}
