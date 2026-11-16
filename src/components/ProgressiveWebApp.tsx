import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function PwaServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installation remains available through the browser even if SW registration fails.
    });
  }, []);

  return null;
}

export function InstallAppButton() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    setIsIos(/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    setIsInstalled(
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    );

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (isInstalled || (!installPrompt && !isIos)) return null;

  async function install() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstallPrompt(null);
      return;
    }

    toast.info("در Safari روی «اشتراک‌گذاری» بزنید و سپس «افزودن به صفحهٔ اصلی» را انتخاب کنید.");
  }

  return (
    <button
      type="button"
      className="topbar-icon-button pwa-install-button"
      onClick={() => void install()}
      aria-label="نصب برنامه"
      title="نصب برنامه"
    >
      <Download className="size-[18px]" aria-hidden="true" />
    </button>
  );
}
