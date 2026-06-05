import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { categories } from "@/lib/data";

export default function CategoriesSection() {
  return (
    <section className="py-20 bg-[#f8f9fc]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="section-badge">Product Categories</div>
          <h2 className="text-4xl font-black text-[#1A3A6B]">Browse By Category</h2>
          <div className="divider" />
          <p className="text-gray-500 text-lg max-w-xl mx-auto">
            Explore our wide range of toy categories — something for every age group and interest
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
          {categories.map((cat, i) => (
            <Link
              key={cat.id}
              href={`/products?category=${cat.slug}`}
              className="group relative overflow-hidden rounded-2xl shadow-md card-hover"
              style={{ animationDelay: `${i * 0.1}s` }}
            >
              <div className="aspect-[4/3] relative overflow-hidden">
                <img
                  src={cat.image}
                  alt={cat.name}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                />
                <div className={`absolute inset-0 bg-gradient-to-t ${cat.color} opacity-70 group-hover:opacity-80 transition-opacity`} />
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-4 text-center">
                  <h3 className="text-xl font-black mb-1">{cat.name}</h3>
                  <p className="text-sm text-white/80 mb-3 hidden sm:block">{cat.description}</p>
                  <span className="bg-white/20 backdrop-blur-sm text-white px-3 py-1 rounded-full text-xs font-bold">
                    {cat.count} Products
                  </span>
                </div>
                <div className="absolute bottom-4 right-4 w-9 h-9 bg-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                  <ArrowRight size={16} className="text-[#FF6B35]" />
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="text-center mt-10">
          <Link
            href="/categories"
            className="inline-flex items-center gap-2 border-2 border-[#1A3A6B] text-[#1A3A6B] hover:bg-[#1A3A6B] hover:text-white px-8 py-3 rounded-full font-bold transition-all"
          >
            View All Categories
            <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}
