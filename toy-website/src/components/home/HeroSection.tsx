"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ArrowRight, Star } from "lucide-react";
import { cn } from "@/lib/utils";

const slides = [
  {
    id: 1,
    badge: "New 2025 Collection",
    title: "Quality Toys\nFor Every Child",
    subtitle: "Wholesale toy manufacturer since 2004. CE, ASTM & EN71 certified. OEM/ODM available.",
    cta: "Browse Products",
    ctaHref: "/products",
    ctaSecondary: "Get a Quote",
    ctaSecondaryHref: "/contact",
    bg: "from-[#1A3A6B] via-[#2a4f90] to-[#1A3A6B]",
    image: "https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=800&q=80",
    accent: "#FFD700",
  },
  {
    id: 2,
    badge: "OEM / ODM Services",
    title: "Build Your Own\nToy Brand",
    subtitle: "Custom design, private label, and packaging solutions. From concept to shelf in 60 days.",
    cta: "Learn More",
    ctaHref: "/services",
    ctaSecondary: "View Catalog",
    ctaSecondaryHref: "/products",
    bg: "from-[#FF6B35] via-[#ff8c5a] to-[#e55a25]",
    image: "https://images.unsplash.com/photo-1611649752374-fe4b0e23f3e3?w=800&q=80",
    accent: "#FFD700",
  },
  {
    id: 3,
    badge: "Safety First",
    title: "Certified Safe\nCertified Quality",
    subtitle: "All products meet international safety standards. CE, ASTM F963, and EN71 certified for global markets.",
    cta: "Our Certificates",
    ctaHref: "/quality",
    ctaSecondary: "Contact Us",
    ctaSecondaryHref: "/contact",
    bg: "from-[#1a1a2e] via-[#16213e] to-[#0f3460]",
    image: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80",
    accent: "#FF6B35",
  },
];

export default function HeroSection() {
  const [current, setCurrent] = useState(0);
  const [animating, setAnimating] = useState(false);

  const goTo = (index: number) => {
    if (animating) return;
    setAnimating(true);
    setCurrent(index);
    setTimeout(() => setAnimating(false), 500);
  };

  const prev = () => goTo((current - 1 + slides.length) % slides.length);
  const next = () => goTo((current + 1) % slides.length);

  useEffect(() => {
    const timer = setInterval(next, 5000);
    return () => clearInterval(timer);
  });

  const slide = slides[current];

  return (
    <section className={`relative min-h-[90vh] bg-gradient-to-br ${slide.bg} transition-all duration-700 overflow-hidden`}>
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-20 -right-20 w-96 h-96 bg-white/5 rounded-full" />
        <div className="absolute -bottom-32 -left-20 w-80 h-80 bg-white/5 rounded-full" />
        <div className="absolute top-1/2 right-1/4 w-32 h-32 bg-white/5 rounded-full" />
      </div>

      <div className="relative max-w-7xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-12 items-center min-h-[90vh]">
        {/* Text */}
        <div className={cn("text-white", animating ? "opacity-0" : "opacity-100 animate-fade-up")}>
          <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm border border-white/20 px-4 py-1.5 rounded-full text-sm font-bold mb-6">
            <Star size={14} className="text-yellow-400 fill-yellow-400" />
            {slide.badge}
          </div>
          <h1 className="text-5xl lg:text-6xl font-black leading-tight mb-6 whitespace-pre-line">
            {slide.title}
          </h1>
          <p className="text-lg text-white/80 max-w-md mb-10 leading-relaxed">
            {slide.subtitle}
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              href={slide.ctaHref}
              className="flex items-center gap-2 bg-[#FF6B35] hover:bg-[#e55a25] text-white px-8 py-3.5 rounded-full font-bold text-base transition-all hover:-translate-y-1 hover:shadow-xl"
            >
              {slide.cta}
              <ArrowRight size={18} />
            </Link>
            <Link
              href={slide.ctaSecondaryHref}
              className="flex items-center gap-2 border-2 border-white/60 hover:border-white hover:bg-white hover:text-[#1A3A6B] text-white px-8 py-3.5 rounded-full font-bold text-base transition-all"
            >
              {slide.ctaSecondary}
            </Link>
          </div>

          {/* Mini stats */}
          <div className="flex items-center gap-8 mt-14 pt-8 border-t border-white/20">
            {[
              { value: "20+", label: "Years" },
              { value: "5K+", label: "Products" },
              { value: "50+", label: "Countries" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-2xl font-black text-[#FFD700]">{s.value}</div>
                <div className="text-sm text-white/60">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Image */}
        <div className={cn("relative hidden lg:flex items-center justify-center", animating ? "opacity-0" : "opacity-100 animate-fade-in")}>
          <div className="relative w-[420px] h-[420px]">
            <div className="absolute inset-0 bg-white/10 rounded-full animate-pulse-soft" style={{ animation: "float 4s ease-in-out infinite" }} />
            <img
              src={slide.image}
              alt="Featured toy"
              className="absolute inset-8 w-[calc(100%-4rem)] h-[calc(100%-4rem)] object-cover rounded-full shadow-2xl"
            />
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="absolute bottom-8 left-0 right-0 flex items-center justify-center gap-6">
        <button onClick={prev} className="w-10 h-10 bg-white/20 hover:bg-white/40 rounded-full flex items-center justify-center text-white transition-colors">
          <ChevronLeft size={20} />
        </button>
        <div className="flex gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={cn("transition-all rounded-full", i === current ? "w-8 h-3 bg-[#FF6B35]" : "w-3 h-3 bg-white/40 hover:bg-white/70")}
            />
          ))}
        </div>
        <button onClick={next} className="w-10 h-10 bg-white/20 hover:bg-white/40 rounded-full flex items-center justify-center text-white transition-colors">
          <ChevronRight size={20} />
        </button>
      </div>
    </section>
  );
}
