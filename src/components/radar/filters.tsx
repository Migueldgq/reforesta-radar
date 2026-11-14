"use client";

import { Check, PlusCircle, Search, X } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_FILTERS, EMPTY_DIMS, fmtDayShort, type Dim } from "./model";
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
}: {
  label: string;
  options: Option[];
  selected: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
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
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
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
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
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
}

export function FilterBar({
  dims,
  chips,
  total,
  fueraCount,
}: {
  dims: BarDim[];
  chips: { key: string; label: string; remove: () => void }[];
  total: number;
  fueraCount: number;
}) {
  const { filters, setFilters } = useRadar();
  const switchId = useId();

  const toggle = (dim: Dim, key: string) =>
    setFilters((f) => {
      const cur = f.dims[dim];
      return { ...f, dims: { ...f.dims, [dim]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] } };
    });
  const fuera = filters.flags.includes("fuera");
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
          />
        ))}
        {chips.length > 0 && (
          <Button variant="ghost" size="sm" className="h-9" onClick={clear}>
            Limpiar
            <X aria-hidden />
          </Button>
        )}
        <div className="ml-auto flex h-9 items-center gap-2 pl-1">
          <Switch
            id={switchId}
            checked={fuera}
            onCheckedChange={(v) => setFilters((f) => ({ ...f, flags: v ? [...f.flags, "fuera"] : f.flags.filter((x) => x !== "fuera") }))}
          />
          <label htmlFor={switchId} className="cursor-pointer text-sm whitespace-nowrap">
            Fuera de tus 4 fuentes <span className="text-muted-foreground tabular-nums">{fueraCount}</span>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{total}</span> {total === 1 ? "convocatoria" : "convocatorias"}
        </span>
        {!filters.dims.plazo.includes("cerrada") &&
          (filters.hideClosed ? (
            <FilterBadge label="Ocultando cerradas" muted onRemove={() => setFilters((f) => ({ ...f, hideClosed: false }))} />
          ) : (
            <Button variant="link" size="sm" className="h-6 px-1 text-xs" onClick={() => setFilters((f) => ({ ...f, hideClosed: true }))}>
              Incluye cerradas · ocultarlas
            </Button>
          ))}
        {chips.map((c) => (
          <FilterBadge key={c.key} label={c.label} onRemove={c.remove} />
        ))}
      </div>
    </div>
  );
}

function FilterBadge({ label, onRemove, muted = false }: { label: string; onRemove: () => void; muted?: boolean }) {
  return (
    <Badge variant={muted ? "outline" : "secondary"} className={cn("max-w-full gap-0.5 py-0 pr-0.5 font-normal", muted && "text-muted-foreground")}>
      <span className="truncate">{label}</span>
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
