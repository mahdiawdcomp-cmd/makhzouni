"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Search, ShoppingBag, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

const navLinks = [
  { label: "Home", href: "/" },
  { label: "Products", href: "/products" },
  { label: "Categories", href: "/categories" },
  { label: "OEM/ODM", href: "/services" },
  { label: "About", href: "/about" },
  { label: "Quality", href: "/quality" },
  { label: "News", href: "/news" },
  { label: "Contact", href: "/contact" },
];

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Top Bar */}
      <div className="bg-[#1A3A6B] text-white text-sm py-2 hidden md:block">
        <div className="max-w-7xl mx-auto px-6 flex justify-between items-center">
          <div className="flex items-center gap-6">
            <a href="tel:+86123456789" className="flex items-center gap-1.5 hover:text-[#FFD700] transition-colors">
              <Phone size={13} />
              <span>+86 123 456 789</span>
            </a>
            <a href="mailto:info@bestresourcetoys.com" className="hover:text-[#FFD700] transition-colors">
              info@bestresourcetoys.com
            </a>
          </div>
          <div className="flex items-center gap-4">
            <span>Mon-Sat: 9:00AM - 6:00PM (GMT+8)</span>
            <a
              href="https://wa.me/86123456789"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-green-500 hover:bg-green-600 text-white px-3 py-0.5 rounded-full text-xs font-bold transition-colors"
            >
              WhatsApp Us
            </a>
          </div>
        </div>
      </div>

      {/* Main Header */}
      <header
        className={cn(
          "sticky top-0 z-50 bg-white transition-all duration-300",
          scrolled ? "shadow-lg" : "shadow-sm"
        )}
      >
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 flex-shrink-0">
            <div className="w-10 h-10 bg-gradient-to-br from-[#FF6B35] to-[#FFD700] rounded-xl flex items-center justify-center shadow-md">
              <span className="text-white font-black text-lg">B</span>
            </div>
            <div className="leading-tight">
              <div className="font-black text-[#1A3A6B] text-lg leading-none">Best Resource</div>
              <div className="text-[#FF6B35] font-bold text-sm tracking-wide">TOYS</div>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "px-3 py-2 rounded-lg text-sm font-700 transition-all duration-200",
                  pathname === link.href
                    ? "bg-[#FF6B35] text-white"
                    : "text-[#1A3A6B] hover:bg-orange-50 hover:text-[#FF6B35]"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Link
              href="/search"
              className="p-2 rounded-lg text-[#1A3A6B] hover:bg-orange-50 hover:text-[#FF6B35] transition-colors"
            >
              <Search size={20} />
            </Link>
            <Link
              href="/inquiry"
              className="hidden sm:flex items-center gap-2 bg-[#FF6B35] text-white px-4 py-2 rounded-full text-sm font-bold hover:bg-[#e55a25] transition-all hover:shadow-lg"
            >
              <ShoppingBag size={16} />
              <span>Inquiry</span>
            </Link>
            <button
              className="lg:hidden p-2 rounded-lg text-[#1A3A6B] hover:bg-gray-100 transition-colors"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {mobileOpen && (
          <div className="lg:hidden bg-white border-t border-gray-100 shadow-xl">
            <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "px-4 py-3 rounded-xl text-sm font-bold transition-all",
                    pathname === link.href
                      ? "bg-[#FF6B35] text-white"
                      : "text-[#1A3A6B] hover:bg-orange-50"
                  )}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/inquiry"
                className="mt-2 flex items-center justify-center gap-2 bg-[#FF6B35] text-white px-4 py-3 rounded-xl text-sm font-bold"
              >
                <ShoppingBag size={16} />
                Send Inquiry
              </Link>
            </div>
          </div>
        )}
      </header>
    </>
  );
}
