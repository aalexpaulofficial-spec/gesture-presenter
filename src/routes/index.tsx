import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Expand,
  Gauge,
  Hand,
  Layers,
  Maximize2,
  MonitorPlay,
  MousePointer2,
  Mic,
  Presentation,
  Share,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Upload,
  Users,
  Zap,
} from "lucide-react";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import heroProduct from "@/assets/hero-product.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Master Presenter — Present with your hands" },
      {
        name: "description",
        content:
          "Control any presentation with simple hand gestures. Front palm for next, back palm for previous, index finger for a smooth laser pointer. Works in your browser on laptop, tablet and phone.",
      },
      { property: "og:title", content: "Master Presenter — Present with your hands" },
      {
        property: "og:description",
        content:
          "Upload your presentation and control slides with your hands. Gesture navigation and a live laser pointer, right in the browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const nav = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#gestures", label: "Gestures" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { isInstalled, platform, triggerInstall } = usePWAInstall();
  const [alreadyInstalledOpen, setAlreadyInstalledOpen] = useState(false);
  const [instructionModalOpen, setInstructionModalOpen] = useState(false);

  async function handleDownload() {
    const result = await triggerInstall();
    if (result === "already_installed") {
      setAlreadyInstalledOpen(true);
    } else if (result === "show_instructions") {
      setInstructionModalOpen(true);
    }
  }

  const showDownloadBtn = true;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 lg:px-8">
          <a href="#top" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-soft">
              <Hand className="h-4.5 w-4.5" />
            </span>
            <span className="font-display text-[15px] font-semibold tracking-tight">Master Presenter</span>
          </a>

          <nav className="hidden items-center gap-8 md:flex">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-[13.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {showDownloadBtn && (
              <Button
                id="header-free-download-btn"
                size="sm"
                variant="outline"
                className="hidden rounded-full px-4 sm:flex"
                onClick={handleDownload}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" /> Free Download
              </Button>
            )}
            <Button asChild size="sm" className="rounded-full px-4">
              <Link to="/present" search={{ plan: "Master Hand" }}>
                Start presenting <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
            <button
              type="button"
              aria-label="Toggle navigation"
              className="rounded-lg p-2 md:hidden"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="grid gap-1 border-t border-border px-5 py-3 md:hidden">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>
        )}
      </header>

      <main id="top">
        <Hero showDownloadBtn={showDownloadBtn} onDownload={handleDownload} />
        <Marquee />
        <HowItWorks />
        <Features />
        <WhyUs />
        <GestureGuide />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>

      <footer className="border-t border-border py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 text-sm text-muted-foreground sm:flex-row lg:px-8">
          <span className="flex items-center gap-2 font-display font-semibold text-foreground">
            <Hand className="h-4 w-4 text-primary" /> Master Presenter
          </span>
          <span>Present with your hands. © {new Date().getFullYear()}</span>
        </div>
      </footer>

      {/* Already Installed Dialog */}
      <Dialog open={alreadyInstalledOpen} onOpenChange={setAlreadyInstalledOpen}>
        <DialogContent className="max-w-sm text-center">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Already installed</DialogTitle>
            <DialogDescription className="text-sm mt-2 text-muted-foreground">
              Master Presenter is already installed on this device.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-center">
            <Button onClick={() => setAlreadyInstalledOpen(false)} className="rounded-full px-6">
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Device-Specific PWA Installation Instructions */}
      <Dialog open={instructionModalOpen} onOpenChange={setInstructionModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Install Master Presenter</DialogTitle>
            <DialogDescription className="text-sm mt-1 text-muted-foreground">
              Install as a lightweight app to use full presentation controls offline.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            {platform === "ios" ? (
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <p className="font-semibold text-foreground">On iPhone & iPad (Safari):</p>
                <ol className="list-decimal list-inside space-y-1.5 text-xs leading-relaxed">
                  <li>Tap the <strong>Share</strong> button (box with an arrow ⎋) in Safari’s toolbar.</li>
                  <li>Scroll down and tap <strong>Add to Home Screen</strong> (+).</li>
                  <li>Tap <strong>Add</strong> in the top right corner.</li>
                </ol>
              </div>
            ) : platform === "android" ? (
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <p className="font-semibold text-foreground">On Android (Chrome / Edge / Firefox):</p>
                <ol className="list-decimal list-inside space-y-1.5 text-xs leading-relaxed">
                  <li>Tap the menu icon (<strong>⋮</strong>) in the top-right corner.</li>
                  <li>Select <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
                </ol>
              </div>
            ) : platform === "mac_safari" ? (
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <p className="font-semibold text-foreground">On Mac (Safari):</p>
                <ol className="list-decimal list-inside space-y-1.5 text-xs leading-relaxed">
                  <li>In the top menu bar, click <strong>File</strong>.</li>
                  <li>Select <strong>Add to Dock...</strong>, then click <strong>Add</strong>.</li>
                </ol>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <p className="font-semibold text-foreground">On Desktop (Chrome / Edge / Windows / Mac):</p>
                <ol className="list-decimal list-inside space-y-1.5 text-xs leading-relaxed">
                  <li>Click the <strong>Install</strong> icon in the address bar (on the right).</li>
                  <li>Or click the browser menu (<strong>⋮</strong>) → <strong>Save and share</strong> → <strong>Install Master Presenter</strong>.</li>
                </ol>
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={() => setInstructionModalOpen(false)} className="rounded-full px-6">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Hero({
  showDownloadBtn,
  onDownload,
}: {
  showDownloadBtn: boolean;
  onDownload: () => void;
}) {
  return (
    <section className="surface-hero relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-16 sm:pt-24 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <span className="animate-rise inline-flex items-center gap-2 rounded-full border border-primary/25 bg-card/70 px-3.5 py-1.5 text-xs font-medium text-primary shadow-soft">
            <Sparkles className="h-3.5 w-3.5" /> Touch-free presenting, straight from your browser
          </span>
          <h1 className="animate-rise mt-6 font-display text-[2.6rem] font-semibold leading-[1.02] tracking-tight text-ink sm:text-6xl">
            Present with your <span className="text-gradient">hands</span>, not a clicker
          </h1>
          <p className="animate-rise mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Upload your own presentation and move through it with a wave. Your slides keep their exact
            design, and your fingertip becomes a live laser pointer.
          </p>
          <div className="animate-rise mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="w-full rounded-full px-7 sm:w-auto">
              <Link to="/present" search={{ plan: "Master Hand" }}>
                Upload a presentation <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            {showDownloadBtn ? (
              <Button
                id="hero-free-download-btn"
                size="lg"
                variant="outline"
                className="w-full rounded-full px-7 sm:w-auto"
                onClick={onDownload}
              >
                <Download className="mr-1.5 h-4 w-4" /> Free Download
              </Button>
            ) : (
              <Button asChild size="lg" variant="outline" className="w-full rounded-full px-7 sm:w-auto">
                <a href="#gestures">See the gestures</a>
              </Button>
            )}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Free forever for hand control · Works offline after download · Laptop, tablet and phone
          </p>
        </div>

        <div className="animate-rise relative mx-auto mt-14 max-w-5xl">
          <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-lift">
            <img
              src={heroProduct}
              alt="Presentation open in Master Presenter with a floating camera window and a laser pointer on the slide"
              width={1600}
              height={1104}
              className="w-full"
            />
          </div>
          <div className="pointer-events-none absolute -bottom-6 left-1/2 hidden -translate-x-1/2 gap-3 sm:flex">
            {[
              { icon: Hand, label: "Front palm → Next" },
              { icon: MousePointer2, label: "Index finger → Laser" },
              { icon: Maximize2, label: "Slide-only fullscreen" },
            ].map((chip) => (
              <span
                key={chip.label}
                className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-medium shadow-soft"
              >
                <chip.icon className="h-3.5 w-3.5 text-primary" />
                {chip.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Marquee() {
  const items = [
    "Keynotes",
    "Lectures",
    "Sales demos",
    "Workshops",
    "Pitch meetings",
    "Classrooms",
    "Conferences",
  ];
  return (
    <div className="border-y border-border bg-card/60 py-5">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground lg:px-8">
        {items.map((i) => (
          <span key={i}>{i}</span>
        ))}
      </div>
    </div>
  );
}

function SectionHead({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</span>
      <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h2>
      {copy && <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{copy}</p>}
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      icon: Upload,
      title: "Upload your presentation",
      copy: "Pick any presentation file. Your original slides, fonts, images and layout stay untouched.",
    },
    {
      icon: MonitorPlay,
      title: "Start the presentation",
      copy: "Your slides open in a clean presenter view and your front camera starts automatically.",
    },
    {
      icon: Hand,
      title: "Control with your hand",
      copy: "Palm forward for next, back of hand for previous, index finger for the laser pointer.",
    },
  ];
  return (
    <section id="how" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 lg:px-8">
        <SectionHead
          eyebrow="How it works"
          title="Three steps to a hands-free talk"
          copy="No setup, no extra hardware, no learning curve. Open it, upload, and present."
        />
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {steps.map((s, i) => (
            <div key={s.title} className="card-premium card-premium-hover p-7">
              <span className="flex items-center justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary-soft text-primary">
                  <s.icon className="h-5 w-5" />
                </span>
                <span className="font-display text-3xl font-semibold text-border">0{i + 1}</span>
              </span>
              <h3 className="mt-5 font-display text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.copy}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    {
      icon: Layers,
      title: "Your slides, exactly as designed",
      copy: "Original dimensions, fonts, colours and positioning are preserved. Nothing is redesigned or replaced.",
    },
    {
      icon: MousePointer2,
      title: "Full-slide laser pointer",
      copy: "Your fingertip maps across the entire slide — edge to edge, top to bottom — with smooth, low-latency motion.",
    },
    {
      icon: Expand,
      title: "Distraction-free fullscreen",
      copy: "Fullscreen shows the slide and nothing else. No headers, no buttons, no camera box on screen.",
    },
    {
      icon: Gauge,
      title: "Reliable gesture detection",
      copy: "Front palm, back palm and pointing are clearly separated, with no accidental double-jumps.",
    },
    {
      icon: Smartphone,
      title: "Laptop, tablet and phone",
      copy: "A responsive presenter view that adapts to any screen, including Android and iOS browsers.",
    },
    {
      icon: ShieldCheck,
      title: "Camera stays on your device",
      copy: "Hand detection runs locally on your device, so your camera feed never leaves it.",
    },
  ];
  return (
    <section id="features" className="border-y border-border bg-secondary/40 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 lg:px-8">
        <SectionHead
          eyebrow="Features"
          title="Built for people who present for real"
          copy="Every detail is tuned for live rooms: fast, predictable and calm under pressure."
        />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="card-premium card-premium-hover p-7">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary-soft text-primary">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 font-display text-base font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.copy}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhyUs() {
  const points = [
    "Works with the presentation you already made",
    "No clicker, no cables, no companion app",
    "Laser pointer that reaches every corner of the slide",
    "Camera keeps working while you are in fullscreen",
    "Clear guidance when a camera or permission fails",
    "Free tier that is genuinely enough to present with",
  ];
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 lg:grid-cols-2 lg:px-8">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Why Master Presenter
          </span>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Stay with your audience, not with your laptop
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
            Walking back to press a key breaks the moment. A single hand movement keeps you where you belong
            — in front of the room, facing the people you are speaking to.
          </p>
          <ul className="mt-8 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3 w-3" />
                </span>
                <span className="text-foreground/90">{p}</span>
              </li>
            ))}
          </ul>
          <Button asChild className="mt-9 rounded-full px-6">
            <Link to="/present" search={{ plan: "Master Hand" }}>
              Try it with your own deck <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="card-premium overflow-hidden p-0">
          <div className="border-b border-border px-6 py-4">
            <p className="font-display text-sm font-semibold">Live gesture feed</p>
            <p className="text-xs text-muted-foreground">A quick look at what the presenter view shows</p>
          </div>
          <div className="space-y-3 p-6">
            {[
              { label: "Front palm detected", value: "Next slide", tone: "bg-primary" },
              { label: "Back of hand detected", value: "Previous slide", tone: "bg-primary/70" },
              { label: "Index finger raised", value: "Laser pointer active", tone: "bg-[oklch(0.62_0.24_25)]" },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between rounded-xl border border-border bg-secondary/50 px-4 py-3"
              >
                <span className="flex items-center gap-3 text-sm">
                  <span className={`h-2.5 w-2.5 rounded-full ${row.tone}`} />
                  {row.label}
                </span>
                <span className="text-xs font-medium text-muted-foreground">{row.value}</span>
              </div>
            ))}
            <div className="rounded-xl bg-gradient-to-br from-primary-soft to-card p-5">
              <p className="flex items-center gap-2 font-display text-sm font-semibold">
                <Zap className="h-4 w-4 text-primary" /> Smooth by design
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Motion is stabilised so the laser glides instead of shaking, without adding noticeable delay.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function GestureGuide() {
  const gestures = [
    {
      emoji: "🖐️",
      title: "Open front palm",
      action: "Next slide",
      copy: "Show your palm to the camera with fingers spread. To advance again, close your hand into a fist, then open your palm again.",
    },
    {
      emoji: "🤚",
      title: "Back of hand",
      action: "Previous slide",
      copy: "Turn your hand around so the back faces the camera. To go back again, close your hand into a fist, then show the back of your hand again.",
    },
    {
      emoji: "☝️",
      title: "Raised index finger",
      action: "Laser pointer",
      copy: "Point with one finger and the laser follows your fingertip across the whole slide.",
    },
  ];
  return (
    <section id="gestures" className="border-y border-border bg-secondary/40 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 lg:px-8">
        <SectionHead
          eyebrow="Hand gesture guide"
          title="Three gestures. That's the whole interface."
          copy="Hold your hand roughly an arm's length from the camera in reasonable light and you're set."
        />
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {gestures.map((g) => (
            <div key={g.title} className="card-premium card-premium-hover p-8 text-center">
              <span className="mx-auto grid h-20 w-20 place-items-center rounded-2xl bg-primary-soft text-4xl">
                {g.emoji}
              </span>
              <h3 className="mt-6 font-display text-lg font-semibold">{g.title}</h3>
              <span className="mt-2 inline-block rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                {g.action}
              </span>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{g.copy}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const tiers = [
    {
      name: "Master Hand",
      price: "$0",
      note: "",
      freeLabel: "Free",
      copy: "Hands-only presentation control.",
      cta: "Start presenting",
      link: "/present" as const,
      search: { plan: "Master Hand" } as Record<string, unknown>,
      badge: null,
      highlight: false,
      features: [
        "Hand gesture slide navigation",
        "Front palm → Next Slide",
        "Back of hand → Previous Slide",
        "Close hand → reset",
        "Index finger → Laser Pointer",
        "Full-slide laser movement",
        "Camera hand control",
        "Exact PPT/PPTX presentation",
        "Fullscreen presentation",
        "Browser-based usage",
      ],
    },
    {
      name: "Master Voice",
      price: "$0",
      note: "",
      freeLabel: "Free",
      copy: "Hands + Voice presentation control.",
      cta: "Upgrade to Master Voice",
      link: "/present" as const,
      search: { plan: "Master Voice", pro: true } as Record<string, unknown>,
      badge: "MOST POPULAR",
      highlight: true,
      hasVoiceHighlight: true,
      trialNote: "Unlimited",
      features: [
        "Everything in Master Hand",
        "Voice slide navigation",
        "Voice → specific slide",
        "“Next”",
        "“Previous”",
        "Number / number words → specific slide",
        "“Go to Slide 8”",
        "Advanced laser controls",
        "Gesture sensitivity controls",
        "Presentation session history",
        "Advanced presenter controls",
      ],
    },
    {
      name: "Master Write",
      price: "$0",
      note: "",
      freeLabel: "Free",
      copy: "Hands + Voice + Writing presentation control.",
      cta: "Upgrade to Master Write",
      link: "/present" as const,
      search: { plan: "Master Write", pro: true } as Record<string, unknown>,
      badge: "POWERED BY LIGHTNING AI",
      highlight: false,
      trialNote: "Unlimited",
      features: [
        "Everything in Master Voice",
        "Hand-controlled writing",
        "Real-time presentation drawing",
        "Multiple writing strokes",
        "Clear / erase writing",
        "Smooth low-latency drawing",
        "Accurate slide coordinate mapping",
        "Highlight presentation content",
        "Remove Highlights",
        "Clear Highlights",
        "Original PPT/PPTX remains unchanged",
      ],
    },
    {
      name: "Master AI",
      price: "$0",
      note: "",
      freeLabel: "Free",
      copy: "Hands + Voice + Writing + AI presentation control.",
      cta: "Upgrade to Master AI",
      link: "/present" as const,
      search: { plan: "Master AI", pro: true } as Record<string, unknown>,
      badge: null,
      highlight: false,
      trialNote: "Unlimited",
      features: [
        "Everything in Master Write",
        "AI presentation assistance",
        "Presentation Q&A",
        "Slide understanding",
        "Semantic slide search",
        "AI slide summaries",
        "AI presenter notes",
        "Speaker assistance",
        "Presentation coaching",
        "Future AI-ready capabilities",
      ],
    },
    {
      name: "Business",
      price: "Custom",
      note: "per team",
      copy: "Complete presentation control for teams and organisations.",
      cta: "Contact Sales",
      link: "/present" as const,
      search: { plan: "Business" } as Record<string, unknown>,
      badge: null,
      highlight: false,
      features: [
        "Team accounts",
        "Admin dashboard",
        "Shared presentations",
        "Usage analytics",
        "Organisation branding",
        "Higher limits",
        "Priority support",
        "Enterprise security options",
        "Team management",
      ],
    },
  ];

  return (
    <section id="pricing" className="py-20 sm:py-28">
      <div className="mx-auto max-w-[90rem] px-5 lg:px-8">
        <SectionHead
          eyebrow="Pricing"
          title="Hand control is free. Always."
          copy="Upgrade only when you want deeper customisation, history, branding or team management."
        />
        <div className="mt-14 grid items-start gap-5 md:grid-cols-2 xl:grid-cols-5">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`card-premium flex h-full flex-col p-6 xl:p-8 ${t.highlight ? "border-primary/45 shadow-lift xl:-mt-4 xl:pb-12" : "card-premium-hover"}`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold">{t.name}</h3>
                {t.badge && (
                  <span className={`rounded-full px-3 py-1 text-[10px] sm:text-[11px] font-medium tracking-wide ${t.name === 'Master Write' ? 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/20' : 'bg-primary text-primary-foreground'}`}>
                    {t.badge}
                  </span>
                )}
              </div>
              <p className="mt-4 flex items-end gap-1.5 flex-wrap">
                <span className="font-display text-4xl font-semibold tracking-tight">{t.price}</span>
                {(t as any).freeLabel && (
                  <span className="pb-1 text-sm font-semibold text-primary">{(t as any).freeLabel}</span>
                )}
                {t.note && <span className="pb-1 text-xs text-muted-foreground">{t.note}</span>}
              </p>
              {(t as any).trialNote && (
                <p className="mt-1 text-xs font-semibold text-primary">{(t as any).trialNote}</p>
              )}
              <p className="mt-2 text-sm text-muted-foreground">{t.copy}</p>

              {t.hasVoiceHighlight && (
                <div className="relative mt-5 overflow-hidden rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <div className="absolute right-0 top-0 p-2 opacity-10">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" x2="12" y1="19" y2="22"></line></svg>
                  </div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-primary"><Mic className="h-4 w-4"/> VOICE CONTROL</h4>
                  <p className="mb-1 text-sm font-medium italic text-foreground">“Go to Slide 9”</p>
                  <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground"><ArrowRight className="h-3 w-3"/> Instantly jump to Slide 9</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-md border border-border bg-background px-2 py-1 text-[10px]">“Next slide”</span>
                    <span className="rounded-md border border-border bg-background px-2 py-1 text-[10px]">“Previous slide”</span>
                    <span className="rounded-md border border-border bg-background px-2 py-1 text-[10px]">“Go to Slide 15”</span>
                  </div>
                </div>
              )}

              <Button
                asChild
                variant={t.highlight ? "default" : "outline"}
                className="mt-6 w-full rounded-full"
              >
                <Link to={t.link} search={t.search}>{t.cta}</Link>
              </Button>
              <ul className={`mt-7 flex-grow space-y-2.5 ${t.hasVoiceHighlight ? 'border-t border-border/50 pt-5' : ''}`}>
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[13px] leading-relaxed">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-foreground/90">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const faqs = [
    {
      q: "Does it change how my slides look?",
      a: "No. Your uploaded presentation is shown as it is, with the original layout, dimensions, text, images and colours. The laser pointer is drawn on top and never edits your file.",
    },
    {
      q: "Do I need any extra hardware?",
      a: "Only the camera that is already in your laptop, tablet or phone. There is nothing to plug in and nothing to install.",
    },
    {
      q: "Will my camera feed be uploaded anywhere?",
      a: "Hand detection happens locally on your own device, so the video from your camera stays with you.",
    },
    {
      q: "What if the camera does not start?",
      a: "You get a clear message explaining whether permission was blocked, the camera is in use, or no camera was found — plus a one-tap retry.",
    },
    {
      q: "Does hand control still work in fullscreen?",
      a: "Yes. Fullscreen shows only your slide, while the camera keeps running in the background so gestures continue to work.",
    },
    {
      q: "Does it work on phones and tablets?",
      a: "Yes. The presenter view is fully responsive and works in modern Android and iOS browsers using the front camera.",
    },
  ];
  return (
    <section id="faq" className="border-t border-border bg-secondary/40 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-5 lg:px-8">
        <SectionHead eyebrow="FAQ" title="Questions, answered" />
        <Accordion type="single" collapsible className="mt-10">
          {faqs.map((f) => (
            <AccordionItem key={f.q} value={f.q}>
              <AccordionTrigger className="text-left font-display text-[15px]">{f.q}</AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-5 py-20 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-border bg-[image:var(--gradient-ink)] px-8 py-16 text-center shadow-lift sm:px-16">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 px-3.5 py-1.5 text-xs font-medium text-primary-glow">
          <Presentation className="h-3.5 w-3.5" /> Ready when you are
        </span>
        <h2 className="mx-auto mt-6 max-w-2xl font-display text-3xl font-semibold tracking-tight text-[oklch(0.98_0.005_150)] sm:text-4xl">
          Your next presentation, controlled by a wave
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-[oklch(0.85_0.02_150)]">
          Upload the presentation you already have and step away from the keyboard.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="w-full rounded-full px-7 sm:w-auto">
            <Link to="/present" search={{ plan: "Master Hand" }}>
              Start free <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
          <span className="flex items-center gap-2 text-xs text-[oklch(0.8_0.02_150)]">
            <Users className="h-3.5 w-3.5" /> Free hand control, no account needed
          </span>
        </div>
      </div>
    </section>
  );
}
