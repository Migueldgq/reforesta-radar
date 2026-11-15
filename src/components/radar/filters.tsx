"use client";

import { Check, PlusCircle, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { DEFAULT_FILTERS, EMPTY_DIMS, fmtDayShort, normalize, type Dim } from "./model";
import { useRadar } from "./store";

export interface Option {
  key: string;
  label: string;
  count: number;
}

/* ---------- Faceted filter (shadcn pattern: outline button + popover with a command list) ---------- */

function FacetedFilter({
  label,
  options,
  selected,
  onToggle,
  onClear,
  wide,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  wide?: boolean;
}) {
  const n = selected.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-9 border-dashed whitespace-nowrap", n > 0 && "border-solid border-primary/40")}>
          <PlusCircle aria-hidden />
          {label}
          {n > 0 && (
            <>
              <Separator orientation="vertical" className="mx-0.5 data-[orientation=vertical]:h-4" />
              <Badge variant="secondary" className="rounded-sm px-1.5 font-medium tabular-nums">
                {n}
              </Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("p-0", wide ? "w-[min(24rem,calc(100vw-2rem))]" : "w-64")} align="start">
        {/* Plain accent-insensitive substring match: cmdk's fuzzy default matches unrelated long names. */}
        <Command filter={(value, search) => (normalize(value).includes(normalize(search.trim())) ? 1 : 0)}>
          {options.length > 7 && <CommandInput placeholder={label} />}
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = selected.includes(o.key);
                return (
                  <CommandItem key={o.key} value={o.label} onSelect={() => onToggle(o.key)} className={cn(o.count === 0 && !on && "opacity-50")}>
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded-[4px] border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {on && <Check className="size-3 text-primary-foreground" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate" title={o.label}>
                      {o.label}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">{o.count}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {n > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={onClear} className="justify-center text-center">
                    Quitar selección
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ---------- Toolbar (one row of controls + a row of active filters) ---------- */

export interface BarDim {
  dim: Dim;
  label: string;
  options: Option[];
  wide?: boolean;
}

export function FilterBar({
  dims,
  chips,
  total,
}: {
  dims: BarDim[];
  chips: { key: string; label: string; remove: () => void }[];
  total: number;
}) {
  const { filters, setFilters } = useRadar();

  const toggle = (dim: Dim, key: string) =>
    setFilters((f) => {
      const cur = f.dims[dim];
      return { ...f, dims: { ...f.dims, [dim]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] } };
    });
  const clear = () => setFilters((f) => ({ ...DEFAULT_FILTERS, hideClosed: f.hideClosed, dims: EMPTY_DIMS }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-52">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Buscar"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="Buscar: charcas, ailanto…"
            className="h-9 pl-8"
          />
        </div>
        {dims.map((d) => (
          <FacetedFilter
            key={d.dim}
            label={d.label}
            options={d.options}
            selected={filters.dims[d.dim]}
            onToggle={(k) => toggle(d.dim, k)}
            onClear={() => setFilters((f) => ({ ...f, dims: { ...f.dims, [d.dim]: [] } }))}
            wide={d.wide}
          />
        ))}
        {chips.length > 0 && (
          <Button variant="ghost" size="sm" className="h-9" onClick={clear}>
            Limpiar
            <X aria-hidden />
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{total}</span> {total === 1 ? "convocatoria" : "convocatorias"}
        </span>
        {chips.map((c) => (
          <FilterBadge key={c.key} label={c.label} onRemove={c.remove} />
        ))}
      </div>
    </div>
  );
}

function FilterBadge({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Badge variant="secondary" className="max-w-full gap-0.5 py-0 pr-0.5 font-normal">
      <span className="truncate" title={label}>
        {label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Quitar filtro: ${label}`}
        className="grid size-5 cursor-pointer place-items-center rounded-sm hover:bg-foreground/10"
      >
        <X className="size-3" aria-hidden />
      </button>
    </Badge>
  );
}

export function weekChipLabel(w: number) {
  return `Cierran la semana del ${fmtDayShort(w)}`;
}
