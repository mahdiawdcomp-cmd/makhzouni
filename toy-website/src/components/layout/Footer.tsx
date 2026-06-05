import Link from "next/link";
import { Facebook, Instagram, Youtube, Linkedin, Mail, Phone, MapPin, Send } from "lucide-react";

const quickLinks = [
  { label: "Home", href: "/" },
  { label: "Products", href: "/products" },
  { label: "Categories", href: "/categories" },
  { label: "OEM/ODM Services", href: "/services" },
  { label: "About Us", href: "/about" },
  { label: "Quality & Certificates", href: "/quality" },
  { label: "News", href: "/news" },
  { label: "Contact Us", href: "/contact" },
];

const categoryLinks = [
  { label: "Educational Toys", href: "/products?category=educational" },
  { label: "Outdoor Toys", href: "/products?category=outdoor" },
  { label: "Baby Toys", href: "/products?category=baby" },
  { label: "Electronic Toys", href: "/products?category=electronic" },
  { label: "Wooden Toys", href: "/products?category=wooden" },
  { label: "Stuffed Animals", href: "/products?category=stuffed" },
];

export default function Footer() {
  return (
    <footer className="bg-[#1A3A6B] text-white">
      {/* Main Footer */}
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Column 1: Brand */}
          <div>
            <Link href="/" className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 bg-gradient-to-br from-[#FF6B35] to-[#FFD700] rounded-xl flex items-center justify-center">
                <span className="text-white font-black text-lg">B</span>
              </div>
              <div className="leading-tight">
                <div className="font-black text-white text-lg leading-none">Best Resource</div>
                <div className="text-[#FFD700] font-bold text-sm">TOYS</div>
              </div>
            </Link>
            <p className="text-blue-200 text-sm leading-relaxed mb-5">
              Leading toy manufacturer and wholesale supplier since 2004. We deliver quality, safety-certified toys to distributors across 50+ countries worldwide.
            </p>
            <div className="flex items-center gap-3">
              {[
                { icon: Facebook, href: "#" },
                { icon: Instagram, href: "#" },
                { icon: Youtube, href: "#" },
                { icon: Linkedin, href: "#" },
              ].map(({ icon: Icon, href }, i) => (
                <a
                  key={i}
                  href={href}
                  className="w-9 h-9 bg-white/10 hover:bg-[#FF6B35] rounded-lg flex items-center justify-center transition-colors"
                >
                  <Icon size={16} />
                </a>
              ))}
            </div>
          </div>

          {/* Column 2: Quick Links */}
          <div>
            <h4 className="font-black text-lg mb-5 text-white">Quick Links</h4>
            <ul className="space-y-2">
              {quickLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-blue-200 hover:text-[#FFD700] text-sm transition-colors flex items-center gap-2"
                  >
                    <span className="w-1.5 h-1.5 bg-[#FF6B35] rounded-full flex-shrink-0" />
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 3: Categories */}
          <div>
            <h4 className="font-black text-lg mb-5 text-white">Categories</h4>
            <ul className="space-y-2">
              {categoryLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-blue-200 hover:text-[#FFD700] text-sm transition-colors flex items-center gap-2"
                  >
                    <span className="w-1.5 h-1.5 bg-[#FFD700] rounded-full flex-shrink-0" />
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 4: Contact + Newsletter */}
          <div>
            <h4 className="font-black text-lg mb-5 text-white">Contact Us</h4>
            <div className="space-y-3 mb-6">
              <div className="flex items-start gap-3 text-sm text-blue-200">
                <MapPin size={16} className="flex-shrink-0 mt-0.5 text-[#FF6B35]" />
                <span>No. 123 Toy Industrial Zone, Shantou, Guangdong, China</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-blue-200">
                <Phone size={16} className="flex-shrink-0 text-[#FF6B35]" />
                <a href="tel:+86123456789" className="hover:text-[#FFD700] transition-colors">+86 123 456 789</a>
              </div>
              <div className="flex items-center gap-3 text-sm text-blue-200">
                <Mail size={16} className="flex-shrink-0 text-[#FF6B35]" />
                <a href="mailto:info@bestresourcetoys.com" className="hover:text-[#FFD700] transition-colors">info@bestresourcetoys.com</a>
              </div>
            </div>

            <h5 className="font-bold text-sm mb-3 text-white">Newsletter</h5>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="Your email..."
                className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder-blue-300 focus:outline-none focus:border-[#FF6B35]"
              />
              <button className="bg-[#FF6B35] hover:bg-[#e55a25] p-2 rounded-lg transition-colors">
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-blue-300">
          <p>© 2025 Best Resource Toys. All Rights Reserved.</p>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
