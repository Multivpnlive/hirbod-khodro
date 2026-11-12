import { useEffect } from "react";
import { useBranding } from "@/lib/branding";

export function BrandingFavicon() {
  const { branding } = useBranding();

  useEffect(() => {
    const href = branding.logo_url?.trim() || "/hirbod-favicon.svg";

    let icon = document.querySelector<HTMLLinkElement>(
      'link[rel~="icon"]'
    );

    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.appendChild(icon);
    }

    icon.href = href;

    const path = new URL(href, window.location.origin).pathname.toLowerCase();

    if (path.endsWith(".svg")) {
      icon.type = "image/svg+xml";
      icon.sizes = "any";
    } else if (path.endsWith(".png")) {
      icon.type = "image/png";
      icon.removeAttribute("sizes");
    } else if (path.endsWith(".jpg") || path.endsWith(".jpeg")) {
      icon.type = "image/jpeg";
      icon.removeAttribute("sizes");
    } else if (path.endsWith(".webp")) {
      icon.type = "image/webp";
      icon.removeAttribute("sizes");
    } else {
      icon.removeAttribute("type");
      icon.removeAttribute("sizes");
    }
  }, [branding.logo_url]);

  return null;
}
