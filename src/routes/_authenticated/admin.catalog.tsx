import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AccessDeniedPage } from "@/components/route-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/local/client";
import { DEMO_CATALOG_ITEMS, type CatalogItemRecord } from "@/lib/portal-demo-data";
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

export const Route = createFileRoute("/_authenticated/admin/catalog")({
  component: AdminCatalogPage,
});

function AdminCatalogPage() {
  const { hasRole } = useAuth();
  const [items, setItems] = useState<CatalogItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "fallback" | "empty">("empty");
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
      setItems(DEMO_CATALOG_ITEMS);
      setSource("fallback");
      setSelectedId((current) => current ?? DEMO_CATALOG_ITEMS[0]?.id ?? null);
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
            {source === "fallback" ? "Fallback demo data" : "Seeded demo data"}
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
                <CardDescription>Search, filter, and edit the seeded product set.</CardDescription>
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
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category === "all" ? "All categories" : category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                      <Input
                        value={draft.sku}
                        onChange={(e) => setDraft((value) => ({ ...value, sku: e.target.value }))}
                      />
                    </Field>
                    <Field label="Product name">
                      <Input
                        value={draft.product_name}
                        onChange={(e) =>
                          setDraft((value) => ({ ...value, product_name: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Category">
                      <Input
                        value={draft.category}
                        onChange={(e) =>
                          setDraft((value) => ({ ...value, category: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Tier">
                      <Input
                        value={draft.partner_tier}
                        onChange={(e) =>
                          setDraft((value) => ({ ...value, partner_tier: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label="List price">
                      <Input
                        value={draft.list_price}
                        onChange={(e) =>
                          setDraft((value) => ({ ...value, list_price: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Margin">
                      <Input
                        value={draft.margin}
                        onChange={(e) =>
                          setDraft((value) => ({ ...value, margin: e.target.value }))
                        }
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
                      <Input
                        value={draft.availability}
                        onChange={(e) =>
                          setDraft((value) => ({ ...value, availability: e.target.value }))
                        }
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
                  <Input
                    value={draft.sku}
                    onChange={(e) => setDraft((value) => ({ ...value, sku: e.target.value }))}
                  />
                </Field>
                <Field label="Product name">
                  <Input
                    value={draft.product_name}
                    onChange={(e) =>
                      setDraft((value) => ({ ...value, product_name: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Category">
                  <Input
                    value={draft.category}
                    onChange={(e) => setDraft((value) => ({ ...value, category: e.target.value }))}
                  />
                </Field>
                <Field label="Tier">
                  <Input
                    value={draft.partner_tier}
                    onChange={(e) =>
                      setDraft((value) => ({ ...value, partner_tier: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Price">
                  <Input
                    value={draft.list_price}
                    onChange={(e) =>
                      setDraft((value) => ({ ...value, list_price: e.target.value }))
                    }
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
