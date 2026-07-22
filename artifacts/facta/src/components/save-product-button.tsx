import React, { useEffect, useState } from 'react';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { track } from '@/lib/analytics';
import {
  isProductSaved,
  subscribeToSavedProducts,
  toggleSavedProduct,
} from '@/lib/saved-products';

type SaveProductButtonProps = {
  product: {
    id: number;
    name: string;
    nameZh?: string | null;
    brandName?: string | null;
    imageUrl?: string | null;
  };
  evaluation?: {
    overallScore?: number | null;
    scoreGrade?: string | null;
    analysisScope?: string | null;
  };
  compact?: boolean;
  className?: string;
};

export function SaveProductButton({ product, evaluation, compact = false, className }: SaveProductButtonProps) {
  const [saved, setSaved] = useState(() => isProductSaved(product.id));

  useEffect(() => {
    setSaved(isProductSaved(product.id));
    return subscribeToSavedProducts(() => setSaved(isProductSaved(product.id)));
  }, [product.id]);

  const handleToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const result = toggleSavedProduct({
      id: product.id,
      name: product.nameZh || product.name,
      brandName: product.brandName,
      imageUrl: product.imageUrl,
      overallScore: evaluation?.overallScore,
      scoreGrade: evaluation?.scoreGrade,
      analysisScope: evaluation?.analysisScope,
    });
    setSaved(result.saved);
    track(result.saved ? 'product_saved' : 'product_unsaved', { productId: product.id });
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={saved}
      aria-label={saved ? '取消收藏這款商品' : '收藏這款商品'}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
        compact
          ? 'p-2 border border-border bg-background hover:border-foreground'
          : 'px-3 py-2 border border-border bg-background text-xs hover:border-foreground',
        saved && 'border-primary-strong bg-primary/10 text-primary-strong',
        className,
      )}
    >
      {saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
      {!compact && (saved ? '已收藏' : '收藏')}
    </button>
  );
}
