import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  listLookupValues as fetchLookupValues,
  upsertLookupValue as saveLookupValue,
} from "@/integrations/local/lookups";

type LookupComboboxProps = {
  fieldName: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  clearLabel?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  allowCreate?: boolean;
  allowClear?: boolean;
  options?: string[];
  emptyLabel?: string;
};

const lookupCache = new Map<string, string[]>();

function uniqueValues(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function LookupCombobox({
  fieldName,
  label,
  value,
  onValueChange,
  placeholder,
  clearLabel,
  className,
  triggerClassName,
  disabled,
  allowCreate = true,
  allowClear = false,
  options = [],
  emptyLabel,
}: LookupComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [lookupValues, setLookupValues] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const cached = lookupCache.get(fieldName);
    if (cached) {
      setLookupValues(cached);
      return;
    }
    setLoading(true);
    void fetchLookupValues(fieldName)
      .then((rows) => {
        if (!active) return;
        const values = uniqueValues(rows.map((row) => row.value));
        lookupCache.set(fieldName, values);
        setLookupValues(values);
      })
      .catch(() => {
        if (!active) return;
        setLookupValues([]);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fieldName]);

  const mergedOptions = useMemo(
    () => uniqueValues([...lookupValues, ...options]),
    [lookupValues, options],
  );

  const filteredOptions = useMemo(() => {
    const term = normalize(search);
    if (!term) return mergedOptions;
    return mergedOptions.filter((option) => option.toLowerCase().includes(term));
  }, [mergedOptions, search]);

  const selectedLabel = value.trim() || placeholder || `Select ${label.toLowerCase()}`;
  const normalizedValue = normalize(value);
  const hasCurrentValue = normalizedValue
    ? mergedOptions.some((option) => normalize(option) === normalizedValue)
    : false;
  const createValue = search.trim();
  const canCreate =
    allowCreate &&
    createValue.length > 0 &&
    !mergedOptions.some((option) => normalize(option) === normalize(createValue));
  const canClear = allowClear && value.trim().length > 0;

  const choose = (nextValue: string) => {
    onValueChange(nextValue);
    setSearch("");
    setOpen(false);
  };

  const createAndChoose = async (nextValue: string) => {
    const created = await saveLookupValue(fieldName, nextValue);
    const next = uniqueValues([...mergedOptions, created.value]);
    lookupCache.set(fieldName, next);
    setLookupValues(next);
    choose(created.value);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between gap-2 font-normal", triggerClassName)}
        >
          <span className="truncate text-left">{selectedLabel}</span>
          <div className="flex items-center gap-2 text-muted-foreground">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <ChevronsUpDown className="h-4 w-4 opacity-60" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-[var(--radix-popover-trigger-width)] p-0", className)}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={`Search ${label.toLowerCase()}...`}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              <div className="space-y-2 p-4 text-sm text-muted-foreground">
                <div>{emptyLabel ?? "No matches found."}</div>
                {canClear ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => choose("")}>
                    {clearLabel ?? `Clear ${label.toLowerCase()}`}
                  </Button>
                ) : null}
                {canCreate ? (
                  <Button type="button" size="sm" onClick={() => void createAndChoose(createValue)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create "{createValue}"
                  </Button>
                ) : null}
              </div>
            </CommandEmpty>
            <CommandGroup heading={label}>
              {canClear ? (
                <CommandItem value="__clear__" onSelect={() => choose("")}>
                  {clearLabel ?? `Clear ${label.toLowerCase()}`}
                </CommandItem>
              ) : null}
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={() => choose(option)}
                  className="flex items-center justify-between"
                >
                  <span className="truncate">{option}</span>
                  {hasCurrentValue && normalize(option) === normalizedValue ? (
                    <Check className="h-4 w-4" />
                  ) : null}
                </CommandItem>
              ))}
              {canCreate ? (
                <CommandItem
                  value={`create-${createValue}`}
                  onSelect={() => void createAndChoose(createValue)}
                >
                  <Plus className="h-4 w-4" />
                  Create "{createValue}"
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
