import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Download, Loader2, Plus, RefreshCw, Search, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";

import { CsvExportButton } from "@/components/csv-export-button";
import { AccessDeniedPage } from "@/components/route-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LookupCombobox } from "@/components/lookup-combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createDropdownCatalogItem,
  updateDropdownCatalogItem,
} from "@/integrations/local/dropdown-sources";
import { supabase } from "@/integrations/local/client";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import { type CsvColumn } from "@/lib/csv-export";
import { ImportFeedback } from "@/lib/import-feedback";
import {
  parseSpreadsheetFile,
  validateImportTemplate,
  downloadTemplateCsv,
  buildImportSummaryMessage,
} from "@/lib/spreadsheet-import";
import {
  buildCatalogCreateValues,
  filterCatalogItemsByKind,
  getCatalogImportTemplateColumns,
  getCatalogImportTemplateSample,
  getCatalogKindLabel,
  getCatalogKindPluralLabel,
  normalizeCatalogKind,
  validateCatalogImportRows,
  type CatalogItemRecord,
  type CatalogKind,
} from "@/lib/catalog";
import { useAuth } from "@/hooks/use-auth";

type CatalogProjectionItem = CatalogItemRecord & {
  product_code?: string | null;
  product_status?: string | null;
  price_book_code?: string | null;
  price_book_version?: number | null;
  archived_at?: string | null;
};

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
  catalog_kind: CatalogKind;
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
  catalog_kind: "product",
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
  { key: "catalog_kind", header: "Module" },
];

export const Route = createFileRoute("/_authenticated/admin/catalog")({
  component: AdminCatalogPage,
});

function AdminCatalogPage() {
  const { hasRole } = useAuth();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<CatalogProjectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [moduleKind, setModuleKind] = useState<CatalogKind>("product");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<CatalogForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<
    Array<{ rowNumber: number; messages: string[] }>
  >([]);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("portal_catalog_items")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const rows = (data as CatalogProjectionItem[] | null) ?? [];
      setItems(rows);
      setSource(rows.length > 0 ? "database" : "empty");
      const currentRows = filterCatalogItemsByKind(rows, moduleKind);
      setSelectedId((current) =>
        current && currentRows.some((item) => item.id === current)
          ? current
          : (currentRows[0]?.id ?? null),
      );
    } catch {
      setItems([]);
      setSource("empty");
      setSelectedId(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [moduleKind]);

  useEffect(() => {
    void load();
  }, [load]);

  const moduleItems = useMemo(
    () => filterCatalogItemsByKind(items, moduleKind),
    [items, moduleKind],
  );

  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    return moduleItems.filter((item) => {
      const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
      const matchesQuery =
        !term ||
        [item.sku, item.product_name, item.category, item.partner_tier, item.benefits]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return matchesCategory && matchesQuery;
    });
  }, [categoryFilter, moduleItems, query]);

  const selectedItem = useMemo(
    () => moduleItems.find((item) => item.id === selectedId) ?? null,
    [moduleItems, selectedId],
  );

  const editOptions = useMemo(() => {
    return {
      skus: uniqueStrings(moduleItems.map((item) => item.sku)),
      categories: uniqueStrings(moduleItems.map((item) => item.category)),
      tiers: uniqueStrings(moduleItems.map((item) => item.partner_tier)),
      prices: uniqueStrings(moduleItems.map((item) => item.list_price)),
      margins: uniqueStrings(moduleItems.map((item) => item.margin)),
      availability: uniqueStrings(moduleItems.map((item) => item.availability)),
    };
  }, [moduleItems]);

  const categories = useMemo(
    () => ["all", ...new Set(moduleItems.map((item) => item.category))],
    [moduleItems],
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
      catalog_kind: normalizeCatalogKind(selectedItem.catalog_kind),
    });
  }, [selectedItem]);

  useEffect(() => {
    setDraft((current) =>
      current.catalog_kind === moduleKind
        ? current
        : {
            ...current,
            catalog_kind: moduleKind,
          },
    );
    setSelectedId((current) =>
      current && moduleItems.some((item) => item.id === current)
        ? current
        : (moduleItems[0]?.id ?? null),
    );
  }, [moduleKind, moduleItems]);

  const catalogImportOptions = useMemo(() => ({ kind: moduleKind }), [moduleKind]);

  if (!hasRole("super_admin")) {
    return <AccessDeniedPage title="Product Catalog" roleLabel="Super Admin" />;
  }

  const downloadImportTemplate = () => {
    downloadTemplateCsv({
      filenameStem: `livey-${moduleKind}-catalog`,
      columns: getCatalogImportTemplateColumns(catalogImportOptions),
      sampleRows: getCatalogImportTemplateSample(catalogImportOptions),
    });
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setImporting(true);
    setImportErrors([]);
    setImportMessage(null);

    try {
      const parsed = parseSpreadsheetFile(await file.arrayBuffer(), file.name);
      const templateErrors = validateImportTemplate(
        parsed,
        getCatalogImportTemplateColumns(catalogImportOptions),
      );
      if (templateErrors.length > 0) {
        setImportErrors(templateErrors);
        toast.error("Use the catalog import template before uploading again");
        return;
      }

      const validation = validateCatalogImportRows(parsed.rows, catalogImportOptions);
      if (validation.errors.length > 0) {
        setImportErrors(validation.errors);
        toast.error("Fix the import errors before uploading again");
        return;
      }

      for (const row of validation.rows) {
        await createDropdownCatalogItem(row);
      }

      setImportMessage(
        buildImportSummaryMessage(validation.rows.length, "catalog item", file.name),
      );
      toast.success(`Imported ${validation.rows.length} catalog items`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import catalog items");
    } finally {
      setImporting(false);
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  };

  const saveItem = async () => {
    if (!selectedItem) return;
    setSaving(true);
    try {
      const values = buildCatalogCreateValues({
        ...draft,
        catalog_kind: draft.catalog_kind,
      });
      const updatedItem = (await updateDropdownCatalogItem({
        id: selectedItem.id,
        ...values,
      })) as CatalogItemRecord;
      setItems((current) =>
        current.map((item) => (item.id === updatedItem.id ? updatedItem : item)),
      );
      setSelectedId(updatedItem.id);
      toast.success("Catalog item updated");
      setEditOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save item");
    } finally {
      setSaving(false);
    }
  };

  const addItem = async () => {
    if (!draft.product_name.trim()) {
      toast.error("Product name is required");
      return;
    }
    setAdding(true);
    try {
      const values = buildCatalogCreateValues(draft);
      await createDropdownCatalogItem(values);
      toast.success("Catalog item added");
      setDraft({ ...EMPTY_FORM, catalog_kind: moduleKind });
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
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Administration
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Product Catalog</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Define products and combos that shape the portal, all from one shared catalog store.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
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
            filenameStem="livey-catalog"
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
                catalog_kind: normalizeCatalogKind(item.catalog_kind),
              }))
            }
            variant="outline"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric
          label={getCatalogKindPluralLabel(moduleKind)}
          value={String(moduleItems.length)}
          hint="Catalog records in this module"
        />
        <Metric
          label="Registered"
          value={String(moduleItems.filter((item) => item.partner_tier === "Registered").length)}
          hint="Entry-level offers"
        />
        <Metric
          label="In stock"
          value={String(moduleItems.filter((item) => item.availability === "In stock").length)}
          hint="Ready to sell"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="space-y-4 border-b">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <CardTitle className="text-base">Catalog items</CardTitle>
                <CardDescription>
                  Search, filter, and edit the live {getCatalogKindLabel(moduleKind).toLowerCase()}{" "}
                  set.
                </CardDescription>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
                <Button type="button" variant="outline" onClick={downloadImportTemplate}>
                  <Download className="mr-2 h-4 w-4" />
                  Download template
                </Button>
                <Button asChild type="button" variant="outline" disabled={importing}>
                  <label htmlFor="catalog-import-file">
                    {importing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    Import CSV/XLSX
                  </label>
                </Button>
                <input
                  ref={importInputRef}
                  id="catalog-import-file"
                  type="file"
                  accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(event) => void handleImportFile(event)}
                />
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
            <Tabs
              value={moduleKind}
              onValueChange={(value) => setModuleKind(value as CatalogKind)}
              className="w-fit"
            >
              <TabsList>
                <TabsTrigger value="product">{getCatalogKindPluralLabel("product")}</TabsTrigger>
                <TabsTrigger value="combo">{getCatalogKindPluralLabel("combo")}</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="p-0">
            <ImportFeedback successMessage={importMessage} errors={importErrors} />
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading {getCatalogKindPluralLabel(moduleKind).toLowerCase()}...
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="p-8 text-sm text-muted-foreground">
                No {getCatalogKindPluralLabel(moduleKind).toLowerCase()} match this view.
              </div>
            ) : (
              <div className="divide-y">
                {filteredItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedId(item.id);
                      setEditOpen(true);
                    }}
                    className={`flex w-full flex-col gap-2 px-5 py-4 text-left transition sm:flex-row sm:items-center sm:justify-between sm:gap-4 hover:bg-muted/40 ${
                      selectedItem?.id === item.id ? "bg-muted/40" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-medium">{item.product_name}</div>
                        <Badge variant="secondary">
                          {getCatalogKindLabel(normalizeCatalogKind(item.catalog_kind))}
                        </Badge>
                        <Badge variant="outline">{item.partner_tier}</Badge>
                        {item.product_status ? (
                          <Badge variant="outline">{item.product_status}</Badge>
                        ) : null}
                        {item.price_book_code ? (
                          <Badge variant="outline">
                            {item.price_book_code}
                            {item.price_book_version ? ` v${item.price_book_version}` : ""}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {item.product_code ? `${item.product_code} · ` : ""}
                        {item.sku} · {item.category}
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
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
              <CardTitle className="text-base">
                Add {getCatalogKindLabel(moduleKind).toLowerCase()}
              </CardTitle>
              <CardDescription>
                Create a new {getCatalogKindLabel(moduleKind).toLowerCase()} in the shared catalog.
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
                    placeholder={`Select or create ${moduleKind}`}
                    source="catalog"
                    catalogKind={moduleKind}
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
                <Field label="Module">
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={draft.catalog_kind === "product" ? "default" : "outline"}
                      onClick={() =>
                        setDraft((current) => ({ ...current, catalog_kind: "product" }))
                      }
                    >
                      Product
                    </Button>
                    <Button
                      type="button"
                      variant={draft.catalog_kind === "combo" ? "default" : "outline"}
                      onClick={() => setDraft((current) => ({ ...current, catalog_kind: "combo" }))}
                    >
                      Combo
                    </Button>
                  </div>
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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selectedItem ? `Edit ${selectedItem.product_name}` : "Edit catalog item"}
            </DialogTitle>
            <DialogDescription>
              Update the selected item without keeping the full form in the page layout.
            </DialogDescription>
          </DialogHeader>

          {selectedItem ? (
            <>
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
                    placeholder={`Select or create ${moduleKind}`}
                    source="catalog"
                    catalogKind={moduleKind}
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
                <Field label="Module">
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={draft.catalog_kind === "product" ? "default" : "outline"}
                      onClick={() =>
                        setDraft((current) => ({ ...current, catalog_kind: "product" }))
                      }
                    >
                      Product
                    </Button>
                    <Button
                      type="button"
                      variant={draft.catalog_kind === "combo" ? "default" : "outline"}
                      onClick={() => setDraft((current) => ({ ...current, catalog_kind: "combo" }))}
                    >
                      Combo
                    </Button>
                  </div>
                </Field>
              </div>
              <Field label="Benefits">
                <Textarea
                  value={draft.benefits}
                  onChange={(e) => setDraft((value) => ({ ...value, benefits: e.target.value }))}
                />
              </Field>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    selectedItem &&
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
                      catalog_kind: normalizeCatalogKind(selectedItem.catalog_kind),
                    })
                  }
                >
                  Reset form
                </Button>
                <Button type="button" onClick={() => void saveItem()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save changes
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
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
