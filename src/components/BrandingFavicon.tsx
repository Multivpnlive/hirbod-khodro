import { useEffect } from "react";
import { useBranding } from "@/lib/branding";

export function BrandingFavicon() {
  const { branding } = useBranding();

  useEffect(() => {
    const href = branding.logo_url?.trim() || "/hirbod-favicon.svg";
    const absoluteIconUrl = new URL(href, window.location.origin).href;
    document.title = branding.app_name || "هیربد خودرو";

    const upsertLink = (rel: string) => {
      let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!link) {
        link = document.createElement("link");
        link.rel = rel;
        document.head.appendChild(link);
      }
      return link;
    };

    const path = new URL(absoluteIconUrl).pathname.toLowerCase();
    const favicon = upsertLink("icon");
    favicon.href = absoluteIconUrl;

    if (path.endsWith(".svg")) {
      favicon.type = "image/svg+xml";
      favicon.sizes = "any";
    } else if (path.endsWith(".png")) {
      favicon.type = "image/png";
      favicon.removeAttribute("sizes");
    } else if (path.endsWith(".jpg") || path.endsWith(".jpeg")) {
      favicon.type = "image/jpeg";
      favicon.removeAttribute("sizes");
    } else if (path.endsWith(".webp")) {
      favicon.type = "image/webp";
      favicon.removeAttribute("sizes");
    } else {
      favicon.removeAttribute("type");
      favicon.removeAttribute("sizes");
    }

    // iOS ignores the web manifest icon when creating a home-screen web app.
    // It reads apple-touch-icon instead, so point that link at the selected logo.
    const appleTouchIcon = upsertLink("apple-touch-icon");
    appleTouchIcon.href = absoluteIconUrl;
    appleTouchIcon.sizes = "180x180";

    // Android and other install surfaces read the manifest. Build it from the
    // active installation's branding instead of the static template icon.
    const iconType = path.endsWith(".svg")
      ? "image/svg+xml"
      : path.endsWith(".jpg") || path.endsWith(".jpeg")
        ? "image/jpeg"
        : path.endsWith(".webp")
          ? "image/webp"
          : "image/png";
    const manifest = {
      id: "/",
      name: branding.app_name || "هیربد خودرو",
      short_name: (branding.app_name || "هیربد").slice(0, 12),
      description: branding.company_name || "سامانه مدیریت خریدوفروش خودرو و امور مالی",
      lang: "fa",
      dir: "rtl",
      start_url: "/dashboard",
      scope: "/",
      display: "standalone",
      display_override: ["standalone", "minimal-ui"],
      orientation: "any",
      theme_color: "#f7f4ff",
      background_color: "#f7f4ff",
      icons: [{ src: absoluteIconUrl, sizes: "any", type: iconType, purpose: "any" }],
    };
    const manifestBlob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
    const manifestUrl = URL.createObjectURL(manifestBlob);
    upsertLink("manifest").href = manifestUrl;

    return () => URL.revokeObjectURL(manifestUrl);
  }, [branding.logo_url, branding.app_name, branding.company_name]);

  return null;
}
