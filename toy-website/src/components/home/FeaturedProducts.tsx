import Link from "next/link";
import { ArrowRight, ShoppingBag, Award } from "lucide-react";
import { products } from "@/lib/data";

export default function FeaturedProducts() {
  const featured = products.filter((p) => p.isFeatured).slice(0, 4);

  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between mb-12 gap-4">
          <div>
            <div className="section-badge">Hot Products</div>
            <h2 className="text-4xl font-black text-[#1A3A6B]">Featured Products</h2>
            <div className="w-14 h-1 bg-gradient-to-r from-[#FF6B35] to-[#FFD700] rounded mt-3" />
          </div>
          <Link
            href="/products"
            className="flex items-center gap-2 text-[#FF6B35] font-bold hover:underline"
          >
            View All Products
            <ArrowRight size={16} />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {featured.map((product) => (
            <Link
              key={product.id}
              href={`/products/${product.id}`}
              className="group bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm card-hover"
            >
              {/* Image */}
              <div className="relative aspect-square overflow-hidden bg-gray-50">
                <img
                  src={product.images[0]}
                  alt={product.name}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                />
                {/* Badges */}
                <div className="absolute top-3 left-3 flex flex-col gap-1">
                  {product.isNew && (
                    <span className="bg-[#FF6B35] text-white text-xs font-bold px-2 py-0.5 rounded-full">NEW</span>
                  )}
                </div>
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-[#1A3A6B]/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="bg-white text-[#1A3A6B] px-4 py-2 rounded-full font-bold text-sm flex items-center gap-2">
                    <ShoppingBag size={14} />
                    View Details
                  </span>
                </div>
              </div>

              {/* Info */}
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs bg-blue-50 text-[#1A3A6B] px-2 py-0.5 rounded-full font-semibold">
                    {product.category}
                  </span>
                  <span className="text-xs text-gray-400">Age {product.ageRange}y</span>
                </div>
                <h3 className="font-bold text-[#1A3A6B] text-sm leading-tight mb-1 group-hover:text-[#FF6B35] transition-colors">
                  {product.name}
                </h3>
                <p className="text-xs text-gray-400 mb-3">SKU: {product.sku}</p>
                <div className="flex items-center justify-between">
                  <div className="flex gap-1">
                    {product.certifications.slice(0, 2).map((cert) => (
                      <span key={cert} className="flex items-center gap-0.5 text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-semibold">
                        <Award size={10} />
                        {cert}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs text-gray-500">MOQ: {product.moq}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
