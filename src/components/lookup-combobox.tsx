import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  createDropdownCatalogItem,
  listDropdownSourceValues as listCanonicalDropdownValues,
} from "@/integrations/local/dropdown-sources";
import {
  listLookupValues as listLegacyLookupValues,
  upsertLookupValue as saveLookupValue,
} from "@/integrations/local/lookups";
import { useAuth } from "@/hooks/use-auth";
import { getCatalogKindLabel, type CatalogKind } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { type DropdownOption, type DropdownSourceKey } from "@/lib/dropdown-sources";
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

type LookupComboboxProps = {
  fieldName: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  onSelectionChange?: (selection: DropdownOption | null) => void;
  source?: DropdownSourceKey;
  placeholder?: string;
  clearLabel?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  allowCreate?: boolean;
  allowClear?: boolean;
  options?: string[];
  emptyLabel?: string;
  onCreateRequest?: (value: string) => void;
  catalogKind?: CatalogKind | "all";
};

function uniqueOptions(values: DropdownOption[]) {
  const seen = new Set<string>();
  const out: DropdownOption[] = [];
  for (const option of values) {
    const label = option.label.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...option, label });
  }
  return out;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function toStaticOption(label: string, source: DropdownSourceKey): DropdownOption {
  return {
    id: `${source}:${normalize(label)}`,
    label: label.trim(),
    description: null,
    source,
  };
}

export function LookupCombobox({
  fieldName,
  label,
  value,
  onValueChange,
  onSelectionChange,
  source = "lookup",
  placeholder,
  clearLabel,
  className,
  triggerClassName,
  disabled,
  allowCreate = true,
  allowClear = false,
  options = [],
  emptyLabel,
  onCreateRequest,
  catalogKind = "product",
}: LookupComboboxProps) {
  const { profile, hasRole } = useAuth();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadedOptions, setLoadedOptions] = useState<DropdownOption[]>([]);

  const resolvedSource = source ?? "lookup";
  const scopedPartnerId = hasRole("super_admin") ? null : (profile?.partner_id ?? null);
  const scopedUserId = hasRole("super_admin") ? null : (profile?.id ?? null);

  useEffect(() => {
    let active = true;
    if (!open && hasLoaded) {
      return () => {
        active = false;
      };
    }

    setLoading(true);
    const loadOptions = async () => {
      try {
        if (resolvedSource === "lookup") {
          const rows = await listLegacyLookupValues(fieldName);
          if (!active) return;
          setLoadedOptions(
            uniqueOptions(
              rows.map((row) => ({
                id: row.id,
                label: row.value,
                description: null,
                source: "lookup",
              })),
            ),
          );
          setHasLoaded(true);
          return;
        }

        const rows = await listCanonicalDropdownValues({
          source: resolvedSource,
          fieldName,
          partnerId: scopedPartnerId,
          userId: scopedUserId,
          catalogKind,
        });
        if (!active) return;
        setLoadedOptions(uniqueOptions(rows));
        setHasLoaded(true);
      } catch {
        if (!active) return;
        setLoadedOptions([]);
        setHasLoaded(true);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadOptions();

    return () => {
      active = false;
    };
  }, [
    catalogKind,
    fieldName,
    hasLoaded,
    open,
    profile?.id,
    profile?.partner_id,
    resolvedSource,
    hasRole,
    scopedPartnerId,
    scopedUserId,
  ]);

  const mergedOptions = useMemo(() => {
    const mappedStatic = options.map((option) => toStaticOption(option, resolvedSource));
    return uniqueOptions([...loadedOptions, ...mappedStatic]);
  }, [loadedOptions, options, resolvedSource]);

  const filteredOptions = useMemo(() => {
    const term = normalize(search);
    if (!term) return mergedOptions;
    return mergedOptions.filter((option) => {
      const haystack = [option.label, option.description ?? ""].join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [mergedOptions, search]);

  const normalizedValue = normalize(value);
  const hasCurrentValue = normalizedValue
    ? mergedOptions.some((option) => normalize(option.label) === normalizedValue)
    : false;
  const selectedLabel = value.trim() || placeholder || `Select ${label.toLowerCase()}`;
  const createValue = search.trim();
  const optionExists = mergedOptions.some(
    (option) => normalize(option.label) === normalize(createValue),
  );
  const canCreateLookup =
    resolvedSource === "lookup" && allowCreate && createValue.length > 0 && !optionExists;
  const canCreateCatalog =
    resolvedSource === "catalog" && allowCreate && createValue.length > 0 && !optionExists;
  const canCreateClient =
    resolvedSource === "client" &&
    allowCreate &&
    Boolean(onCreateRequest) &&
    createValue.length > 0 &&
    !optionExists;
  const canCreate = canCreateLookup || canCreateCatalog || canCreateClient;
  const canClear = allowClear && value.trim().length > 0;

  const choose = (nextValue: DropdownOption | null) => {
    onValueChange(nextValue?.label ?? "");
    onSelectionChange?.(nextValue);
    setSearch("");
    setOpen(false);
  };

  const createAndChoose = async (nextValue: string) => {
    if (resolvedSource === "client" && onCreateRequest) {
      onCreateRequest(nextValue);
      setSearch("");
      setOpen(false);
      return;
    }

    if (resolvedSource === "catalog") {
      try {
        const created = await createDropdownCatalogItem({
          product_name: nextValue,
          catalog_kind: catalogKind === "all" ? "product" : catalogKind,
        });
        const nextOption: DropdownOption = {
          id: created.id,
          label: created.product_name,
          description: `${getCatalogKindLabel(created.catalog_kind ?? "product")} · ${created.sku}`,
          source: "catalog",
        };
        setLoadedOptions((current) => uniqueOptions([...current, nextOption]));
        choose(nextOption);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to create option");
      }
      return;
    }

    if (resolvedSource !== "lookup") {
      return;
    }

    try {
      const created = await saveLookupValue(fieldName, nextValue);
      const nextOption: DropdownOption = {
        id: created.id,
        label: created.value,
        description: null,
        source: "lookup",
      };
      setLoadedOptions((current) => uniqueOptions([...current, nextOption]));
      choose(nextOption);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create option");
    }
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
                  <Button type="button" variant="ghost" size="sm" onClick={() => choose(null)}>
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
                <CommandItem value="__clear__" onSelect={() => choose(null)}>
                  {clearLabel ?? `Clear ${label.toLowerCase()}`}
                </CommandItem>
              ) : null}
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.label}
                  onSelect={() => choose(option)}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="truncate">{option.label}</div>
                    {option.description ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {option.description}
                      </div>
                    ) : null}
                  </div>
                  {hasCurrentValue && normalize(option.label) === normalizedValue ? (
                    <Check className="h-4 w-4 shrink-0" />
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
