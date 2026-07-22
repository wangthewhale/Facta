const STORAGE_KEY = 'facta_saved_products_v1';
const CHANGE_EVENT = 'facta:saved-products-changed';
const MAX_SAVED_PRODUCTS = 50;

export type SavedProduct = {
  id: number;
  name: string;
  brandName?: string | null;
  imageUrl?: string | null;
  overallScore?: number | null;
  scoreGrade?: string | null;
  analysisScope?: string | null;
  savedAt: string;
};

function isSavedProduct(value: unknown): value is SavedProduct {
  if (!value || typeof value !== 'object') return false;
  const product = value as Record<string, unknown>;
  return Number.isInteger(product.id) && Number(product.id) > 0 &&
    typeof product.name === 'string' && product.name.trim().length > 0 &&
    typeof product.savedAt === 'string';
}

export function getSavedProducts(): SavedProduct[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedProduct).slice(0, MAX_SAVED_PRODUCTS);
  } catch {
    return [];
  }
}

export function isProductSaved(productId: number): boolean {
  return getSavedProducts().some(product => product.id === productId);
}

export function toggleSavedProduct(
  product: Omit<SavedProduct, 'savedAt'>,
): { saved: boolean; products: SavedProduct[] } {
  const current = getSavedProducts();
  const alreadySaved = current.some(item => item.id === product.id);
  const products = alreadySaved
    ? current.filter(item => item.id !== product.id)
    : [{ ...product, savedAt: new Date().toISOString() }, ...current.filter(item => item.id !== product.id)]
        .slice(0, MAX_SAVED_PRODUCTS);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: products }));
    return { saved: !alreadySaved, products };
  } catch {
    // Saving is a convenience feature; storage failures must not block reports.
    return { saved: alreadySaved, products: current };
  }
}

export function subscribeToSavedProducts(callback: (products: SavedProduct[]) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const onChange = () => callback(getSavedProducts());
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}
