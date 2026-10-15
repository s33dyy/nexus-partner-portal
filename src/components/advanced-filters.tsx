"use client";

import * as React from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { filterAdvancedFilterOptions, type AdvancedFilterOption } from "./advanced-filters.utils";

export type { AdvancedFilterOption } from "./advanced-filters.utils";

export type AdvancedFiltersProps = {
  children: React.ReactNode;
  activeCount: number;
  onClearAll: () => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  ariaLabel?: string;
  className?: string;
};

export function AdvancedFilters({
  children,
  activeCount,
  onClearAll,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ariaLabel = "Advanced filters",
  className,
}: AdvancedFiltersProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;

  const handleOpenChange = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange} asChild>
      <section
        aria-label={ariaLabel}
        className={cn("rounded-lg border bg-card shadow-card", className)}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 p-3">
          <CollapsibleTrigger asChild>
            <Button aria-label={ariaLabel} className="justify-start" variant="ghost" type="button">
              <SlidersHorizontal aria-hidden="true" />
              <span>{ariaLabel}</span>
              {activeCount > 0 ? (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                  {activeCount}
                </span>
              ) : null}
              <ChevronDown
                aria-hidden="true"
                className={cn("transition-transform", open && "rotate-180")}
              />
            </Button>
          </CollapsibleTrigger>
          {activeCount > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={onClearAll}>
              Clear all
            </Button>
          ) : null}
        </div>
        <CollapsibleContent>
          <div className="grid gap-4 border-t p-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

type FilterFieldProps = {
  label: string;
  id: string;
  className?: string;
};

function FilterField({
  label,
  id,
  className,
  children,
}: FilterFieldProps & { children: React.ReactNode }) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export type AdvancedFilterTextFieldProps = FilterFieldProps & {
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  inputProps?: Omit<React.ComponentPropsWithoutRef<typeof Input>, "id" | "value" | "onChange">;
};

export function AdvancedFilterTextField({
  label,
  id,
  value,
  onChange,
  placeholder,
  inputProps,
  className,
}: AdvancedFilterTextFieldProps) {
  return (
    <FilterField label={label} id={id} className={className}>
      <Input id={id} value={value} onChange={onChange} placeholder={placeholder} {...inputProps} />
    </FilterField>
  );
}

export type AdvancedFilterSelectFieldProps = FilterFieldProps & {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly AdvancedFilterOption[];
  placeholder?: string;
  disabled?: boolean;
};

export function AdvancedFilterSelectField({
  label,
  id,
  value,
  onValueChange,
  options,
  placeholder = "Select an option",
  disabled,
  className,
}: AdvancedFilterSelectFieldProps) {
  return (
    <FilterField label={label} id={id} className={className}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} disabled={disabled}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {filterAdvancedFilterOptions(options).map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterField>
  );
}

export type AdvancedFilterNumericRangeFieldProps = FilterFieldProps & {
  minValue: string;
  maxValue: string;
  onMinChange: React.ChangeEventHandler<HTMLInputElement>;
  onMaxChange: React.ChangeEventHandler<HTMLInputElement>;
  minPlaceholder?: string;
  maxPlaceholder?: string;
};

export function AdvancedFilterNumericRangeField({
  label,
  id,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  minPlaceholder = "Minimum",
  maxPlaceholder = "Maximum",
  className,
}: AdvancedFilterNumericRangeFieldProps) {
  const minId = `${id}-min`;
  const maxId = `${id}-max`;

  return (
    <fieldset className={cn("min-w-0 space-y-1.5", className)}>
      <legend className="text-sm font-medium leading-none">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <Input
          id={minId}
          type="number"
          inputMode="decimal"
          value={minValue}
          onChange={onMinChange}
          placeholder={minPlaceholder}
          aria-label={`${label} minimum`}
        />
        <Input
          id={maxId}
          type="number"
          inputMode="decimal"
          value={maxValue}
          onChange={onMaxChange}
          placeholder={maxPlaceholder}
          aria-label={`${label} maximum`}
        />
      </div>
    </fieldset>
  );
}

export type AdvancedFilterDateRangeFieldProps = FilterFieldProps & {
  fromValue: string;
  toValue: string;
  onFromChange: React.ChangeEventHandler<HTMLInputElement>;
  onToChange: React.ChangeEventHandler<HTMLInputElement>;
  fromLabel?: string;
  toLabel?: string;
};

export function AdvancedFilterDateRangeField({
  label,
  id,
  fromValue,
  toValue,
  onFromChange,
  onToChange,
  fromLabel = "From",
  toLabel = "To",
  className,
}: AdvancedFilterDateRangeFieldProps) {
  const fromId = `${id}-from`;
  const toId = `${id}-to`;

  return (
    <fieldset className={cn("min-w-0 space-y-1.5", className)}>
      <legend className="text-sm font-medium leading-none">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="sr-only" htmlFor={fromId}>
            {fromLabel}
          </Label>
          <Input
            id={fromId}
            type="date"
            value={fromValue}
            onChange={onFromChange}
            aria-label={`${label} ${fromLabel.toLowerCase()}`}
          />
        </div>
        <div>
          <Label className="sr-only" htmlFor={toId}>
            {toLabel}
          </Label>
          <Input
            id={toId}
            type="date"
            value={toValue}
            onChange={onToChange}
            aria-label={`${label} ${toLabel.toLowerCase()}`}
          />
        </div>
      </div>
    </fieldset>
  );
}
