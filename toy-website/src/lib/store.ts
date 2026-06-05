import { create } from "zustand";
import { persist } from "zustand/middleware";

interface InquiryItem {
  id: number;
  sku: string;
  name: string;
  image: string;
  quantity: number;
}

interface InquiryStore {
  items: InquiryItem[];
  addItem: (item: Omit<InquiryItem, "quantity">) => void;
  removeItem: (id: number) => void;
  updateQty: (id: number, qty: number) => void;
  clear: () => void;
}

export const useInquiryStore = create<InquiryStore>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (item) => {
        const exists = get().items.find((i) => i.id === item.id);
        if (exists) return;
        set((state) => ({ items: [...state.items, { ...item, quantity: 1 }] }));
      },
      removeItem: (id) =>
        set((state) => ({ items: state.items.filter((i) => i.id !== id) })),
      updateQty: (id, qty) =>
        set((state) => ({
          items: state.items.map((i) => (i.id === id ? { ...i, quantity: qty } : i)),
        })),
      clear: () => set({ items: [] }),
    }),
    { name: "inquiry-cart" }
  )
);
