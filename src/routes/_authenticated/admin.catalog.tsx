import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { CsvExportButton } from "@/components/csv-export-button";
import { AccessDeniedPage } from "@/components/route-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LookupCombobox } from "@/components/lookup-combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/local/client";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import { formatCsvDate, type CsvColumn } from "@/lib/csv-export";
import { type CatalogItemRecord } from "@/lib/portal-records";
import { useAuth } from "@/hooks/use-auth";

type CatalogForm = {
  sku: string;
  product_name: string;
  category: string;
  partner_tier: string;
  list_price: string;
  margin: string;
  stock: number;
  availability: string;
  benefits: string;
};

const EMPTY_FORM: CatalogForm = {
  sku: "",
  product_name: "",
  category: "Hardware",
  partner_tier: "Registered",
  list_price: "$0",
  margin: "0%",
  stock: 0,
  availability: "In stock",
  benefits: "",
};

function uniqueStrings(values: Array<string | number | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter((value) => !!value))];
}

const CATALOG_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "sku", header: "SKU" },
  { key: "product_name", header: "Product" },
  { key: "category", header: "Category" },
  { key: "partner_tier", header: "Partner Tier" },
  { key: "list_price", header: "List Price" },
  { key: "margin", header: "Margin" },
  { key: "stock", header: "Stock" },
  { key: "availability", header: "Availability" },
  { key: "benefits", header: "Benefits" },
];

export const Route = createFileRoute("/_authenticated/admin/catalog")({
  component: AdminCatalogPage,
});

function AdminCatalogPage() {
  const { hasRole } = useAuth();
  const [items, setItems] = useState<CatalogItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CatalogForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("portal_catalog_items")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const rows = (data as CatalogItemRecord[] | null) ?? [];
      setItems(rows);
      setSource(rows.length > 0 ? "database" : "empty");
      setSelectedId((current) => current ?? rows[0]?.id ?? null);
    } catch {
      setItems([]);
      setSource("empty");
      setSelectedId(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
      const matchesQuery =
        !term ||
        [item.sku, item.product_name, item.category, item.partner_tier, item.benefits]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return matchesCategory && matchesQuery;
    });
  }, [categoryFilter, items, query]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const editOptions = useMemo(() => {
    return {
      skus: uniqueStrings(items.map((item) => item.sku)),
      productNames: uniqueStrings(items.map((item) => item.product_name)),
      categories: uniqueStrings(items.map((item) => item.category)),
      tiers: uniqueStrings(items.map((item) => item.partner_tier)),
      prices: uniqueStrings(items.map((item) => item.list_price)),
      margins: uniqueStrings(items.map((item) => item.margin)),
      availability: uniqueStrings(items.map((item) => item.availability)),
    };
  }, [items]);

  const categories = useMemo(
    () => ["all", ...new Set(items.map((item) => item.category))],
    [items],
  );

  useEffect(() => {
    if (!selectedItem) return;
    setDraft({
      sku: selectedItem.sku,
      product_name: selectedItem.product_name,
      category: selectedItem.category,
      partner_tier: selectedItem.partner_tier,
      list_price: selectedItem.list_price,
      margin: selectedItem.margin,
      stock: selectedItem.stock,
      availability: selectedItem.availability,
      benefits: selectedItem.benefits,
    });
  }, [selectedItem]);

  if (!hasRole("super_admin")) {
    return <AccessDeniedPage title="Tiers & products" roleLabel="Super Admin" />;
  }

  const saveItem = async () => {
    if (!selectedItem) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("portal_catalog_items")
        .update({
          sku: draft.sku,
          product_name: draft.product_name,
          category: draft.category,
          partner_tier: draft.partner_tier,
          list_price: draft.list_price,
          margin: draft.margin,
          stock: draft.stock,
          availability: draft.availability,
          benefits: draft.benefits,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedItem.id);
      if (error) throw error;
      toast.success("Catalog item updated");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save item");
    } finally {
      setSaving(false);
    }
  };

  const addItem = async () => {
    if (!draft.sku.trim() || !draft.product_name.trim()) {
      toast.error("SKU and product name are required");
      return;
    }
    setAdding(true);
    try {
      const payload = {
        id: crypto.randomUUID(),
        ...draft,
        is_seed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("portal_catalog_items").insert(payload);
      if (error) throw error;
      toast.success("Catalog item added");
      setDraft(EMPTY_FORM);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add item");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Administration
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Tiers & products</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Define partner tiers, benefits, and product offerings that shape the portal.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {source === "database" ? "Live Postgres data" : "Empty state"}
          </Badge>
          <Button
            variant="outline"
            onClick={() => {
              setRefreshing(true);
              void load();
            }}
            disabled={loading || refreshing}
          >
            {loading || refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
          <CsvExportButton
            label="Export CSV"
            filename={`livey-catalog-${formatCsvDate()}.csv`}
            columns={CATALOG_EXPORT_COLUMNS}
            loadRows={async () =>
              filteredItems.map((item) => ({
                sku: item.sku,
                product_name: item.product_name,
                category: item.category,
                partner_tier: item.partner_tier,
                list_price: item.list_price,
                margin: item.margin,
                stock: item.stock,
                availability: item.availability,
                benefits: item.benefits,
              }))
            }
            variant="outline"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Items" value={String(items.length)} hint="Catalog records" />
        <Metric
          label="Registered"
          value={String(items.filter((item) => item.partner_tier === "Registered").length)}
          hint="Entry-level offers"
        />
        <Metric
          label="In stock"
          value={String(items.filter((item) => item.availability === "In stock").length)}
          hint="Ready to sell"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="space-y-4 border-b">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Catalog items</CardTitle>
                <CardDescription>Search, filter, and edit the live product set.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search catalog"
                    className="pl-8"
                  />
                </div>
                <LookupCombobox
                  fieldName={LOOKUP_FIELDS.catalogCategory}
                  label="Category"
                  value={categoryFilter === "all" ? "" : categoryFilter}
                  onValueChange={(value) => setCategoryFilter(value || "all")}
                  placeholder="All categories"
                  clearLabel="All categories"
                  allowClear
                  options={categories.filter((category) => category !== "all")}
                  triggerClassName="w-44"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading catalog...
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="p-8 text-sm text-muted-foreground">
                No catalog items match this view.
              </div>
            ) : (
              <div className="divide-y">
                {filteredItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-muted/40 ${
                      selectedItem?.id === item.id ? "bg-muted/40" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-medium">{item.product_name}</div>
                        <Badge variant="outline">{item.partner_tier}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {item.sku} · {item.category}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{item.list_price}</div>
                      <div className="text-xs text-muted-foreground">{item.availability}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Edit item</CardTitle>
              <CardDescription>
                {selectedItem
                  ? `Editing ${selectedItem.product_name}`
                  : "Select a catalog item to edit."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedItem ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="SKU">
                      <LookupCombobox
                        fieldName={LOOKUP_FIELDS.catalogSku}
                        label="SKU"
                        value={draft.sku}
                        onValueChange={(value) =>
                          setDraft((current) => ({ ...current, sku: value }))
                        }
                        placeholder="Select or create SKU"
                        options={editOptions.skus}
                      />
                    </Field>
                    <Field label="Product name">
                      <LookupCombobox
                        fieldName={LOOKUP_FIELDS.catalogProduct}
                        label="Product name"
                        value={draft.product_name}
                        onValueChange={(value) =>
                          setDraft((current) => ({ ...current, product_name: value }))
                        }
                        placeholder="Select or create product"
                        options={editOptions.productNames}
                      />
                    </Field>
                    <Field label="Category">
                      <LookupCombobox
                        fieldName={LOOKUP_FIELDS.catalogCategory}
                        label="Category"
                        value={draft.category}
                        onValueChange={(value) =>
                          setDraft((current) => ({ ...current, category: value }))
                        }
                        placeholder="Select or create category"
                        options={editOptions.categories}
                      />
                    </Field>
                    <Field label="Tier">
                      <LookupCombobox
                        fieldName={LOOKUP_FIELDS.catalogTier}
                        label="Tier"
                        value={draft.partner_tier}
                        onValueChange={(value) =>
                          setDraft((current) => ({ ...current, partner_tier: value }))
                        }
                        placeholder="Select or create tier"
                        options={editOptions.tiers}
                      />
                    </Field>
                    <Field label="List price">
                      <LookupCombobox
                        fieldName={LOOKUP_FIELDS.catalogPrice}
                        label="List price"
                        value={draft.list_price}
                        onValueChange={(value) =>
                          setDraft((current) => ({ ...current, list_price: value }))
                        }
                        placeholder="Select or create price"
                        options={editOptions.prices}
                      />
                    </Field>
                    <Field label="Margin">
                      <LookupCombobox
                        fieldName={LOOKUP_FIELDS.catalogMargin}
                        label="Margin"
                        value={draft.margin}
                        onValueChange={(value) =>
                          setDraft((current) => ({ ...current, margin: value }))
                        }
                        placeholder="Select or create margin"
                        options={editOptions.margins}
                      />
                    </Field>
                    <Field label="Stock">
                      <Input
                        type="number"
                        value={draft.stock}
                        onChange={(e) =>
                          setDraft((value) => ({ ...value, stock: Number(e.target.value) || 0 }))
                        }
                      />
                    </Field>
                    <Field label="Availability">
                      <LookupCombobox
                        fieldName={LOOKUP_FIELDS.catalogAvailability}
                        label="Availability"
                        value={draft.availability}
                        onValueChange={(value) =>
                          setDraft((current) => ({ ...current, availability: value }))
                        }
                        placeholder="Select or create availability"
                        options={editOptions.availability}
                      />
                    </Field>
                  </div>
                  <Field label="Benefits">
                    <Textarea
                      value={draft.benefits}
                      onChange={(e) =>
                        setDraft((value) => ({ ...value, benefits: e.target.value }))
                      }
                    />
                  </Field>
                  <Button onClick={() => void saveItem()} disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save changes
                  </Button>
                </>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No item selected.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Add item</CardTitle>
              <CardDescription>
                Create a new product or bundle for the portal catalog.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="SKU">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.catalogSku}
                    label="SKU"
                    value={draft.sku}
                    onValueChange={(value) => setDraft((current) => ({ ...current, sku: value }))}
                    placeholder="Select or create SKU"
                    options={editOptions.skus}
                  />
                </Field>
                <Field label="Product name">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.catalogProduct}
                    label="Product name"
                    value={draft.product_name}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, product_name: value }))
                    }
                    placeholder="Select or create product"
                    options={editOptions.productNames}
                  />
                </Field>
                <Field label="Category">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.catalogCategory}
                    label="Category"
                    value={draft.category}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, category: value }))
                    }
                    placeholder="Select or create category"
                    options={editOptions.categories}
                  />
                </Field>
                <Field label="Tier">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.catalogTier}
                    label="Tier"
                    value={draft.partner_tier}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, partner_tier: value }))
                    }
                    placeholder="Select or create tier"
                    options={editOptions.tiers}
                  />
                </Field>
                <Field label="Price">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.catalogPrice}
                    label="Price"
                    value={draft.list_price}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, list_price: value }))
                    }
                    placeholder="Select or create price"
                    options={editOptions.prices}
                  />
                </Field>
                <Field label="Stock">
                  <Input
                    type="number"
                    value={draft.stock}
                    onChange={(e) =>
                      setDraft((value) => ({ ...value, stock: Number(e.target.value) || 0 }))
                    }
                  />
                </Field>
              </div>
              <Field label="Benefits">
                <Textarea
                  value={draft.benefits}
                  onChange={(e) => setDraft((value) => ({ ...value, benefits: e.target.value }))}
                />
              </Field>
              <Button onClick={() => void addItem()} disabled={adding}>
                {adding ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Add catalog item
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <div className="text-sm text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
