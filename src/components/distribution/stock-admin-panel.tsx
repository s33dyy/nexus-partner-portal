import { useEffect, useMemo, useState } from "react";
import { MapPin, PackagePlus } from "lucide-react";

import { movementTypeLabel } from "@/components/distribution/distribution-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid, FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MOVEMENT_ENDPOINT_RULES,
  type CreateStockLocationInput,
  type InventoryMovementType,
  type PostManualStockMovementInput,
  type RequestableProductSkuView,
  type StockLocationType,
  type DistributionAdminOptions,
  type StockLocationView,
} from "@/domain/contracts/distribution";

/**
 * Super Admin stock administration (product.md §24.4, §24.2).
 *
 * Two things only: create a location, and post a reasoned correction. There
 * is no CSV import, no bulk editor, and no way to type a number straight into
 * a balance — every quantity in this product arrives through a movement with
 * an actor, a reason, and a correlation id behind it, and an admin screen
 * that let someone set `on_hand = 40` would be the one place that wasn't
 * true.
 *
 * The movement types offered here exclude reservation, dispatch, delivery,
 * and reservation_release: those belong to a request line's quantity ladder,
 * and posting one by hand would move stock without moving the request that
 * promised it. The server refuses them too — this just doesn't offer them.
 */
const MANUAL_MOVEMENT_TYPES: InventoryMovementType[] = [
  "opening_balance",
  "receipt",
  "transfer",
  "damage",
  "adjustment",
];

const MOVEMENT_HELP: Record<string, string> = {
  opening_balance: "The first count of a SKU at a location.",
  receipt: "Stock arriving from outside the tracked system.",
  transfer: "Move on-hand stock from one location to another.",
  damage: "Withdraw units from availability pending write-off.",
  adjustment: "A reasoned correction in either direction.",
};

export function StockAdminPanel({
  locations,
  skus,
  options,
  busy,
  onCreateLocation,
  onPostMovement,
}: {
  locations: StockLocationView[];
  skus: RequestableProductSkuView[];
  options: DistributionAdminOptions;
  busy: boolean;
  onCreateLocation: (input: CreateStockLocationInput) => Promise<boolean>;
  onPostMovement: (input: PostManualStockMovementInput) => Promise<boolean>;
}) {
  const [locationOpen, setLocationOpen] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setLocationOpen(true)}>
        <MapPin className="mr-1.5 h-3.5 w-3.5" />
        New location
      </Button>
      <Button variant="outline" size="sm" onClick={() => setMovementOpen(true)}>
        <PackagePlus className="mr-1.5 h-3.5 w-3.5" />
        Post movement
      </Button>

      <LocationDialog
        open={locationOpen}
        onOpenChange={setLocationOpen}
        options={options}
        busy={busy}
        onSubmit={async (input) => {
          if (await onCreateLocation(input)) setLocationOpen(false);
        }}
      />

      <MovementDialog
        open={movementOpen}
        onOpenChange={setMovementOpen}
        locations={locations}
        skus={skus}
        busy={busy}
        onSubmit={async (input) => {
          if (await onPostMovement(input)) setMovementOpen(false);
        }}
      />
    </>
  );
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `mv-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

function LocationDialog({
  open,
  onOpenChange,
  options,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: DistributionAdminOptions;
  busy: boolean;
  onSubmit: (input: CreateStockLocationInput) => Promise<void>;
}) {
  const [locationCode, setLocationCode] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationType, setLocationType] = useState<StockLocationType>("livey_warehouse");
  const [geographyNodeId, setGeographyNodeId] = useState("");
  const [distributorAssignmentId, setDistributorAssignmentId] = useState("");
  const [custodianAssignmentId, setCustodianAssignmentId] = useState("");

  useEffect(() => {
    if (!open) return;
    setLocationCode("");
    setLocationName("");
    setLocationType("livey_warehouse");
    setGeographyNodeId(options.geographyNodes[0]?.nodeId ?? "");
    setDistributorAssignmentId("");
    setCustodianAssignmentId("");
  }, [open, options]);

  // §24.2: a distributor location has exactly one owning Distributor
  // Assignment and a warehouse has none. Stated here so the operator reads it
  // before submitting, and enforced by the command and a database CHECK
  // regardless.
  const validationError = useMemo(() => {
    if (!locationCode.trim()) return "Give the location a short code.";
    if (!locationName.trim()) return "Give the location a name.";
    if (!geographyNodeId) return "Choose where the location sits.";
    if (locationType === "distributor" && !distributorAssignmentId) {
      return "A distributor location needs exactly one owning Distributor.";
    }
    if (locationType === "livey_warehouse" && distributorAssignmentId) {
      return "A LIVEY warehouse has no owning Distributor.";
    }
    return null;
  }, [locationCode, locationName, locationType, geographyNodeId, distributorAssignmentId]);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New stock location"
      description="A place that holds stock. Locations are retired, never deleted — every movement that ever passed through one still names it."
      busy={busy}
      submitLabel="Create location"
      busyLabel="Creating…"
      submitDisabled={Boolean(validationError)}
      footerNote={validationError ?? undefined}
      onSubmit={async () => {
        if (validationError) return;
        await onSubmit({
          locationCode: locationCode.trim(),
          locationName: locationName.trim(),
          locationType,
          geographyNodeId,
          distributorAssignmentId: distributorAssignmentId || null,
          custodianAssignmentId: custodianAssignmentId || null,
        });
      }}
    >
      <FieldGrid>
        <Field label="Code" htmlFor="location-code" required>
          <Input
            id="location-code"
            value={locationCode}
            onChange={(event) => setLocationCode(event.target.value)}
            placeholder="WH-MUM"
          />
        </Field>
        <Field label="Name" htmlFor="location-name" required>
          <Input
            id="location-name"
            value={locationName}
            onChange={(event) => setLocationName(event.target.value)}
            placeholder="Mumbai Warehouse"
          />
        </Field>
        <Field label="Type" htmlFor="location-type" required>
          <Select
            value={locationType}
            onValueChange={(value) => {
              const next = value as StockLocationType;
              setLocationType(next);
              if (next === "livey_warehouse") setDistributorAssignmentId("");
            }}
          >
            <SelectTrigger id="location-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="livey_warehouse">LIVEY warehouse</SelectItem>
              <SelectItem value="distributor">Distributor location</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Geography" htmlFor="location-geography" required>
          <Select value={geographyNodeId} onValueChange={setGeographyNodeId}>
            <SelectTrigger id="location-geography">
              <SelectValue placeholder="Choose a node" />
            </SelectTrigger>
            <SelectContent>
              {options.geographyNodes.map((node) => (
                <SelectItem key={node.nodeId} value={node.nodeId}>
                  {node.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FieldGrid>

      {locationType === "distributor" ? (
        <Field
          label="Owning Distributor"
          htmlFor="location-distributor"
          required
          hint="Only this Distributor can request stock into the location, or see its balances."
        >
          <Select value={distributorAssignmentId} onValueChange={setDistributorAssignmentId}>
            <SelectTrigger id="location-distributor">
              <SelectValue placeholder="Choose a Distributor assignment" />
            </SelectTrigger>
            <SelectContent>
              {options.distributorAssignments.map((assignment) => (
                <SelectItem key={assignment.assignmentId} value={assignment.assignmentId}>
                  {assignment.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : (
        <Field
          label="Custodian"
          htmlFor="location-custodian"
          hint="Whoever allocates and dispatches from this location. Without one, nothing can be fulfilled from here."
        >
          <Select value={custodianAssignmentId} onValueChange={setCustodianAssignmentId}>
            <SelectTrigger id="location-custodian">
              <SelectValue placeholder="Choose a custodian assignment" />
            </SelectTrigger>
            <SelectContent>
              {options.custodianAssignments.map((assignment) => (
                <SelectItem key={assignment.assignmentId} value={assignment.assignmentId}>
                  {assignment.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </FormDialog>
  );
}

function MovementDialog({
  open,
  onOpenChange,
  locations,
  skus,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locations: StockLocationView[];
  skus: RequestableProductSkuView[];
  busy: boolean;
  onSubmit: (input: PostManualStockMovementInput) => Promise<void>;
}) {
  const [movementType, setMovementType] = useState<InventoryMovementType>("opening_balance");
  const [productSkuId, setProductSkuId] = useState("");
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  useEffect(() => {
    if (!open) return;
    // One key per opening of the dialog, so a double-click posts one movement
    // and reopening genuinely means "another one".
    setIdempotencyKey(newIdempotencyKey());
    setMovementType("opening_balance");
    setProductSkuId("");
    setSourceLocationId("");
    setDestinationLocationId("");
    setQuantity("1");
    setReason("");
  }, [open]);

  const rule = MOVEMENT_ENDPOINT_RULES[movementType];
  const activeLocations = useMemo(
    () => locations.filter((location) => location.active),
    [locations],
  );

  const validationError = useMemo(() => {
    if (!productSkuId) return "Choose a product.";
    const parsed = Number(quantity);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return "Quantity must be a whole number greater than zero.";
    }
    if (rule.source === "required" && !sourceLocationId) return "Choose a source location.";
    if (rule.destination === "required" && !destinationLocationId) {
      return "Choose a destination location.";
    }
    if (rule.source === "optional" && rule.destination === "optional") {
      if (!sourceLocationId && !destinationLocationId) {
        return "An adjustment needs a source or a destination.";
      }
    }
    if (sourceLocationId && sourceLocationId === destinationLocationId) {
      return "Source and destination must be different locations.";
    }
    // §24.2: every manual correction carries a reason, because nothing else in
    // the system explains why the number changed.
    if (!reason.trim()) return "Every stock correction needs a reason.";
    return null;
  }, [productSkuId, quantity, rule, sourceLocationId, destinationLocationId, reason]);

  const locationOptions = (which: "source" | "destination") => {
    const endpointRule = which === "source" ? rule.source : rule.destination;
    if (endpointRule === "forbidden") return null;
    const value = which === "source" ? sourceLocationId : destinationLocationId;
    const setValue = which === "source" ? setSourceLocationId : setDestinationLocationId;
    return (
      <Field
        label={which === "source" ? "From" : "To"}
        htmlFor={`movement-${which}`}
        required={endpointRule === "required"}
      >
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger id={`movement-${which}`}>
            <SelectValue placeholder={endpointRule === "required" ? "Choose" : "Optional"} />
          </SelectTrigger>
          <SelectContent>
            {activeLocations.map((location) => (
              <SelectItem key={location.id} value={location.id}>
                {location.locationName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Post a stock movement"
      description="Movements are the ledger. They are never edited or deleted — a mistake is corrected by posting another one."
      busy={busy}
      submitLabel="Post movement"
      busyLabel="Posting…"
      submitDisabled={Boolean(validationError)}
      footerNote={validationError ?? MOVEMENT_HELP[movementType]}
      size="lg"
      onSubmit={async () => {
        if (validationError) return;
        await onSubmit({
          movementType,
          productSkuId,
          sourceLocationId: rule.source === "forbidden" ? null : sourceLocationId || null,
          destinationLocationId:
            rule.destination === "forbidden" ? null : destinationLocationId || null,
          quantity: Number(quantity),
          reason: reason.trim(),
          idempotencyKey,
        });
      }}
    >
      <FieldGrid>
        <Field label="Movement" htmlFor="movement-type" required>
          <Select
            value={movementType}
            onValueChange={(value) => {
              setMovementType(value as InventoryMovementType);
              setSourceLocationId("");
              setDestinationLocationId("");
            }}
          >
            <SelectTrigger id="movement-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MANUAL_MOVEMENT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {movementTypeLabel(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Product" htmlFor="movement-sku" required>
          <Select value={productSkuId} onValueChange={setProductSkuId}>
            <SelectTrigger id="movement-sku">
              <SelectValue placeholder="Choose a product" />
            </SelectTrigger>
            <SelectContent>
              {skus.map((sku) => (
                <SelectItem key={sku.productSkuId} value={sku.productSkuId}>
                  {sku.productName} · {sku.skuCode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Quantity" htmlFor="movement-quantity" required>
          <Input
            id="movement-quantity"
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
        {locationOptions("source")}
        {locationOptions("destination")}
      </FieldGrid>

      <Field label="Reason" htmlFor="movement-reason" required>
        <Textarea
          id="movement-reason"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this quantity changing?"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
        <Badge tone="neutral">Ledger entry</Badge>
        This is recorded with your name, your assignment, and this reason, and cannot be undone
        except by a compensating movement.
      </div>
    </FormDialog>
  );
}
