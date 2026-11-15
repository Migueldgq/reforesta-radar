"use client";

import { Check, PlusCircle, Search, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { DEFAULT_FILTERS, EMPTY_DIMS, fmtDayShort, normalize, WEEK_MS, type Dim } from "./model";
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
  note,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  wide?: boolean;
  note?: ReactNode;
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
        {note && <p className="space-y-0.5 border-b px-3 py-2.5 text-xs text-muted-foreground">{note}</p>}
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

/* ---------- Search shortcut: "/" or ⌘K / Ctrl+K, from any page ---------- */

export const SEARCH_ID = "buscar-convocatorias";
let focusWhenMounted = false;

/** Focuses Inicio's search now, or as soon as it appears (when the shortcut first has to go to Inicio). */
export function focusSearch(): boolean {
  const el = document.getElementById(SEARCH_ID);
  if (el instanceof HTMLInputElement) {
    el.focus();
    el.select();
    return true;
  }
  focusWhenMounted = true;
  return false;
}

/* ---------- Toolbar (one row of controls + a row of active filters) ---------- */

export interface BarDim {
  dim: Dim;
  label: string;
  options: Option[];
  wide?: boolean;
  /** A line at the top of the popover (e.g. that the choice is saved for the whole team). */
  note?: ReactNode;
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
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusWhenMounted) return;
    focusWhenMounted = false;
    search.current?.focus();
  }, []);

  const toggle = (dim: Dim, key: string) =>
    setFilters((f) => {
      const cur = f.dims[dim];
      return { ...f, dims: { ...f.dims, [dim]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] } };
    });
  const clear = () => setFilters((f) => ({ ...DEFAULT_FILTERS, hideClosed: f.hideClosed, dims: EMPTY_DIMS }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={search}
            id={SEARCH_ID}
            type="search"
            aria-label="Buscar"
            aria-keyshortcuts="/ Meta+K Control+K"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="Buscar: charcas, ailanto…"
            className="peer h-9 pl-8 lg:pr-9"
          />
          <kbd
            aria-hidden
            title="Pulsa / para buscar desde cualquier pantalla"
            className="pointer-events-none absolute top-1/2 right-2 hidden h-5 -translate-y-1/2 items-center rounded border bg-muted px-1.5 font-sans text-[11px] text-muted-foreground peer-focus:hidden peer-[:not(:placeholder-shown)]:hidden lg:inline-flex"
          >
            /
          </kbd>
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
            note={d.note}
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
  return `Cierran del ${fmtDayShort(w)} al ${fmtDayShort(w + WEEK_MS - 86_400_000)}`;
}
