import { DEAL_PROBABILITY_OPTIONS, normalizeDealProbability } from "@/lib/deal-probability";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DealProbabilitySelectProps = {
  value: number;
  onValueChange: (value: number) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function DealProbabilitySelect({
  value,
  onValueChange,
  placeholder = "Select probability",
  disabled = false,
}: DealProbabilitySelectProps) {
  return (
    <Select
      value={String(normalizeDealProbability(value))}
      onValueChange={(nextValue) => onValueChange(Number(nextValue))}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {DEAL_PROBABILITY_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={String(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
