"use client";

import { Button } from "@/components/ui/button";

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  const pages = Array.from({ length: totalPages }, (_, i) => i)
    .filter(
      (i) => i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 1
    )
    .reduce<(number | "...")[]>((acc, i) => {
      const last = acc[acc.length - 1];
      if (typeof last === "number" && i - last > 1) acc.push("...");
      acc.push(i);
      return acc;
    }, []);

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => onPageChange(Math.max(0, page - 1))}
        disabled={page === 0}
      >
        ‹
      </Button>
      {pages.map((item, idx) =>
        item === "..." ? (
          <span
            key={`dots-${idx}`}
            className="w-7 text-center text-xs text-muted-foreground"
          >
            ...
          </span>
        ) : (
          <Button
            key={item}
            variant={page === item ? "default" : "ghost"}
            size="sm"
            className="h-7 w-7 p-0 text-xs"
            onClick={() => onPageChange(item)}
          >
            {item + 1}
          </Button>
        )
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
        disabled={page >= totalPages - 1}
      >
        ›
      </Button>
    </div>
  );
}
